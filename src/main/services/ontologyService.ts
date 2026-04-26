import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type {
  OntologyEdge,
  OntologyEntityDetails,
  OntologyNode,
  OntologyQueryRequest,
  OntologyStats,
  OntologySubgraphPayload
} from '@shared/types'

const DEFAULT_NAMESPACE_ROWS: Array<{ prefix: string; baseIri: string }> = [
  { prefix: 'app', baseIri: 'app://ontology/' },
  { prefix: 'schema', baseIri: 'https://schema.org/' },
  { prefix: 'rdf', baseIri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' }
]

const PREDICATE = {
  relatedTo: 'app:relatedTo',
  isA: 'app:isA',
  dependsOn: 'app:dependsOn',
  uses: 'app:uses',
  contains: 'app:contains'
} as const

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'answer',
  'because',
  'between',
  'build',
  'can',
  'chat',
  'context',
  'create',
  'did',
  'does',
  'domain',
  'from',
  'have',
  'into',
  'just',
  'know',
  'like',
  'model',
  'more',
  'need',
  'only',
  'precise',
  'runtime',
  'should',
  'that',
  'their',
  'there',
  'this',
  'user',
  'using',
  'very',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would'
])

export type OntologyIngestInput = {
  text: string
  sourceType: string
  sourceRef: string
  confidence?: number
  entityType?: string
}

type TripleRow = {
  id: string
  subject_iri: string
  predicate_iri: string
  object_iri: string | null
  object_literal: string | null
  source_type: string
  source_ref: string
  confidence: number
  created_at: number
}

type EntityRow = {
  iri: string
  label: string
  type: string
  confidence: number
}

