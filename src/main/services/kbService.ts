import { randomUUID } from 'crypto'
import { createWriteStream, readFileSync } from 'fs'
import { finished } from 'stream/promises'
import archiver from 'archiver'
import type Database from 'better-sqlite3'
import { extractWikiGlossary } from '@shared/wikiArticleExtras'
import type {
  KbChunk,
  KbSearchHit,
  KbSource,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphPayload,
  WikiChatHighlightTerm,
  WikiPagePayload,
  WikiRelatedSource,
  WikiSourceKind,
  WikiTopic
} from '@shared/types'

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

const KB_HIT_SNIPPET_MAX = 220

function kbHitSnippet(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= KB_HIT_SNIPPET_MAX) return s
  return `${s.slice(0, KB_HIT_SNIPPET_MAX - 1)}…`
}

function wikiKindFromUri(uri: string): WikiSourceKind {
  const u = uri.toLowerCase()
  if (u.startsWith('file:')) return 'document'
  if (u.startsWith('wiki-extract:')) return 'extracted_note'
  if (u.startsWith('chat:')) return 'saved_chat'
  return 'other'
}

type KbSearchRow = {
  id: string
  sourceId: string
  sourceTitle: string
  uri: string
  text: string
  heading: string | null
  ord: number
}

/**
 * Full-text search across chunks; returns at most one row per source (best BM25 chunk),
 * with source title and a short snippet for the wiki library UI.
 */
export function searchKbHits(db: Database.Database, query: string, limit: number): KbSearchHit[] {
  const fts = ftsEscape(query)
  if (!fts) return []
  const rawCap = Math.min(200, Math.max(limit * 6, limit))
  let rows: KbSearchRow[] = []
  try {
    rows = db
      .prepare(
        `SELECT c.id, c.source_id as sourceId, s.title as sourceTitle, s.uri as uri, c.text, c.heading as heading, c.ord
         FROM kb_chunks_fts f
         JOIN kb_chunks c ON c.id = f.chunk_id
         JOIN kb_sources s ON s.id = c.source_id
         WHERE f MATCH ?
         ORDER BY bm25(f) LIMIT ?`
      )
      .all(fts, rawCap) as KbSearchRow[]
  } catch {
    const safe = query.replace(/%/g, '').replace(/_/g, '')
    const like = `%${safe}%`
    rows = db
      .prepare(
        `SELECT c.id, c.source_id as sourceId, s.title as sourceTitle, s.uri as uri, c.text, c.heading as heading, c.ord
         FROM kb_chunks c
         JOIN kb_sources s ON s.id = c.source_id
         WHERE c.text LIKE ? OR s.title LIKE ?
         ORDER BY c.ord LIMIT ?`
      )
      .all(like, like, rawCap) as KbSearchRow[]
  }
  const seen = new Set<string>()
  const out: KbSearchHit[] = []
  for (const r of rows) {
    if (seen.has(r.sourceId)) continue
    seen.add(r.sourceId)
    out.push({
      sourceId: r.sourceId,
      sourceTitle: r.sourceTitle,
      chunkId: r.id,
      heading: r.heading,
      snippet: kbHitSnippet(r.text),
      kind: wikiKindFromUri(r.uri)
    })
    if (out.length >= limit) break
  }
  return out
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

const WIKI_HIGHLIGHT_SNIPPET_MAX = 220
const WIKI_HIGHLIGHT_PHRASE_MIN = 3
const WIKI_HIGHLIGHT_PHRASE_MAX = 200
const WIKI_HIGHLIGHT_MAX_TERMS = 600

function clipHighlightSnippet(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= WIKI_HIGHLIGHT_SNIPPET_MAX) return s
  return `${s.slice(0, WIKI_HIGHLIGHT_SNIPPET_MAX - 1)}…`
}

/**
 * Collect phrases that appear in the knowledge base so chat bubbles can link to wiki articles:
 * source titles (and "Chat:" title suffix), non-empty chunk headings, and `::: glossary` terms
 * from compiled wiki page bodies when present.
 */
