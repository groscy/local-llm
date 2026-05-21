import type Database from 'better-sqlite3'
import type { KbSearchHit, RetrievalHit, RetrievalQueryOptions } from '@shared/types'

function ftsEscape(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '')}"`)
    .join(' AND ')
}

function domainFilterSql(domainIds: string[] | undefined): { sql: string; args: unknown[] } {
  if (!domainIds || domainIds.length === 0) return { sql: '', args: [] }
  const placeholders = domainIds.map(() => '?').join(',')
  return {
    sql: `AND EXISTS (
      SELECT 1
      FROM kb_domain_membership dm
      WHERE dm.source_id = s.id AND dm.domain_id IN (${placeholders})
    )`,
    args: domainIds
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | undefined
  return Boolean(row?.ok)
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim().replace(/[^a-z0-9_-]+/g, ''))
    .filter((t) => t.length >= 2)
}

function semanticSignalFromOverlap(queryTokens: string[], text: string, heading: string | null | undefined): number {
  if (queryTokens.length === 0) return 0
  const corpus = `${heading ?? ''}\n${text}`.toLowerCase()
  let hitCount = 0
  for (const token of queryTokens) {
    if (token && corpus.includes(token)) hitCount++
  }
  const coverage = hitCount / queryTokens.length
  return Number(Math.min(1, Math.max(0, coverage)).toFixed(4))
}

function keywordExpansionWeights(db: Database.Database, queryTokens: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (queryTokens.length === 0) return out
  if (!tableExists(db, 'kg_core_entities') || !tableExists(db, 'kg_core_relations')) return out
  const likeTokens = queryTokens.filter((t) => t.length >= 3).slice(0, 6)
  if (likeTokens.length === 0) return out
  const seedIris = new Set<string>()
  for (const token of likeTokens) {
    const like = `%${token.replace(/%/g, '').replace(/_/g, '')}%`
    const rows = db
      .prepare(
        `SELECT iri, label
         FROM kg_core_entities
         WHERE entity_type IN ('keyword', 'scope')
           AND label LIKE ?
         ORDER BY updated_at DESC
         LIMIT 24`
      )
      .all(like) as Array<{ iri: string; label: string }>
    for (const row of rows) {
      seedIris.add(row.iri)
      const key = row.label.toLowerCase()
      out.set(key, Math.max(out.get(key) ?? 0, 0.14))
    }
  }
  if (seedIris.size === 0) return out
  const iriList = [...seedIris].slice(0, 32)
  const placeholders = iriList.map(() => '?').join(',')
  const neighbors = db
    .prepare(
      `SELECT e.label as label
       FROM kg_core_relations r
       JOIN kg_core_entities e
         ON e.iri = CASE
                      WHEN r.subject_iri IN (${placeholders}) THEN r.object_iri
                      ELSE r.subject_iri
                    END
       WHERE (r.subject_iri IN (${placeholders}) OR r.object_iri IN (${placeholders}))
         AND r.object_iri IS NOT NULL
       ORDER BY r.confidence DESC, r.created_at DESC
       LIMIT 120`
    )
    .all(...iriList, ...iriList, ...iriList) as Array<{ label: string }>
  for (const row of neighbors) {
    const key = row.label.toLowerCase().trim()
    if (!key) continue
    out.set(key, Math.max(out.get(key) ?? 0, 0.1))
  }
  return out
}

function graphSemanticBoost(weights: Map<string, number>, text: string, heading: string | null | undefined): number {
  if (weights.size === 0) return 0
  const corpus = `${heading ?? ''}\n${text}`.toLowerCase()
  let score = 0
  for (const [term, weight] of weights.entries()) {
    if (corpus.includes(term)) score += weight
  }
  return Math.min(0.28, Number(score.toFixed(4)))
}

