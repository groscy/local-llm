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

export function retrieveChunks(db: Database.Database, options: RetrievalQueryOptions): RetrievalHit[] {
  const fts = ftsEscape(options.query)
  if (!fts) return []
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

  return rows.map((row) => {
    const snippet = row.text.replace(/\s+/g, ' ').trim().slice(0, 220)
    const lexicalScore = Number(row.lexicalScore) || 0
    const semanticScore = Math.min(1, snippet.length / 220) * 0.35
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