export function listWikiChatHighlightTerms(db: Database.Database): WikiChatHighlightTerm[] {
  const out: WikiChatHighlightTerm[] = []
  const seen = new Set<string>()

  const push = (sourceId: string, phrase: string, snippet: string): void => {
    const p = phrase.trim()
    if (p.length < WIKI_HIGHLIGHT_PHRASE_MIN || p.length > WIKI_HIGHLIGHT_PHRASE_MAX) return
    const k = `${sourceId}\0${p.toLowerCase()}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ sourceId, phrase: p, snippet: clipHighlightSnippet(snippet) })
  }

  const sources = db.prepare('SELECT id, title FROM kb_sources').all() as { id: string; title: string }[]
  for (const s of sources) {
    const title = (s.title ?? '').trim()
    if (!title) continue

    push(s.id, title, `Wiki: ${title}`)

    const chatStripped = title.replace(/^Chat:\s*/i, '').trim()
    if (chatStripped.length >= WIKI_HIGHLIGHT_PHRASE_MIN && chatStripped.toLowerCase() !== title.toLowerCase()) {
      push(s.id, chatStripped, `Saved chat: ${title}`)
    }

    const noteStripped = title.replace(/^Note:\s*/i, '').trim()
    if (
      noteStripped.length >= WIKI_HIGHLIGHT_PHRASE_MIN &&
      noteStripped.toLowerCase() !== title.toLowerCase() &&
      noteStripped.toLowerCase() !== chatStripped.toLowerCase()
    ) {
      push(s.id, noteStripped, `Chat note: ${title}`)
    }
  }

  const chunkHeadings = db
    .prepare(
      `SELECT source_id as sourceId, heading, text FROM kb_chunks
       WHERE heading IS NOT NULL AND TRIM(heading) != ''`
    )
    .all() as { sourceId: string; heading: string; text: string }[]

  for (const c of chunkHeadings) {
    push(c.sourceId, c.heading, c.text || c.heading)
  }

  const pages = db.prepare('SELECT id, body FROM wiki_pages WHERE id LIKE ?').all('src:%') as {
    id: string
    body: string
  }[]

  for (const page of pages) {
    const sourceId = page.id.startsWith('src:') ? page.id.slice(4) : ''
    if (!sourceId) continue
    const { glossary } = extractWikiGlossary(page.body ?? '')
    for (const g of glossary) {
      push(sourceId, g.term, g.definition || g.term)
    }
  }

  out.sort((a, b) => b.phrase.length - a.phrase.length)
  const capped = out.slice(0, WIKI_HIGHLIGHT_MAX_TERMS)
  return enrichWikiHighlightTermsWithKnowledgeGraph(capped, db)
}

/** Topic = source title with chunk count and kind (wiki index). */
export function listWikiTopics(db: Database.Database): WikiTopic[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.uri, COUNT(c.id) as chunkCount
       FROM kb_sources s
       LEFT JOIN kb_chunks c ON c.source_id = s.id
       GROUP BY s.id, s.title, s.uri
       ORDER BY s.created_at DESC`
    )
    .all() as { id: string; title: string; uri: string; chunkCount: number }[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    chunkCount: Number(r.chunkCount),
    kind: wikiKindFromUri(r.uri)
  }))
}

export function getWikiPageBody(db: Database.Database, sourceId: string): string {
  const chunks = listChunksForSource(db, sourceId)
  return chunks.map((c, i) => `## Section ${i + 1}${c.heading ? `: ${c.heading}` : ''}\n\n${c.text}`).join('\n\n---\n\n')
}

const GRAPH_MAX_CHUNKS_PER_SOURCE = 18
const GRAPH_MAX_TOTAL_CHUNKS = 200

function tokenizeTitle(title: string): string[] {
  const raw = title.toLowerCase().match(/[a-z0-9]{4,}/g)
  return raw ? [...new Set(raw)] : []
}

/**
 * Build a structural knowledge graph: KB sources linked to chunk nodes, wiki pages linked to chunks,
 * wiki pages tied to their source when `page_id` is `src:<sourceId>`, and weak `related` edges between
 * sources that share a long token in their titles.
 */
