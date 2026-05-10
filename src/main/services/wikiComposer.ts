import type Database from 'better-sqlite3'
import { extractWikiGlossary, WIKI_REFERENCE_SECTION_MARKDOWN } from '@shared/wikiArticleExtras'

function compactSnippet(text: string, max = 320): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 1)}…`
}

function gatherEvidenceClaims(chunks: Array<{ heading?: string | null; text: string; anchor?: string | null }>): string[] {
  const out: string[] = []
  for (const [idx, chunk] of chunks.slice(0, 6).entries()) {
    const title = chunk.heading?.trim() || `Claim ${idx + 1}`
    const snippet = compactSnippet(chunk.text, 200)
    const anchor = chunk.anchor?.trim() || `passage-${idx + 1}`
    out.push(`- **${title}** — ${snippet} ([source](#${anchor}))`)
  }
  return out.length > 0 ? out : ['- No strong claims extracted yet.']
}

function listChunksForSourceLite(db: Database.Database, sourceId: string): Array<{
  id: string
  heading: string | null
  passageTitle: string | null
  text: string
  anchor: string | null
  ord: number
}> {
  return db
    .prepare(
      `SELECT id, heading, passage_title as passageTitle, text, anchor, ord
       FROM kb_chunks WHERE source_id = ? ORDER BY ord`
    )
    .all(sourceId) as Array<{
    id: string
    heading: string | null
    passageTitle: string | null
    text: string
    anchor: string | null
    ord: number
  }>
}

function listRelatedSourcesLite(db: Database.Database, sourceId: string, limit: number): Array<{ title: string; kind: string }> {
  const self = db.prepare('SELECT id, title FROM kb_sources WHERE id = ?').get(sourceId) as
    | { id: string; title: string }
    | undefined
  if (!self) return []
  const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
  const selfTokens = tokenize(self.title)
  if (selfTokens.size === 0) return []
  const rows = db
    .prepare('SELECT id, title, uri FROM kb_sources WHERE id != ? ORDER BY created_at DESC LIMIT 180')
    .all(sourceId) as Array<{ id: string; title: string; uri: string }>
  return rows
    .map((row) => {
      const shared = [...tokenize(row.title)].filter((token) => selfTokens.has(token)).length
      return { title: row.title, kind: row.uri.startsWith('chat:') ? 'saved_chat' : 'document', shared }
    })
    .filter((row) => row.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, Math.max(1, limit))
    .map((row) => ({ title: row.title, kind: row.kind }))
}

export function composeWikiReadModel(db: Database.Database, sourceId: string): string {
  const source = db
    .prepare('SELECT id, title FROM kb_sources WHERE id = ? LIMIT 1')
    .get(sourceId) as { id: string; title: string } | undefined
  if (!source) throw new Error('source not found')
  const chunks = listChunksForSourceLite(db, sourceId)
  const lead = chunks[0]?.text?.trim() || 'No indexed text is available for this source yet.'
  const related = listRelatedSourcesLite(db, sourceId, 10)
  const relatedMd =
    related.length > 0
      ? related.map((item) => `- **${item.title}** (${item.kind})`).join('\n')
      : '- No related sources were detected yet.'
  const claims = gatherEvidenceClaims(chunks)
  const openQuestions =
    chunks.length < 2
      ? '- What additional primary sources should be ingested?'
      : '- Which claims require stronger cross-document evidence?'
  const citations =
    chunks.length > 0
      ? chunks
          .slice(0, 12)
          .map((chunk, idx) => {
            const heading = chunk.passageTitle?.trim() || chunk.heading?.trim() || `Passage ${idx + 1}`
            const anchor = chunk.anchor?.trim() || `passage-${idx + 1}`
            return `- ${heading} ([jump](#${anchor}))`
          })
          .join('\n')
      : '- No passage citations are available.'
  const glossary = extractWikiGlossary(
    `::: glossary\n**${source.title.replace(/\*/g, "'")}** — ${compactSnippet(lead, 260)}\n:::`
  ).glossary

  const glossaryBlock =
    glossary.length > 0
      ? `::: glossary\n${glossary.map((g) => `**${g.term}** — ${g.definition}`).join('\n')}\n:::`
      : `::: glossary\n**${source.title.replace(/\*/g, "'")}** — ${compactSnippet(lead, 260)}\n:::`

  return [
    glossaryBlock,
    '',
    '## Summary',
    '',
    compactSnippet(lead, 560),
    '',
    WIKI_REFERENCE_SECTION_MARKDOWN.practice,
    '',
    chunks.length > 0
      ? chunks
          .slice(0, 4)
          .map((chunk, idx) => {
            const heading = chunk.passageTitle?.trim() || chunk.heading?.trim() || `Passage ${idx + 1}`
            const anchor = chunk.anchor?.trim() || `passage-${idx + 1}`
            return `### ${heading}\n<a id="${anchor}"></a>\n\n${chunk.text.trim()}`
          })
          .join('\n\n---\n\n')
      : 'No practice/context passages available.',
    '',
    '## Evidence-backed Claims',
    '',
    claims.join('\n'),
    '',
    WIKI_REFERENCE_SECTION_MARKDOWN.related,
    '',
    relatedMd,
    '',
    '## Open Questions',
    '',
    openQuestions,
    '',
    '## Citations',
    '',
    citations,
    '',
    WIKI_REFERENCE_SECTION_MARKDOWN.notes,
    '',
    chunks.length > 4
      ? chunks
          .slice(4, 10)
          .map((chunk, idx) => `### Note ${idx + 1}\n\n${compactSnippet(chunk.text, 360)}`)
          .join('\n\n')
      : 'No additional notes were extracted.',
    ''
  ].join('\n')
}
