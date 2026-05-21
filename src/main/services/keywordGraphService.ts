import type Database from 'better-sqlite3'
import type {
  KeywordGraphEdge,
  KeywordGraphNeighborQuery,
  KeywordGraphNode,
  KeywordGraphPayload,
  KeywordGraphQuery,
  KeywordGraphSearchHit
} from '@shared/types'

type EntityRow = {
  id: string
  iri: string
  label: string
  entityType: string
  updatedAt: number
}

type CursorToken = {
  updatedAt: number
  id: string
}

type RelationRow = {
  id: string
  subjectIri: string
  predicateIri: string
  objectIri: string | null
  confidence: number
  sourceRef: string
  createdAt: number
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | undefined
  return Boolean(row?.ok)
}

function encodeCursor(cursor: CursorToken): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | undefined): CursorToken | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorToken
    if (!Number.isFinite(parsed.updatedAt) || typeof parsed.id !== 'string' || !parsed.id.trim()) return null
    return { updatedAt: Math.floor(parsed.updatedAt), id: parsed.id }
  } catch {
    return null
  }
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function predicateFromIri(predicateIri: string): string {
  const hash = predicateIri.lastIndexOf('#')
  if (hash >= 0 && hash < predicateIri.length - 1) return predicateIri.slice(hash + 1)
  const slash = predicateIri.lastIndexOf('/')
  if (slash >= 0 && slash < predicateIri.length - 1) return predicateIri.slice(slash + 1)
  return predicateIri
}

function scoreNode(row: EntityRow): number {
  const recency = Math.max(0, Math.min(1, 1 - (Date.now() - row.updatedAt) / (14 * 24 * 60 * 60 * 1000)))
  const typeBoost = row.entityType === 'keyword' ? 0.68 : 0.44
  return Number((typeBoost * 0.7 + recency * 0.3).toFixed(4))
}

function relationRecency(createdAt: number): number {
  return Math.max(0, Math.min(1, 1 - (Date.now() - createdAt) / (21 * 24 * 60 * 60 * 1000)))
}

function readKeywordEntities(
  db: Database.Database,
  query?: string,
  limit = 220,
  cursorRaw?: string
): { rows: EntityRow[]; nextCursor?: string } {
  if (!tableExists(db, 'kg_core_entities')) return { rows: [] }
  const cursor = decodeCursor(cursorRaw)
  const like = `%${(query ?? '').trim().replace(/%/g, '').replace(/_/g, '')}%`
  const budget = Math.max(1, limit + 1)
  const toPage = (records: EntityRow[]): { rows: EntityRow[]; nextCursor?: string } => {
    if (records.length <= limit) return { rows: records }
    const slice = records.slice(0, limit)
    const last = slice[slice.length - 1]
    return last ? { rows: slice, nextCursor: encodeCursor({ updatedAt: last.updatedAt, id: last.id }) } : { rows: slice }
  }
  if (!query?.trim()) {
    const rows = (
      cursor
        ? db
            .prepare(
              `SELECT id, iri, label, entity_type as entityType, updated_at as updatedAt
               FROM kg_core_entities
               WHERE entity_type IN ('keyword', 'scope')
                 AND (updated_at < ? OR (updated_at = ? AND id > ?))
               ORDER BY updated_at DESC, id ASC
               LIMIT ?`
            )
            .all(cursor.updatedAt, cursor.updatedAt, cursor.id, budget)
        : db
            .prepare(
              `SELECT id, iri, label, entity_type as entityType, updated_at as updatedAt
               FROM kg_core_entities
               WHERE entity_type IN ('keyword', 'scope')
               ORDER BY updated_at DESC, id ASC
               LIMIT ?`
            )
            .all(budget)
    ) as EntityRow[]
    return toPage(rows)
  }
  const rows = (
    cursor
      ? db
          .prepare(
            `SELECT id, iri, label, entity_type as entityType, updated_at as updatedAt
             FROM kg_core_entities
             WHERE entity_type IN ('keyword', 'scope')
               AND (label LIKE ? OR iri LIKE ?)
               AND (updated_at < ? OR (updated_at = ? AND id > ?))
             ORDER BY updated_at DESC, id ASC
             LIMIT ?`
          )
          .all(like, like, cursor.updatedAt, cursor.updatedAt, cursor.id, budget)
      : db
          .prepare(
            `SELECT id, iri, label, entity_type as entityType, updated_at as updatedAt
             FROM kg_core_entities
             WHERE entity_type IN ('keyword', 'scope')
               AND (label LIKE ? OR iri LIKE ?)
             ORDER BY updated_at DESC, id ASC
             LIMIT ?`
          )
          .all(like, like, budget)
  ) as EntityRow[]
  return toPage(rows)
}

