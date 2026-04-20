/**
 * Deterministic post-processing for assistant chat Markdown: spacing, headings,
 * horizontal rules, and an optional “quick scan” outline so dense replies are easier to skim.
 * Code / fenced blocks are preserved byte-for-byte aside from newline normalization inside them.
 */

const OUTLINE_SENTINEL = '> **In this reply**'

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

/** Trim trailing spaces/tabs on each line (including inside code fences — harmless). */
function trimTrailingSpacesPerLine(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
}

/**
 * Split `source` into segments alternating outside / inside ``` or ~~~ fences (opening line
 * includes fence; closing line includes fence).
 */
function mapOutsideCodeFences(source: string, fn: (chunk: string) => string): string {
  const lines = source.split('\n')
  const out: string[] = []
  let buf: string[] = []
  let inFence = false

  const flush = (): void => {
    if (buf.length === 0) return
    const joined = buf.join('\n')
    buf = []
    const transformed = fn(joined)
    if (transformed.length > 0) {
      out.push(...transformed.split('\n'))
    }
  }

  for (const line of lines) {
    const fence = /^\s*(```+|~{3,})/.exec(line)
    if (fence) {
      if (!inFence) {
        flush()
        inFence = true
        out.push(line)
      } else {
        out.push(line)
        inFence = false
      }
    } else if (inFence) {
      out.push(line)
    } else {
      buf.push(line)
    }
  }
  flush()
  return out.join('\n')
}

function collapseConsecutiveBlankLines(chunk: string, maxBlank: number): string {
  const lines = chunk.split('\n')
  const out: string[] = []
  let blankRun = 0
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun++
      if (blankRun <= maxBlank) out.push(line)
    } else {
      blankRun = 0
      out.push(line)
    }
  }
  return out.join('\n')
}

/** Ensure a blank line before ATX headings so renderers show clear section breaks. */
function ensureBlankLineBeforeHeadings(chunk: string): string {
  const lines = chunk.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const isHeading = /^(#{1,6})\s+\S/.test(line) && !/^\s*>/.test(line)
    if (isHeading && out.length > 0) {
      const prev = out[out.length - 1] ?? ''
      if (prev.trim() !== '') {
        out.push('')
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

/** Put blank lines around thematic breaks on their own line (skip setext `heading` / `---` underlines). */
function ensureThematicBreakSpacing(chunk: string): string {
  const lines = chunk.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const isHrLine = /^(?:\s*)(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    const prev = out.length > 0 ? (out[out.length - 1] ?? '') : ''
    const looksLikeSetext =
      isHrLine &&
      prev.trim() !== '' &&
      !/^#{1,6}\s/.test(prev) &&
      !/^\s*(-|\*|\+)\s/.test(prev) &&
      prev.length < 600
    if (isHrLine && looksLikeSetext) {
      out.push(line)
      continue
    }
    if (isHrLine) {
      if (out.length > 0 && prev.trim() !== '') {
        out.push('')
      }
      out.push(line.trim())
      const next = lines[i + 1]
      if (next != null && next.trim() !== '' && !/^(#{1,6})\s/.test(next)) {
        out.push('')
      }
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

function stripInlineMdForOutline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

/** Collect ## / ### headings (outside fences) for a short blockquote outline. */
function extractOutlineTitles(chunk: string): string[] {
  const titles: string[] = []
  for (const line of chunk.split('\n')) {
    if (/^\s*>/.test(line)) continue
    const m = /^\s*(#{2,3})\s+(.+)$/.exec(line)
    if (!m) continue
    const t = stripInlineMdForOutline(m[2])
    if (t.length >= 2 && t.length <= 120) titles.push(t)
    if (titles.length >= 8) break
  }
  return titles
}

function chunkStartsWithOurOutline(chunk: string): boolean {
  const t = chunk.trimStart()
  return t.startsWith(OUTLINE_SENTINEL) || t.startsWith('> **Quick scan**')
}

function insertOutlineBlockquote(chunk: string): string {
  const titles = extractOutlineTitles(chunk)
  if (titles.length < 2) return chunk
  if (chunkStartsWithOurOutline(chunk)) return chunk

  const lines = titles.map((t, i) => `> ${i + 1}. ${t}`)
  const block = [OUTLINE_SENTINEL, ...lines, '>', ''].join('\n')
  return block + chunk.trimStart()
}

/**
 * Post-process assistant Markdown for readability (whitespace, section breaks, quick outline).
 */
export function postProcessAssistantChatMarkdown(raw: string): string {
  let s = normalizeNewlines(raw)
  s = trimTrailingSpacesPerLine(s)
  s = mapOutsideCodeFences(s, (chunk) => {
    let c = chunk
    c = collapseConsecutiveBlankLines(c, 1)
    c = ensureBlankLineBeforeHeadings(c)
    c = ensureThematicBreakSpacing(c)
    c = collapseConsecutiveBlankLines(c, 1)
    c = insertOutlineBlockquote(c)
    return c.trimEnd()
  })
  return s.trimEnd()
}
