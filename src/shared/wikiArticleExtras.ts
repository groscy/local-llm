import type { WikiGlossaryEntry } from './types'

/** Markdown `## …` headings for auto-compiled reference wiki pages (keep in sync with archivist / deep-learn prompts). */
export const WIKI_REFERENCE_SECTION_MARKDOWN = {
  practice: '## Practice and context',
  related: '## Related concepts',
  notes: '## Notes and caveats'
} as const

/**
 * Remove legacy machine slot tags from compiled wiki Markdown (inline code `wiki:…`).
 * Used when serving pages so older `wiki_pages` rows never show internal control tokens.
 */
export function stripWikiControlMarkers(raw: string): string {
  if (!raw) return raw
  const s = raw.replace(/`wiki:[a-z-]+`/gi, '')
  return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trimEnd()
}

/**
 * Optional glossary blocks in wiki Markdown. Stripped from the rendered body and shown as a definition list.
 * Reference wiki entries use this block as the **introduction** (keyword + one-line definition); the rest of the
 * article uses practice, related-concepts, and notes sections (see `WIKI_REFERENCE_SECTION_MARKDOWN` and `getWikiPageBody` in kbService).
 *
 * ```
 * ::: glossary
 * **Term** — One-line definition (usage examples go in the definition text).
 * - **Another term** - List-style line also works.
 * :::
 * ```
 */
const GLOSSARY_BLOCK =
  /(?:^|\n):::\s*glossary\s*\n([\s\S]*?)\r?\n:::\s*(?=\r?\n|$)/gi

function parseGlossaryLine(line: string): WikiGlossaryEntry | null {
  const t = line.trim()
  if (!t || t.startsWith('#')) return null
  let m = /^\*\*([^*]+)\*\*\s*[—:–\-]\s*(.+)$/.exec(t)
  if (m) return { term: m[1].trim(), definition: m[2].trim() }
  m = /^[-*]\s*\*\*([^*]+)\*\*\s*[—:–\-]\s*(.+)$/.exec(t)
  if (m) return { term: m[1].trim(), definition: m[2].trim() }
  return null
}

export function extractWikiGlossary(raw: string): { body: string; glossary: WikiGlossaryEntry[] } {
  const glossary: WikiGlossaryEntry[] = []
  const body = raw.replace(GLOSSARY_BLOCK, (_full, inner: string) => {
    for (const line of inner.split('\n')) {
      const entry = parseGlossaryLine(line)
      if (entry) glossary.push(entry)
    }
    return '\n'
  })
  const collapsed = body.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '\n')
  return { body: collapsed.trimEnd(), glossary }
}
