import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'

const STOPWORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'there',
  'their',
  'about',
  'which',
  'were',
  'have',
  'into',
  'would',
  'could',
  'should'
])

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((t) => !STOPWORDS.has(t))
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'general-domain'
  )
}

export function analyzeSourceDomains(db: Database.Database, sourceId: string): string[] {
  const source = db
    .prepare('SELECT id, title FROM kb_sources WHERE id = ? LIMIT 1')
    .get(sourceId) as { id: string; title: string } | undefined
  if (!source) return []
  const chunks = db
    .prepare('SELECT text FROM kb_chunks WHERE source_id = ? ORDER BY ord LIMIT 12')
    .all(sourceId) as Array<{ text: string }>
  const tokenScores = new Map<string, number>()
  for (const token of tokenize(`${source.title}\n${chunks.map((c) => c.text).join('\n')}`)) {
    tokenScores.set(token, (tokenScores.get(token) ?? 0) + 1)
  }
  const topTerms = [...tokenScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term)
  if (topTerms.length === 0) return []
  const primary = topTerms[0]!
  const domainSlug = slugify(primary)
  const now = Date.now()
  const existing = db
    .prepare('SELECT id FROM kb_domains WHERE slug = ? LIMIT 1')
    .get(domainSlug) as { id: string } | undefined
  const domainId = existing?.id ?? randomUUID()
  if (!existing) {
    db.prepare(
      `INSERT INTO kb_domains (id, slug, title, summary, confidence, centroid_terms_json, source_count, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      domainId,
      domainSlug,
      primary.replace(/\b\w/g, (c) => c.toUpperCase()),
      `Auto-detected domain around "${primary}"`,
      0.62,
      JSON.stringify(topTerms),
      now,
      now
    )
  } else {
    db.prepare(
      'UPDATE kb_domains SET centroid_terms_json = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(topTerms), now, domainId)
  }
  db.prepare(
    `INSERT INTO kb_domain_membership (source_id, domain_id, confidence, rationale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, domain_id) DO UPDATE SET
       confidence = excluded.confidence,
       rationale = excluded.rationale,
       updated_at = excluded.updated_at`
  ).run(sourceId, domainId, 0.62, `Shared terms: ${topTerms.join(', ')}`, now, now)

  db.prepare(
    `UPDATE kb_domains
     SET source_count = (SELECT COUNT(*) FROM kb_domain_membership WHERE domain_id = kb_domains.id),
         updated_at = ?
     WHERE id = ?`
  ).run(now, domainId)

  const domainChunks = db
    .prepare(
      `SELECT c.id as chunkId, c.text
       FROM kb_chunks c
       JOIN kb_domain_membership m ON m.source_id = c.source_id
       WHERE m.domain_id = ?
       ORDER BY c.ord
       LIMIT 8`
    )
    .all(domainId) as Array<{ chunkId: string; text: string }>
  const body = domainChunks.map((c, idx) => `### Evidence ${idx + 1}\n\n${c.text.trim()}`).join('\n\n')
  const unitId = `${domainId}:core`
  db.prepare(
    `INSERT INTO kb_domain_retrieval_units
      (id, domain_id, title, body, source_ids_json, chunk_ids_json, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       body = excluded.body,
       source_ids_json = excluded.source_ids_json,
       chunk_ids_json = excluded.chunk_ids_json,
       updated_at = excluded.updated_at`
  ).run(
    unitId,
    domainId,
    `${primary.replace(/\b\w/g, (c) => c.toUpperCase())} domain context`,
    body || 'No domain context has been assembled yet.',
    JSON.stringify([sourceId]),
    JSON.stringify(domainChunks.map((c) => c.chunkId)),
    now,
    now
  )
  return [domainId]
}