export function retrieveChunks(db: Database.Database, options: RetrievalQueryOptions): RetrievalHit[] {
  const fts = ftsEscape(options.query)
  if (!fts) return []
  const queryTokens = tokenizeQuery(options.query)
  const graphWeights = keywordExpansionWeights(db, queryTokens)
  const limit = Math.min(120, Math.max(1, options.limit))
  const filter = domainFilterSql(options.domainIds)
  let rows: Array<{
    sourceId: string
    sourceTitle: string
    chunkId: string
    text: string
    heading: string | null
    passageTitle: string | null
    anchor: string | null
    ord: number
    lexicalScore: number
    domainId: string | null
  }> = []
  try {
    rows = db
      .prepare(
        `SELECT s.id as sourceId,
                s.title as sourceTitle,
                c.id as chunkId,
                c.text as text,
                c.heading as heading,
                c.passage_title as passageTitle,
                c.anchor as anchor,
                c.ord as ord,
                (-1.0 * bm25(f)) as lexicalScore,
                (
                  SELECT dm.domain_id
                  FROM kb_domain_membership dm
                  WHERE dm.source_id = s.id
                  ORDER BY dm.confidence DESC
                  LIMIT 1
                ) as domainId
         FROM kb_chunks_fts f
         JOIN kb_chunks c ON c.id = f.chunk_id
         JOIN kb_sources s ON s.id = c.source_id
         WHERE f MATCH ?
         ${filter.sql}
         ORDER BY lexicalScore DESC
         LIMIT ?`
      )
      .all(fts, ...filter.args, limit) as typeof rows
  } catch {
    const like = `%${options.query.replace(/%/g, '').replace(/_/g, '')}%`
    rows = db
      .prepare(
        `SELECT s.id as sourceId,
                s.title as sourceTitle,
                c.id as chunkId,
                c.text as text,
                c.heading as heading,
                c.passage_title as passageTitle,
                c.anchor as anchor,
                c.ord as ord,
                0.01 as lexicalScore,
                (
                  SELECT dm.domain_id
                  FROM kb_domain_membership dm
                  WHERE dm.source_id = s.id
                  ORDER BY dm.confidence DESC
                  LIMIT 1
                ) as domainId
         FROM kb_chunks c
         JOIN kb_sources s ON s.id = c.source_id
         WHERE (c.text LIKE ? OR s.title LIKE ?)
         ${filter.sql}
         ORDER BY c.ord ASC
         LIMIT ?`
      )
      .all(like, like, ...filter.args, limit) as typeof rows
  }

  const kbHits = rows.map((row) => {
    const snippet = row.text.replace(/\s+/g, ' ').trim().slice(0, 220)
    const lexicalScore = Number(row.lexicalScore) || 0
    const semanticScore =
      semanticSignalFromOverlap(queryTokens, row.text, row.heading) * 0.35 +
      graphSemanticBoost(graphWeights, row.text, row.heading)
    return {
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
      chunkId: row.chunkId,
      text: row.text,
      snippet: snippet.length < row.text.length ? `${snippet}…` : snippet,
      heading: row.heading,
      passageTitle: row.passageTitle,
      anchor: row.anchor,
      ord: row.ord,
      domainId: row.domainId ?? undefined,
      lexicalScore,
      semanticScore,
      finalScore: lexicalScore + semanticScore
    }
  })

  const includeMemory = !options.domainIds || options.domainIds.length === 0
  if (!includeMemory) return kbHits
  if (!tableExists(db, 'claude_memory_rag_units') || !tableExists(db, 'claude_memory_rag_units_fts')) return kbHits

  const memRows = db
    .prepare(
      `SELECT u.id as unitId,
              u.session_id as sessionId,
              u.event_id as eventId,
              u.text as text,
              u.title as title,
              u.ord as ord,
              (-1.0 * bm25(f)) as lexicalScore
       FROM claude_memory_rag_units_fts f
       JOIN claude_memory_rag_units u ON u.id = f.unit_id
       WHERE f MATCH ?
       ORDER BY lexicalScore DESC
       LIMIT ?`
    )
    .all(fts, Math.max(1, Math.floor(limit / 2))) as Array<{
    unitId: string
    sessionId: string
    eventId: string
    text: string
    title: string
    ord: number
    lexicalScore: number
  }>

  const memoryHits: RetrievalHit[] = memRows.map((row) => {
    const snippet = row.text.replace(/\s+/g, ' ').trim().slice(0, 220)
    const lexicalScore = Number(row.lexicalScore) || 0
    const semanticScore =
      semanticSignalFromOverlap(queryTokens, row.text, row.title) * 0.28 +
      graphSemanticBoost(graphWeights, row.text, row.title)
    return {
      sourceId: `memory-session:${row.sessionId}`,
      sourceTitle: `Memory ${row.sessionId.slice(0, 8)}`,
      chunkId: row.unitId,
      text: row.text,
      snippet: snippet.length < row.text.length ? `${snippet}…` : snippet,
      heading: row.title,
      passageTitle: `Session ${row.sessionId.slice(0, 8)} event ${row.eventId.slice(0, 8)}`,
      anchor: null,
      ord: row.ord,
      lexicalScore,
      semanticScore,
      finalScore: lexicalScore + semanticScore + 0.05
    }
  })

  return [...kbHits, ...memoryHits].sort((a, b) => b.finalScore - a.finalScore).slice(0, limit)
}

export function retrieveKbHits(db: Database.Database, options: RetrievalQueryOptions): KbSearchHit[] {
  const rows = retrieveChunks(db, { ...options, limit: Math.max(options.limit * 4, options.limit) })
  const dedup = new Map<string, RetrievalHit>()
  for (const row of rows) {
    const current = dedup.get(row.sourceId)
    if (!current || row.finalScore > current.finalScore) dedup.set(row.sourceId, row)
  }
  return [...dedup.values()]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, options.limit)
    .map((row) => ({
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
      chunkId: row.chunkId,
      heading: row.heading ?? null,
      snippet: row.snippet,
      kind: 'document',
      domainId: row.domainId,
      score: Number(row.finalScore.toFixed(4)),
      citation: {
        passageTitle: row.passageTitle ?? null,
        anchor: row.anchor ?? null,
        ord: row.ord
      }
    }))
}