export function getKnowledgeGraph(db: Database.Database): KnowledgeGraphPayload {
  const sources = db
    .prepare(`SELECT id, title FROM kb_sources ORDER BY created_at ASC`)
    .all() as { id: string; title: string }[]

  const nodes: KnowledgeGraphNode[] = []
  const edges: KnowledgeGraphEdge[] = []
  let truncated = false
  let chunksUsed = 0

  for (const s of sources) {
    nodes.push({ id: s.id, kind: 'source', label: s.title })
  }

  const chunkStmt = db.prepare(
    `SELECT id, source_id as sourceId, ord, heading FROM kb_chunks WHERE source_id = ? ORDER BY ord ASC`
  )

  for (const s of sources) {
    if (chunksUsed >= GRAPH_MAX_TOTAL_CHUNKS) {
      truncated = true
      break
    }
    const rows = chunkStmt.all(s.id) as { id: string; sourceId: string; ord: number; heading: string | null }[]
    const cap = Math.min(GRAPH_MAX_CHUNKS_PER_SOURCE, GRAPH_MAX_TOTAL_CHUNKS - chunksUsed)
    const slice = rows.slice(0, cap)
    if (rows.length > slice.length) truncated = true
    for (const r of slice) {
      const ordLabel = `#${r.ord + 1}`
      const sub =
        r.heading && r.heading.trim()
          ? r.heading.trim().slice(0, 42) + (r.heading.trim().length > 42 ? '…' : '')
          : undefined
      nodes.push({
        id: r.id,
        kind: 'chunk',
        label: ordLabel,
        sublabel: sub,
        sourceId: s.id
      })
      edges.push({ from: s.id, to: r.id, kind: 'contains' })
      chunksUsed++
    }
  }

  const wikiRows = db.prepare(`SELECT id, title FROM wiki_pages`).all() as { id: string; title: string }[]
  for (const w of wikiRows) {
    nodes.push({ id: w.id, kind: 'wiki', label: w.title })
  }

  const linkRows = db
    .prepare(`SELECT page_id as pageId, chunk_id as chunkId FROM wiki_page_chunks`)
    .all() as { pageId: string; chunkId: string }[]

  const chunkIds = new Set(nodes.filter((n) => n.kind === 'chunk').map((n) => n.id))
  for (const l of linkRows) {
    if (!chunkIds.has(l.chunkId)) continue
    edges.push({ from: l.pageId, to: l.chunkId, kind: 'indexes' })
  }

  const sourceIdSet = new Set(sources.map((s) => s.id))
  for (const w of wikiRows) {
    if (w.id.startsWith('src:')) {
      const sid = w.id.slice(4)
      if (sourceIdSet.has(sid)) {
        edges.push({ from: w.id, to: sid, kind: 'compiled_from' })
      }
    }
  }

  const titleTokens = new Map<string, string[]>()
  for (const s of sources) {
    titleTokens.set(s.id, tokenizeTitle(s.title))
  }
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = titleTokens.get(sources[i].id) ?? []
      const b = titleTokens.get(sources[j].id) ?? []
      if (a.length === 0 || b.length === 0) continue
      const shared = a.some((t) => b.includes(t))
      if (shared) {
        edges.push({ from: sources[i].id, to: sources[j].id, kind: 'related' })
      }
    }
  }

  return { nodes, edges, truncated }
}

const KG_HIGHLIGHT_RELATED_MAX = 4

/**
 * Adds knowledge-graph context for assistant-message keyword tooltips (structured KB + relations).
 */
function enrichWikiHighlightTermsWithKnowledgeGraph(
  terms: WikiChatHighlightTerm[],
  db: Database.Database
): WikiChatHighlightTerm[] {
  if (terms.length === 0) return terms
  const kg = getKnowledgeGraph(db)
  const nodeById = new Map<string, KnowledgeGraphNode>()
  for (const n of kg.nodes) nodeById.set(n.id, n)

  const relatedBySource = new Map<string, Set<string>>()
  for (const e of kg.edges) {
    if (e.kind !== 'related') continue
    const a = nodeById.get(e.from)
    const b = nodeById.get(e.to)
    if (a?.kind !== 'source' || b?.kind !== 'source') continue
    if (!relatedBySource.has(e.from)) relatedBySource.set(e.from, new Set())
    if (!relatedBySource.has(e.to)) relatedBySource.set(e.to, new Set())
    relatedBySource.get(e.from)!.add(b.label)
    relatedBySource.get(e.to)!.add(a.label)
  }

  const chunkCountBySource = new Map<string, number>()
  for (const e of kg.edges) {
    if (e.kind !== 'contains') continue
    const ch = nodeById.get(e.to)
    if (ch?.kind === 'chunk') {
      chunkCountBySource.set(e.from, (chunkCountBySource.get(e.from) ?? 0) + 1)
    }
  }

  const wikiCompiledSources = new Set<string>()
  for (const e of kg.edges) {
    if (e.kind === 'compiled_from') wikiCompiledSources.add(e.to)
  }

  return terms.map((t) => {
    if (!nodeById.has(t.sourceId)) return t
    const parts: string[] = []
    const nCh = chunkCountBySource.get(t.sourceId) ?? 0
    if (nCh > 0) {
      parts.push(`${nCh} chunk${nCh === 1 ? '' : 's'} in the knowledge graph`)
    }
    if (wikiCompiledSources.has(t.sourceId)) {
      parts.push('wiki article compiled from this source')
    }
    const rel = relatedBySource.get(t.sourceId)
    const relList = rel ? [...rel].slice(0, KG_HIGHLIGHT_RELATED_MAX) : []
    if (relList.length > 0) {
      parts.push(`related: ${relList.join(' · ')}`)
    }
    if (kg.truncated && nCh > 0) {
      parts.push('graph shows a subset of chunks')
    }
    const graphSummary = parts.length > 0 ? parts.join(' · ') : 'Linked in your knowledge graph'
    return { ...t, graphSummary }
  })
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

const RELATED_CHUNK_SAMPLE = 3
const RELATED_BODY_CAP = 12_000

/** Other sources that share topical tokens with this article (title + first chunks). */
export function listRelatedWikiSources(
  db: Database.Database,
  sourceId: string,
  limit: number
): WikiRelatedSource[] {
  const self = db.prepare('SELECT id, title, uri FROM kb_sources WHERE id = ?').get(sourceId) as
    | { id: string; title: string; uri: string }
    | undefined
  if (!self) return []

  const chunkStmt = db.prepare(
    `SELECT text FROM kb_chunks WHERE source_id = ? ORDER BY ord LIMIT ${RELATED_CHUNK_SAMPLE}`
  )
  function tokensFor(sid: string, title: string): Set<string> {
    const rows = chunkStmt.all(sid) as { text: string }[]
    const blob = `${title}\n${rows.map((r) => r.text).join('\n')}`.slice(0, RELATED_BODY_CAP)
    const raw = blob.toLowerCase().match(/[a-z0-9]{4,}/g)
    return new Set(raw ?? [])
  }

  const selfTokens = tokensFor(sourceId, self.title)
  if (selfTokens.size === 0) return []

  const others = db
    .prepare('SELECT id, title, uri FROM kb_sources WHERE id != ?')
    .all(sourceId) as { id: string; title: string; uri: string }[]

  const scored: { o: (typeof others)[0]; shared: string[]; score: number }[] = []
  for (const o of others) {
    const oTokens = tokensFor(o.id, o.title)
    const shared = [...oTokens].filter((t) => selfTokens.has(t))
    if (shared.length === 0) continue
    scored.push({ o, shared, score: shared.length })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ o, shared }) => ({
    id: o.id,
    title: o.title,
    kind: wikiKindFromUri(o.uri),
    sharedTerms: [...shared].sort((x, y) => y.length - x.length || x.localeCompare(y)).slice(0, 8)
  }))
}

