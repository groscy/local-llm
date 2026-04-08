import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import type { KbChunk, KbSource, WikiTopic } from '@shared/types'

const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 200

function chunkText(text: string, heading?: string): { text: string; heading?: string }[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const parts: { text: string; heading?: string }[] = []
  let i = 0
  while (i < normalized.length) {
    const end = Math.min(i + CHUNK_SIZE, normalized.length)
    const slice = normalized.slice(i, end)
    parts.push({ text: slice, heading })
    if (end >= normalized.length) break
    i = end - CHUNK_OVERLAP
    if (i < 0) i = 0
  }
  return parts
}

export function ingestText(
  db: Database.Database,
  title: string,
  uri: string,
  body: string,
  heading?: string,
  conversationId?: string | null
): KbSource {
  const sourceId = randomUUID()
  const t = Date.now()
  db.prepare(
    'INSERT INTO kb_sources (id, title, uri, created_at, conversation_id) VALUES (?, ?, ?, ?, ?)'
  ).run(sourceId, title, uri, t, conversationId ?? null)
  const chunks = chunkText(body, heading)
  let ord = 0
  const ins = db.prepare(
    `INSERT INTO kb_chunks (id, source_id, ord, heading, text) VALUES (?, ?, ?, ?, ?)`
  )
  for (const c of chunks) {
    const cid = randomUUID()
    ins.run(cid, sourceId, ord++, c.heading ?? null, c.text)
  }
  return { id: sourceId, title, uri, createdAt: t }
}

export function ingestFile(db: Database.Database, filePath: string, title?: string): KbSource {
  const raw = readFileSync(filePath, 'utf8')
  const name = title ?? filePath.split(/[/\\]/).pop() ?? filePath
  return ingestText(db, name, `file://${filePath}`, raw, undefined, null)
}

/** Chunk and index the full message thread of a conversation into the knowledge base (linked for later bulk delete). */
export function ingestConversationThread(db: Database.Database, conversationId: string): KbSource {
  const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as
    | { title: string }
    | undefined
  if (!conv) throw new Error('Conversation not found')
  const rows = db
    .prepare(
      `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as { role: string; content: string }[]
  if (rows.length === 0) throw new Error('No messages to save')
  const body = rows.map((r) => `### ${r.role}\n\n${r.content}`).join('\n\n---\n\n')
  const title = `Chat: ${conv.title}`
  const uri = `chat:${conversationId}`
  return ingestText(db, title, uri, body, undefined, conversationId)
}

/** Remove one KB source and its wiki links, chunks, and FTS rows (via triggers). */
export function deleteKbSource(db: Database.Database, sourceId: string): void {
  const chunkIds = db.prepare('SELECT id FROM kb_chunks WHERE source_id = ?').all(sourceId) as { id: string }[]
  const delWpcByChunk = db.prepare('DELETE FROM wiki_page_chunks WHERE chunk_id = ?')
  for (const r of chunkIds) delWpcByChunk.run(r.id)
  const pageId = `src:${sourceId}`
  db.prepare('DELETE FROM wiki_page_chunks WHERE page_id = ?').run(pageId)
  db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(pageId)
  db.prepare('DELETE FROM kb_sources WHERE id = ?').run(sourceId)
}

/** Delete all knowledge sources tied to a conversation (from "Save chat to wiki"). */
export function deleteKbSourcesForConversation(db: Database.Database, conversationId: string): number {
  const sources = db
    .prepare('SELECT id FROM kb_sources WHERE conversation_id = ?')
    .all(conversationId) as { id: string }[]
  for (const { id } of sources) deleteKbSource(db, id)
  return sources.length
}

function ftsEscape(q: string): string {
  const parts = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '')}"`)
  return parts.join(' AND ')
}

export function searchChunks(db: Database.Database, query: string, limit: number): KbChunk[] {
  const fts = ftsEscape(query)
  if (!fts) return []
  try {
    const rows = db
      .prepare(
        `SELECT c.id, c.source_id as sourceId, c.text, c.heading, c.ord
         FROM kb_chunks_fts f
         JOIN kb_chunks c ON c.id = f.chunk_id
         WHERE f MATCH ?
         ORDER BY bm25(f) LIMIT ?`
      )
      .all(fts, limit) as KbChunk[]
    return rows
  } catch {
    return db
      .prepare(
        `SELECT id, source_id as sourceId, text, heading, ord FROM kb_chunks
         WHERE text LIKE ? ORDER BY ord LIMIT ?`
      )
      .all(`%${query.replace(/%/g, '')}%`, limit) as KbChunk[]
  }
}

export function listSources(db: Database.Database): KbSource[] {
  return db
    .prepare(
      `SELECT id, title, uri, created_at as createdAt, conversation_id as conversationId
       FROM kb_sources ORDER BY created_at DESC`
    )
    .all() as KbSource[]
}

export function listChunksForSource(db: Database.Database, sourceId: string): KbChunk[] {
  return db
    .prepare(
      'SELECT id, source_id as sourceId, text, heading, ord FROM kb_chunks WHERE source_id = ? ORDER BY ord'
    )
    .all(sourceId) as KbChunk[]
}

/** Topic = source title with chunk count (wiki index). */
export function listWikiTopics(db: Database.Database): WikiTopic[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.title, COUNT(c.id) as chunkCount
       FROM kb_sources s
       LEFT JOIN kb_chunks c ON c.source_id = s.id
       GROUP BY s.id, s.title
       ORDER BY s.created_at DESC`
    )
    .all() as { id: string; title: string; chunkCount: number }[]
  return rows.map((r) => ({ ...r, chunkCount: Number(r.chunkCount) }))
}

export function getWikiPageBody(db: Database.Database, sourceId: string): string {
  const chunks = listChunksForSource(db, sourceId)
  return chunks.map((c, i) => `## Section ${i + 1}${c.heading ? `: ${c.heading}` : ''}\n\n${c.text}`).join('\n\n---\n\n')
}

export function ensureWikiPageForSource(db: Database.Database, sourceId: string): { id: string; title: string; body: string } {
  const s = db.prepare('SELECT id, title FROM kb_sources WHERE id = ?').get(sourceId) as
    | { id: string; title: string }
    | undefined
  if (!s) throw new Error('source not found')
  const body = getWikiPageBody(db, sourceId)
  const t = Date.now()
  const existing = db.prepare('SELECT id FROM wiki_pages WHERE id = ?').get(`src:${sourceId}`) as { id: string } | undefined
  if (existing) {
    db.prepare('UPDATE wiki_pages SET body = ?, title = ?, updated_at = ? WHERE id = ?').run(
      body,
      s.title,
      t,
      existing.id
    )
    return { id: existing.id, title: s.title, body }
  }
  const pageId = `src:${sourceId}`
  db.prepare(
    'INSERT INTO wiki_pages (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(pageId, s.title, body, t, t)
  const chs = db.prepare('SELECT id FROM kb_chunks WHERE source_id = ?').all(sourceId) as { id: string }[]
  const link = db.prepare('INSERT OR IGNORE INTO wiki_page_chunks (page_id, chunk_id) VALUES (?, ?)')
  for (const c of chs) link.run(pageId, c.id)
  return { id: pageId, title: s.title, body }
}