function readRelationsForIris(db: Database.Database, iris: string[], limit: number): RelationRow[] {
  if (!tableExists(db, 'kg_core_relations')) return []
  if (iris.length === 0) return []
  const placeholders = iris.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT id,
              subject_iri as subjectIri,
              predicate_iri as predicateIri,
              object_iri as objectIri,
              confidence,
              source_ref as sourceRef,
              created_at as createdAt
       FROM kg_core_relations
       WHERE (subject_iri IN (${placeholders}) OR object_iri IN (${placeholders}))
         AND object_iri IS NOT NULL
       ORDER BY confidence DESC, created_at DESC
       LIMIT ?`
    )
    .all(...iris, ...iris, Math.max(limit, 1)) as RelationRow[]
}

function asPayload(
  rows: EntityRow[],
  relRows: RelationRow[],
  opts: { relationTypes?: string[]; minConfidence?: number; limitEdges?: number; nextCursor?: string }
): KeywordGraphPayload {
  const nodeByIri = new Map(rows.map((r) => [r.iri, r] as const))
  const aliasesByIri = new Map<string, Set<string>>()
  for (const row of rows) aliasesByIri.set(row.iri, new Set([normalizeLabel(row.label)]))

  const relationTypeFilter = opts.relationTypes?.length
    ? new Set(opts.relationTypes.map((x) => x.trim().toLowerCase()).filter(Boolean))
    : null
  const minConfidence = Math.max(0, Math.min(1, opts.minConfidence ?? 0))
  const edgeBudget = Math.max(1, opts.limitEdges ?? 500)
  const edges: KeywordGraphEdge[] = []
  const supportCounter = new Map<string, number>()
  const provenanceByEdge = new Map<string, Set<string>>()

  for (const rel of relRows) {
    if (!rel.objectIri) continue
    const fromNode = nodeByIri.get(rel.subjectIri)
    const toNode = nodeByIri.get(rel.objectIri)
    if (!fromNode || !toNode) continue
    const predicate = predicateFromIri(rel.predicateIri)
    if (relationTypeFilter && !relationTypeFilter.has(predicate.toLowerCase())) continue
    if ((Number(rel.confidence) || 0) < minConfidence) continue
    const key = `${rel.subjectIri}|${rel.objectIri}|${predicate}`
    supportCounter.set(key, (supportCounter.get(key) ?? 0) + 1)
    if (!provenanceByEdge.has(key)) provenanceByEdge.set(key, new Set<string>())
    provenanceByEdge.get(key)!.add(rel.sourceRef)
    if (edges.length >= edgeBudget) continue
    edges.push({
      id: rel.id,
      from: fromNode.id,
      to: toNode.id,
      predicate,
      directed: true,
      confidence: Math.max(0, Math.min(1, Number(rel.confidence) || 0.5)),
      supportCount: 1,
      provenanceIds: [rel.sourceRef],
      recency: relationRecency(rel.createdAt)
    })
  }

  const nodes: KeywordGraphNode[] = rows.map((row) => {
    const iri = row.iri
    const aliases = [...(aliasesByIri.get(iri) ?? new Set([normalizeLabel(row.label)]))]
    const nodeType: 'keyword' | 'scope' = row.entityType === 'scope' ? 'scope' : 'keyword'
    return {
      id: row.id,
      type: nodeType,
      canonicalLabel: normalizeLabel(row.label),
      aliases,
      confidence: row.entityType === 'scope' ? 0.72 : 0.78,
      salience: scoreNode(row),
      sourceCoverage: Math.max(0, Math.min(1, Math.min(1, aliases.length / 6))),
      evidenceTraceIds: [] as string[]
    }
  })

  const edgesFinal = edges.map((edge) => {
    const fromIri = rows.find((r) => r.id === edge.from)?.iri
    const toIri = rows.find((r) => r.id === edge.to)?.iri
    const key = `${fromIri ?? ''}|${toIri ?? ''}|${edge.predicate}`
    return {
      ...edge,
      supportCount: supportCounter.get(key) ?? edge.supportCount,
      provenanceIds: [...(provenanceByEdge.get(key) ?? new Set(edge.provenanceIds))]
    }
  })

  return {
    nodes,
    edges: edgesFinal,
    truncated: rows.length >= 220 || relRows.length >= edgeBudget,
    nextCursor: opts.nextCursor,
    projectionMeta: {
      generatedAt: Date.now(),
      nodeCount: nodes.length,
      edgeCount: edgesFinal.length,
      source: 'dynamic'
    }
  }
}

export function getKeywordGraph(db: Database.Database, query?: KeywordGraphQuery): KeywordGraphPayload {
  const limitNodes = Math.max(20, Math.min(1000, query?.limitNodes ?? 220))
  const paged = readKeywordEntities(db, query?.query, limitNodes, query?.cursor)
  const rows = paged.rows
  const iris = rows.map((r) => r.iri)
  const relationRows = readRelationsForIris(db, iris, Math.max(40, Math.min(2400, query?.limitEdges ?? 600)))
  return asPayload(rows, relationRows, {
    relationTypes: query?.relationTypes,
    minConfidence: query?.minConfidence,
    limitEdges: query?.limitEdges,
    nextCursor: paged.nextCursor
  })
}

export function getKeywordGraphNeighbors(
  db: Database.Database,
  request: KeywordGraphNeighborQuery
): KeywordGraphPayload {
  const hops = Math.max(1, Math.min(3, request.hops ?? 1))
  const limitNodes = Math.max(10, Math.min(600, request.limitNodes ?? 140))
  const limitEdges = Math.max(10, Math.min(1400, request.limitEdges ?? 260))
  if (!tableExists(db, 'kg_core_entities') || !tableExists(db, 'kg_core_relations')) {
    return { nodes: [], edges: [], truncated: false }
  }
  const seed = db
    .prepare('SELECT id, iri, label, entity_type as entityType, updated_at as updatedAt FROM kg_core_entities WHERE id = ? LIMIT 1')
    .get(request.nodeId) as EntityRow | undefined
  if (!seed) return { nodes: [], edges: [], truncated: false }

  const visited = new Set<string>([seed.iri])
  let frontier = new Set<string>([seed.iri])
  for (let h = 0; h < hops; h++) {
    if (frontier.size === 0) break
    const f = [...frontier]
    const placeholders = f.map(() => '?').join(',')
    const rels = db
      .prepare(
        `SELECT subject_iri as subjectIri, object_iri as objectIri
         FROM kg_core_relations
         WHERE (subject_iri IN (${placeholders}) OR object_iri IN (${placeholders}))
           AND object_iri IS NOT NULL
         LIMIT ?`
      )
      .all(...f, ...f, limitEdges) as Array<{ subjectIri: string; objectIri: string | null }>
    const next = new Set<string>()
    for (const rel of rels) {
      if (rel.subjectIri && !visited.has(rel.subjectIri)) next.add(rel.subjectIri)
      if (rel.objectIri && !visited.has(rel.objectIri)) next.add(rel.objectIri)
    }
    for (const iri of next) visited.add(iri)
    frontier = next
    if (visited.size >= limitNodes) break
  }

  const iris = [...visited].slice(0, limitNodes)
  const placeholders = iris.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, iri, label, entity_type as entityType, updated_at as updatedAt
       FROM kg_core_entities
       WHERE iri IN (${placeholders})
       ORDER BY updated_at DESC`
    )
    .all(...iris) as EntityRow[]
  const relRows = readRelationsForIris(db, iris, limitEdges)
  return asPayload(rows, relRows, { limitEdges })
}

export function searchKeywordGraphNodes(db: Database.Database, rawQuery: string, limit = 14): KeywordGraphSearchHit[] {
  const query = rawQuery.trim()
  if (!query) return []
  const rows = readKeywordEntities(db, query, Math.max(1, Math.min(120, limit * 3))).rows
  return rows
    .map((row) => {
      const label = normalizeLabel(row.label)
      const q = query.toLowerCase()
      const i = label.toLowerCase().indexOf(q)
      const starts = i === 0 ? 0.35 : 0
      const contains = i >= 0 ? 0.28 : 0
      const recency = scoreNode(row) * 0.25
      const score = Math.max(0.01, starts + contains + recency)
      return {
        id: row.id,
        canonicalLabel: label,
        aliases: [label],
        score: Number(score.toFixed(4))
      } satisfies KeywordGraphSearchHit
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(120, limit)))
}