/** Sync wiki page row, then return payload for the renderer (glossary stripped from body). */
export function buildWikiPagePayload(db: Database.Database, sourceId: string): WikiPagePayload {
  const page = ensureWikiPageForSource(db, sourceId)
  const { body, glossary } = extractWikiGlossary(page.body)
  return {
    id: page.id,
    title: page.title,
    body,
    glossary,
    relatedSources: listRelatedWikiSources(db, sourceId, 12)
  }
}

function safeWikiExportFileStem(title: string): string {
  return (
    title
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 72) || 'untitled'
  )
}

function uniqueWikiExportFileName(title: string, sourceId: string, used: Set<string>): string {
  const base = safeWikiExportFileStem(title)
  let name = `${base}__${sourceId.slice(0, 8)}.md`
  let n = 1
  const key = (): string => name.toLowerCase()
  while (used.has(key())) {
    name = `${base}__${sourceId.slice(0, 8)}_${n++}.md`
  }
  used.add(key())
  return name
}

/** Write all KB sources as Markdown (compiled from chunks) plus manifest into a ZIP at `outPath`. */
export async function exportWikiZip(db: Database.Database, outPath: string): Promise<void> {
  const rows = db
    .prepare(
      `SELECT id, title, uri, created_at as createdAt, conversation_id as conversationId
       FROM kb_sources ORDER BY created_at ASC`
    )
    .all() as {
      id: string
      title: string
      uri: string
      createdAt: number
      conversationId: string | null
    }[]

  const output = createWriteStream(outPath)
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })

  const outputClosed = finished(output)
  archive.pipe(output)

  const usedNames = new Set<string>()
  const manifestSources: {
    id: string
    title: string
    uri: string
    kind: WikiSourceKind
    file: string
    createdAt: number
    conversationId: string | null
  }[] = []

  for (const s of rows) {
    const fileName = uniqueWikiExportFileName(s.title, s.id, usedNames)
    const zipPath = `wiki-sources/${fileName}`
    const body = getWikiPageBody(db, s.id)
    const h1 = s.title.replace(/\r?\n/g, ' ').trim() || 'Untitled'
    const md = `# ${h1}\n\n${body}\n`
    archive.append(md, { name: zipPath })
    manifestSources.push({
      id: s.id,
      title: s.title,
      uri: s.uri,
      kind: wikiKindFromUri(s.uri),
      file: zipPath,
      createdAt: s.createdAt,
      conversationId: s.conversationId
    })
  }

  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'local-llm-desktop',
    sourceCount: manifestSources.length,
    sources: manifestSources
  }
  archive.append(JSON.stringify(manifest, null, 2), { name: 'wiki-manifest.json' })
  archive.append(
    [
      '# Wiki export',
      '',
      'Generated by **Local LLM Desktop**. Each file under `wiki-sources/` matches the compiled wiki body shown in the app (sections built from indexed chunks).',
      '',
      'Metadata: `wiki-manifest.json` (ids, URIs, kinds, timestamps).',
      ''
    ].join('\n'),
    { name: 'README.md' }
  )

  await archive.finalize()
  await outputClosed
}