function clampConfidence(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.6
  return Math.max(0.05, Math.min(1, v))
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function canonicalEntityLabel(raw: string): string {
  const cleaned = raw.replace(/[`"'()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 128)
}

function parseSentenceRelations(sentence: string): Array<{ a: string; p: string; b: string }> {
  const s = sentence.replace(/\s+/g, ' ').trim()
  if (!s) return []
  const out: Array<{ a: string; p: string; b: string }> = []
  const relationRules: Array<{ re: RegExp; p: string }> = [
    { re: /\b(.{3,64}?)\s+(?:is|are)\s+(?:an?\s+|the\s+)?(.{3,64})$/i, p: PREDICATE.isA },
    { re: /\b(.{3,64}?)\s+depends on\s+(.{3,64})$/i, p: PREDICATE.dependsOn },
    { re: /\b(.{3,64}?)\s+uses\s+(.{3,64})$/i, p: PREDICATE.uses },
    { re: /\b(.{3,64}?)\s+(?:contains|includes)\s+(.{3,64})$/i, p: PREDICATE.contains }
  ]
  for (const rule of relationRules) {
    const m = s.match(rule.re)
    if (!m) continue
    const a = canonicalEntityLabel(m[1] ?? '')
    const b = canonicalEntityLabel(m[2] ?? '')
    if (a.length < 3 || b.length < 3 || a === b) continue
    out.push({ a, p: rule.p, b })
  }
  return out
}

function extractEntityCandidates(text: string): string[] {
  const counts = new Map<string, number>()
  const matches = text.match(/[A-Za-z][A-Za-z0-9_/-]{2,}/g) ?? []
  for (const raw of matches) {
    const normalized = canonicalEntityLabel(raw)
    const slug = toSlug(normalized)
    if (slug.length < 3) continue
    if (STOP_WORDS.has(slug)) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 18)
    .map(([label]) => label)
}

function rowToEdge(row: TripleRow): OntologyEdge {
  return {
    id: row.id,
    subjectIri: row.subject_iri,
    predicateIri: row.predicate_iri,
    objectIri: row.object_iri,
    objectLiteral: row.object_literal,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    confidence: row.confidence,
    createdAt: row.created_at
  }
}

export type OntologyService = {
  ingestText: (input: OntologyIngestInput) => { entities: number; triples: number }
  getStats: () => OntologyStats
  querySubgraph: (request?: OntologyQueryRequest) => OntologySubgraphPayload
  entityDetails: (iri: string, limit?: number) => OntologyEntityDetails
  rebuildSnapshot: () => { ok: true; snapshotId: string }
  exportJsonLd: () => Record<string, unknown>
}

export function createOntologyService(db: Database.Database): OntologyService {
  const insertEntity = db.prepare(
    `INSERT INTO ontology_entities (id, iri, label, type, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(iri) DO UPDATE SET
       label = excluded.label,
       type = excluded.type,
       confidence = ((ontology_entities.confidence * 0.85) + (excluded.confidence * 0.15)),
       updated_at = excluded.updated_at`
  )
  const insertTriple = db.prepare(
    `INSERT OR IGNORE INTO ontology_triples
      (id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const selectEntity = db.prepare(
    'SELECT iri, label, type, confidence FROM ontology_entities WHERE iri = ?'
  )
  const selectEntitiesByIri = db.prepare(
    'SELECT iri, label, type, confidence FROM ontology_entities WHERE iri IN (SELECT value FROM json_each(?))'
  )
  const selectTriplesByIri = db.prepare(
    `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
     FROM ontology_triples
     WHERE subject_iri IN (SELECT value FROM json_each(?))
        OR object_iri IN (SELECT value FROM json_each(?))
     ORDER BY created_at DESC
     LIMIT ?`
  )
  const selectOutgoing = db.prepare(
    `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
     FROM ontology_triples
     WHERE subject_iri = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )
  const selectIncoming = db.prepare(
    `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
     FROM ontology_triples
     WHERE object_iri = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )

  for (const row of DEFAULT_NAMESPACE_ROWS) {
    db.prepare('INSERT OR IGNORE INTO ontology_namespaces (prefix, base_iri) VALUES (?, ?)').run(
      row.prefix,
      row.baseIri
    )
  }

  function upsertEntity(labelRaw: string, type: string, confidence: number): string | null {
    const label = canonicalEntityLabel(labelRaw)
    if (!label || label.length < 2) return null
    const slug = toSlug(label)
    if (!slug) return null
    const iri = `app:entity/${slug}`
    const now = Date.now()
    insertEntity.run(randomUUID(), iri, label, type, clampConfidence(confidence), now, now)
    return iri
  }

  function writeTriple(args: {
    subjectIri: string
    predicateIri: string
    objectIri?: string | null
    objectLiteral?: string | null
    sourceType: string
    sourceRef: string
    confidence: number
  }): boolean {
    const rowId = randomUUID()
    const out = insertTriple.run(
      rowId,
      args.subjectIri,
      args.predicateIri,
      args.objectIri ?? null,
      args.objectLiteral ?? null,
      args.sourceType,
      args.sourceRef,
      clampConfidence(args.confidence),
      Date.now()
    )
    return out.changes > 0
  }

  function seedEntitiesFromQuery(query: string, limit: number, typeFilters: string[]): string[] {
    const q = query.trim().toLowerCase()
    const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 6)
    if (words.length === 0) return []
    const clauses: string[] = []
    const params: unknown[] = []
    for (const w of words) {
      clauses.push('LOWER(label) LIKE ?')
      params.push(`%${w}%`)
    }
    const typeClause = typeFilters.length > 0 ? ' AND type IN (SELECT value FROM json_each(?))' : ''
    if (typeFilters.length > 0) params.push(JSON.stringify(typeFilters))
    params.push(limit)
    const sql = `SELECT iri FROM ontology_entities WHERE (${clauses.join(' OR ')})${typeClause} ORDER BY updated_at DESC LIMIT ?`
    const rows = db.prepare(sql).all(...params) as Array<{ iri: string }>
    return rows.map((r) => r.iri)
  }

  function listRecentEntitySeeds(limit: number): string[] {
    const rows = db
      .prepare(
        `SELECT DISTINCT subject_iri as iri
         FROM ontology_triples
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ iri: string }>
    return rows.map((r) => r.iri)
  }

  return {
    ingestText(input: OntologyIngestInput): { entities: number; triples: number } {
      const text = input.text.trim()
      if (!text) return { entities: 0, triples: 0 }
      const baseConfidence = clampConfidence(input.confidence)
      const entityType = input.entityType?.trim() || 'concept'
      const entities = extractEntityCandidates(text)
      const iris: string[] = []
      for (const label of entities) {
        const iri = upsertEntity(label, entityType, baseConfidence)
        if (iri) iris.push(iri)
      }

      let triplesWritten = 0
      const sentenceRelations = text
        .split(/[.!?\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 4)
        .slice(0, 14)
      for (const sentence of sentenceRelations) {
        const rels = parseSentenceRelations(sentence)
        for (const rel of rels) {
          const a = upsertEntity(rel.a, entityType, baseConfidence)
          const b = upsertEntity(rel.b, entityType, baseConfidence)
          if (!a || !b) continue
          if (
            writeTriple({
              subjectIri: a,
              predicateIri: rel.p,
              objectIri: b,
              sourceType: input.sourceType,
              sourceRef: input.sourceRef,
              confidence: baseConfidence
            })
          ) {
            triplesWritten += 1
          }
        }
      }

      for (let i = 0; i < iris.length; i++) {
        const a = iris[i]
        const b = iris[i + 1]
        if (!a || !b || a === b) continue
        if (
          writeTriple({
            subjectIri: a,
            predicateIri: PREDICATE.relatedTo,
            objectIri: b,
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            confidence: baseConfidence * 0.85
          })
        ) {
          triplesWritten += 1
        }
      }

      return { entities: iris.length, triples: triplesWritten }
    },

    getStats(): OntologyStats {
      const entityCount =
        (db.prepare('SELECT COUNT(*) as c FROM ontology_entities').get() as { c: number } | undefined)?.c ?? 0
      const tripleCount =
        (db.prepare('SELECT COUNT(*) as c FROM ontology_triples').get() as { c: number } | undefined)?.c ?? 0
      const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      const recentTripleCount =
        (
          db
            .prepare('SELECT COUNT(*) as c FROM ontology_triples WHERE created_at >= ?')
            .get(recentCutoff) as { c: number } | undefined
        )?.c ?? 0
      const predRows = db
        .prepare(
          `SELECT predicate_iri as predicate, COUNT(*) as count
           FROM ontology_triples
           GROUP BY predicate_iri
           ORDER BY count DESC
           LIMIT 8`
        )
        .all() as Array<{ predicate: string; count: number }>
      const lastUpdatedAt = (
        db.prepare('SELECT MAX(created_at) as ts FROM ontology_triples').get() as { ts?: number } | undefined
      )?.ts
      return {
        entityCount,
        tripleCount,
        recentTripleCount,
        predicateCount: predRows.length,
        topPredicates: predRows,
        lastUpdatedAt
      }
    },

    querySubgraph(request?: OntologyQueryRequest): OntologySubgraphPayload {
      const limitEntities = Math.max(5, Math.min(300, Math.floor(request?.limitEntities ?? 90)))
      const limitTriples = Math.max(10, Math.min(900, Math.floor(request?.limitTriples ?? 260)))
      const maxHops = Math.max(1, Math.min(3, Math.floor(request?.maxHops ?? 2)))
      const typeFilters = (request?.typeFilters ?? []).filter((v) => typeof v === 'string' && v.trim().length > 0)
      const predicateFilters = (request?.predicateFilters ?? []).filter(
        (v) => typeof v === 'string' && v.trim().length > 0
      )
      const recentOnlyMs =
        typeof request?.recentOnlyMs === 'number' && request.recentOnlyMs > 0 ? request.recentOnlyMs : undefined
      const recentCutoff = recentOnlyMs ? Date.now() - recentOnlyMs : undefined

      let frontier = request?.query?.trim()
        ? seedEntitiesFromQuery(request.query, limitEntities, typeFilters)
        : listRecentEntitySeeds(limitEntities)
      if (frontier.length === 0) return { nodes: [], edges: [], truncated: false }

      const allIris = new Set<string>(frontier)
      const allEdges: OntologyEdge[] = []
      for (let hop = 0; hop < maxHops; hop++) {
        if (frontier.length === 0 || allEdges.length >= limitTriples) break
        const rows = selectTriplesByIri.all(
          JSON.stringify(frontier),
          JSON.stringify(frontier),
          Math.max(1, limitTriples - allEdges.length)
        ) as TripleRow[]
        const nextFrontier = new Set<string>()
        for (const row of rows) {
          if (recentCutoff && row.created_at < recentCutoff) continue
          if (predicateFilters.length > 0 && !predicateFilters.includes(row.predicate_iri)) continue
          allEdges.push(rowToEdge(row))
          allIris.add(row.subject_iri)
          if (row.object_iri) allIris.add(row.object_iri)
          if (row.subject_iri) nextFrontier.add(row.subject_iri)
          if (row.object_iri) nextFrontier.add(row.object_iri)
          if (allEdges.length >= limitTriples) break
        }
        frontier = [...nextFrontier].slice(0, limitEntities)
      }

      const nodes = (
        selectEntitiesByIri.all(JSON.stringify([...allIris].slice(0, limitEntities))) as EntityRow[]
      )
        .filter((row) => (typeFilters.length > 0 ? typeFilters.includes(row.type) : true))
        .map(
          (row) =>
            ({
              iri: row.iri,
              label: row.label,
              type: row.type,
              confidence: row.confidence
            }) satisfies OntologyNode
        )

      const allowed = new Set(nodes.map((n) => n.iri))
      const edges = allEdges.filter((e) => allowed.has(e.subjectIri) && (!e.objectIri || allowed.has(e.objectIri)))
      return {
        nodes,
        edges: edges.slice(0, limitTriples),
        truncated: edges.length > limitTriples || allIris.size > nodes.length
      }
    },

    entityDetails(iri: string, limit = 40): OntologyEntityDetails {
      const entity = (selectEntity.get(iri) as EntityRow | undefined) ?? null
      const outgoing = (selectOutgoing.all(iri, Math.max(1, Math.min(300, limit))) as TripleRow[]).map(rowToEdge)
      const incoming = (selectIncoming.all(iri, Math.max(1, Math.min(300, limit))) as TripleRow[]).map(rowToEdge)
      return {
        entity: entity
          ? {
              iri: entity.iri,
              label: entity.label,
              type: entity.type,
              confidence: entity.confidence
            }
          : null,
        outgoing,
        incoming
      }
    },

    rebuildSnapshot(): { ok: true; snapshotId: string } {
      const stats = this.getStats()
      const snapshotId = randomUUID()
      db.prepare('INSERT INTO ontology_snapshots (id, summary_json, created_at) VALUES (?, ?, ?)').run(
        snapshotId,
        JSON.stringify(stats),
        Date.now()
      )
      return { ok: true, snapshotId }
    },

    exportJsonLd(): Record<string, unknown> {
      const nsRows = db.prepare('SELECT prefix, base_iri FROM ontology_namespaces').all() as Array<{
        prefix: string
        base_iri: string
      }>
      const edges = db
        .prepare(
          `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
           FROM ontology_triples
           ORDER BY created_at DESC
           LIMIT 5000`
        )
        .all() as TripleRow[]
      return {
        '@context': Object.fromEntries(nsRows.map((row) => [row.prefix, row.base_iri])),
        generatedAt: Date.now(),
        triples: edges.map((e) => ({
          id: e.id,
          subject: e.subject_iri,
          predicate: e.predicate_iri,
          object: e.object_iri ?? e.object_literal,
          confidence: e.confidence,
          sourceType: e.source_type,
          sourceRef: e.source_ref,
          createdAt: e.created_at
        }))
      }
    }
  }
}
