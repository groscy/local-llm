import type { WikiGlossaryEntry } from './types'

/**
 * Optional glossary blocks in wiki Markdown. Stripped from the rendered body and shown as a definition list.
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
