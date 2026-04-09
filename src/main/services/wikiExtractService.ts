import type { RuntimeAdapter } from './runtime/types'

const EXTRACT_MAX_TOKENS = 384
const MAX_USER_CHARS = 12_000
const MAX_ASSISTANT_CHARS = 24_000

const EXTRACT_SYSTEM = `You turn a chat turn into a tiny wiki note for a personal knowledge base.

Output format (exactly):
1) One line: TITLE: <short noun phrase, ≤8 words>
2) Then either:
   - Prefer a short Wikipedia-style article: optional 1–2 lead sentences, then ## Section headings with short paragraphs or bullets under each when there are several distinct points (2–4 sections max). Otherwise a markdown bullet list (2–8 lines starting with "- ") is fine.
   - Or if nothing is worth saving (pure greeting, pure refusal with no content, empty substance), output exactly:
TITLE: (skip)
BODY_NONE

No code fences. No preamble or explanation outside that format.`

function clip(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

export function parseWikiExtractResponse(raw: string): { skip: true } | { title: string; body: string } {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return { skip: true }
  if (/TITLE:\s*\(skip\)/i.test(text)) return { skip: true }

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
  const title = (lines[0] ?? 'Chat note').replace(/^[-*]\s*/, '').trim().slice(0, 120)
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
