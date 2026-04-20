import type { RuntimeAdapter } from './runtime/types'
import { WIKI_REFERENCE_SECTION_MARKDOWN } from '@shared/wikiArticleExtras'

const EXTRACT_MAX_TOKENS = 384
const MAX_USER_CHARS = 12_000
const MAX_ASSISTANT_CHARS = 24_000

const EXTRACT_SYSTEM = `You distill the paired USER MESSAGE and ASSISTANT REPLY below into a **standalone reference note** for a personal knowledge base (one main term or short phrase as the entry title). Write as a neutral mini-article: do **not** address the reader, do **not** say "the user", "the assistant", "this chat", or "this conversation". Ground claims only in what the supplied text supports.

Output format (exactly):
1) First line **only** this tag (no TITLE: prefix): <wiki-title>the keyword or short noun phrase, ≤8 words</wiki-title>
2) Then Markdown for the entry body using **this section order and headings** (omit a section only if there is truly nothing to say; keep the heading and one honest neutral sentence if needed):

::: glossary
**<same keyword as TITLE>** — One-line definition (only keywords + definition in this fenced block).
:::

${WIKI_REFERENCE_SECTION_MARKDOWN.practice}

Typical situations, workflows, defaults, or constraints that apply to the topic (short prose or bullets).

${WIKI_REFERENCE_SECTION_MARKDOWN.related}

Named ties to **other concepts** that appear in the supplied material (synonymy, contrast, dependency, translation, related fields). Use bullet lines like "- **OtherTerm** — relation in one clause." If nothing fits, one sentence stating that no further named ties were recorded.

${WIKI_REFERENCE_SECTION_MARKDOWN.notes}

Longer nuance, caveats, examples, or technical detail worth keeping for later lookup.

3) Or if nothing is worth saving (pure greeting, pure refusal with no content, empty substance), output exactly:
<wiki-title>(skip)</wiki-title>
BODY_NONE

No outer code fences around the whole reply. No preamble or explanation outside that format.`

function clip(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

export function parseWikiExtractResponse(raw: string): { skip: true } | { title: string; body: string } {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return { skip: true }
  if (/<wiki-title>\s*\(skip\)\s*<\/wiki-title>/i.test(text)) return { skip: true }
  if (/TITLE:\s*\(skip\)/i.test(text)) return { skip: true }

  const tagTitle = text.match(/^<wiki-title>([\s\S]*?)<\/wiki-title>/im)
  if (tagTitle) {
    const rawTitle = tagTitle[1].replace(/\r\n/g, '\n').trim()
    if (/^\(skip\)$/i.test(rawTitle)) return { skip: true }
    const title = rawTitle.slice(0, 200)
    const body = text.replace(/^<wiki-title>[\s\S]*?<\/wiki-title>\s*/im, '').trim()
    const cleaned = body.replace(/^BODY_NONE\s*$/i, '').trim()
    if (!cleaned || cleaned.length < 12) return { skip: true }
    return { title, body: cleaned }
  }

  const m = text.match(/^TITLE:\s*(.+)$/im)
  if (m) {
    const rawTitle = m[1].trim()
    if (/^\(skip\)$/i.test(rawTitle)) return { skip: true }
    const title = rawTitle.slice(0, 200)
    const body = text.replace(/^TITLE:\s*.+$/im, '').trim()
    const cleaned = body.replace(/^BODY_NONE\s*$/i, '').trim()
    if (!cleaned || cleaned.length < 12) return { skip: true }
    return { title, body: cleaned }
  }

  const lines = text.split('\n').filter((l) => l.trim())
  const title = (lines[0] ?? 'Reference note').replace(/^[-*]\s*/, '').trim().slice(0, 120)
  const body = lines.slice(1).join('\n').trim() || text
  if (body.length < 12) return { skip: true }
  return { title, body: body.slice(0, 24_000) }
}

/**
 * Ask the running local model to distill the last user/assistant exchange into wiki-shaped text.
 * Does not stream; uses a modest token cap.
 */
export async function runWikiExtractChat(
  rt: RuntimeAdapter,
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  const user = clip(userMessage, MAX_USER_CHARS)
  const assistant = clip(assistantMessage, MAX_ASSISTANT_CHARS)
  const payload = `USER MESSAGE:\n${user}\n\nASSISTANT REPLY:\n${assistant}`
  return rt.chat(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: payload }
    ],
    { maxTokens: EXTRACT_MAX_TOKENS }
  )
}

export const wikiExtractLimits = { EXTRACT_MAX_TOKENS, minAssistantChars: 48 }
