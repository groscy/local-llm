import type { RuntimeAdapter } from './runtime/types'

export const ARTICLE_CLEANUP_PROMPT_VERSION = '2026-05-10.v1'
const ARTICLE_CLEANUP_MAX_TOKENS = 1400

const ARTICLE_CLEANUP_SYSTEM = `You clean wiki markdown that was imported from raw documents.
Rules:
- Preserve all factual claims and technical meaning.
- Keep Markdown valid and compact.
- Fix OCR/import artifacts, line-break noise, duplicated punctuation, and malformed list formatting.
- Keep headings and anchors stable when possible.
- Move document metadata (author/date/source/version/id style fields) into a final "Metadata" section.
- Rewrite for professional readability: coherent flow, concise wording, and clean section structure.
- Remove out-of-place text, stray fragments, UI leftovers, scanner/export noise, and irrelevant boilerplate.
- Do not add new factual content.

Output format:
<clean_markdown>
...cleaned markdown...
</clean_markdown>`

export type ArticleCleanupResult = {
  body: string
  mode: 'llm' | 'heuristic'
  promptVersion: string
  fallbackReason?: string
  heuristicEdits: number
  modelId?: string
}

export type ArticleCleanupProgress = {
  stage: string
  label: string
  progress: number
}

const METADATA_KEY_HINTS = [
  'author',
  'date',
  'created',
  'updated',
  'modified',
  'version',
  'revision',
  'source',
  'document',
  'doc',
  'file',
  'path',
  'id',
  'status',
  'publisher',
  'company',
  'category',
  'tags'
]

const NOISE_LINE_PATTERNS: RegExp[] = [
  /^\s*table of contents\s*$/i,
  /^\s*contents\s*$/i,
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
  /^\s*generated (on|by)\b/i,
  /^\s*copyright\b/i,
  /^\s*all rights reserved\b/i,
  /^\s*confidential\b/i,
  /^\s*for internal use only\b/i,
  /^\s*click here\b/i,
  /^\s*www\.[^\s]+$/i,
  /^\s*https?:\/\/[^\s]+$/i,
  /^\s*figure\s+\d+[:.\-]?\s*$/i,
  /^\s*appendix\s+[a-z0-9]+[:.\-]?\s*$/i
]

function normalizeLineArtifacts(line: string): { value: string; edited: boolean } {
  let value = line
  let edited = false
  const before = value
  value = value.replace(/\t/g, '  ')
  value = value.replace(/[ \u00a0]+$/g, '')
  value = value.replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2')
  value = value.replace(/\s{2,}/g, ' ')
  if (/^\s*[-*+]\s*[^-\s]/.test(value)) value = value.replace(/^\s*[-*+]\s*/, '- ')
  if (/^\s*\d+[.)]\s*[^-\s]/.test(value)) value = value.replace(/^(\s*\d+)[.)]\s*/, '$1. ')
  if (value !== before) edited = true
  return { value, edited }
}

export function heuristicCleanupMarkdown(raw: string): { body: string; edits: number } {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim()
  if (!normalized) return { body: '', edits: 0 }
  let edits = 0
  const lines = normalized.split('\n')
  const out: string[] = []
  let blankRun = 0
  for (const line of lines) {
    const next = normalizeLineArtifacts(line)
    if (next.edited) edits++
    if (next.value.trim().length === 0) {
      blankRun++
      if (blankRun <= 1) out.push('')
      else edits++
      continue
    }
    blankRun = 0
    out.push(next.value)
  }
  const body = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return { body, edits }
}

function parseMetadataLine(raw: string): { key: string; value: string } | null {
  const m = raw.match(/^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z0-9 _/()\-]{1,40})\s*:\s*(.+)\s*$/)
  if (!m) return null
  const key = m[1]?.trim() ?? ''
  const value = m[2]?.trim() ?? ''
  if (!key || !value) return null
  const keyLower = key.toLowerCase()
  const hinted = METADATA_KEY_HINTS.some((hint) => keyLower.includes(hint))
  return hinted ? { key, value } : null
}

function relocateMetadataSection(raw: string): { body: string; moved: number } {
  const body = raw.replace(/\r\n/g, '\n').trim()
  if (!body) return { body, moved: 0 }
  if (/^##+\s+metadata\b/im.test(body)) return { body, moved: 0 }
  const lines = body.split('\n')
  const metadata: string[] = []
  const keep: string[] = []
  let moved = 0

  // YAML-like front matter at the very top
  if (lines[0]?.trim() === '---') {
    let end = -1
    for (let i = 1; i < Math.min(lines.length, 80); i++) {
      if (lines[i]?.trim() === '---') {
        end = i
        break
      }
    }
    if (end > 1) {
      for (let i = 1; i < end; i++) {
        const line = lines[i]?.trim() ?? ''
        if (!line) continue
        const parsed = parseMetadataLine(line)
        if (parsed) {
          metadata.push(`- **${parsed.key}**: ${parsed.value}`)
          moved++
        }
      }
      lines.splice(0, end + 1)
      while (lines[0]?.trim() === '') lines.shift()
    }
  }

  let inFence = false
  for (const [idx, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      keep.push(line)
      continue
    }
    if (!inFence && idx < 140) {
      const parsed = parseMetadataLine(line)
      if (parsed) {
        metadata.push(`- **${parsed.key}**: ${parsed.value}`)
        moved++
        continue
      }
    }
    keep.push(line)
  }

  if (metadata.length === 0) return { body, moved: 0 }
  const unique = [...new Set(metadata)]
  const core = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const merged = [core, '## Metadata', '', ...unique].filter((x, i) => !(i === 0 && !x)).join('\n\n')
  return { body: merged.trim(), moved }
}

function isLikelyFragmentNoise(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  if (NOISE_LINE_PATTERNS.some((rx) => rx.test(t))) return true
  if (/^[^\w]{4,}$/.test(t)) return true
  if (/^[-–—=:|]{3,}$/.test(t)) return true
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length <= 2 && t.length < 10 && !/^[A-Z].*:/.test(t)) return true
  if (/^[A-Za-z]{1,2}(\s+[A-Za-z]{1,2}){3,}$/.test(t)) return true
  return false
}

function pruneOutOfPlaceContent(raw: string): { body: string; removed: number } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const kept: string[] = []
  let removed = 0
  let inFence = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      kept.push(line)
      continue
    }
    if (!inFence && isLikelyFragmentNoise(line)) {
      removed++
      continue
    }
    kept.push(line)
  }
  return {
    body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removed
  }
}

function tagValue(raw: string, tag: string): string {
  const rx = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = raw.match(rx)
  return (m?.[1] ?? '').trim()
}

function parseCleanupResponse(raw: string): string | null {
  const tagged = tagValue(raw, 'clean_markdown')
  if (tagged) return tagged
  const fallback = raw.trim()
  return fallback.length > 0 ? fallback : null
}

export async function runArticleCleanup(args: {
  title: string
  body: string
  runtime?: RuntimeAdapter | null
  onProgress?: (payload: ArticleCleanupProgress) => void
}): Promise<ArticleCleanupResult> {
  args.onProgress?.({ stage: 'normalize', label: 'Normalizing article text', progress: 8 })
  const heuristicFirst = heuristicCleanupMarkdown(args.body)
  args.onProgress?.({ stage: 'heuristic', label: 'Applying deterministic cleanup heuristics', progress: 22 })
  const status = args.runtime?.getStatus()
  if (!args.runtime || !status?.running) {
    args.onProgress?.({ stage: 'fallback', label: 'Runtime unavailable, using deterministic cleanup', progress: 48 })
    const pruned = pruneOutOfPlaceContent(heuristicFirst.body)
    const relocated = relocateMetadataSection(pruned.body)
    return {
      body: relocated.body,
      mode: 'heuristic',
      promptVersion: ARTICLE_CLEANUP_PROMPT_VERSION,
      fallbackReason: 'runtime_unavailable',
      heuristicEdits: heuristicFirst.edits + pruned.removed + relocated.moved
    }
  }
  try {
    args.onProgress?.({ stage: 'llm', label: 'Running LLM cleanup pass on heuristic draft', progress: 56 })
    const payload = `TITLE: ${args.title}\n\nARTICLE_MARKDOWN:\n${heuristicFirst.body.slice(0, 22_000)}`
    const out = await args.runtime.chat(
      [
        { role: 'system', content: ARTICLE_CLEANUP_SYSTEM },
        { role: 'user', content: payload }
      ],
      { maxTokens: ARTICLE_CLEANUP_MAX_TOKENS }
    )
    const parsed = parseCleanupResponse(out)
    if (!parsed) {
      args.onProgress?.({ stage: 'fallback', label: 'Model output invalid, using deterministic fallback', progress: 74 })
      const pruned = pruneOutOfPlaceContent(heuristicFirst.body)
      const relocated = relocateMetadataSection(pruned.body)
      return {
        body: relocated.body,
        mode: 'heuristic',
        promptVersion: ARTICLE_CLEANUP_PROMPT_VERSION,
        fallbackReason: 'empty_model_output',
        heuristicEdits: heuristicFirst.edits + pruned.removed + relocated.moved
      }
    }
    args.onProgress?.({ stage: 'llm-merge', label: 'Validating and merging model cleanup output', progress: 82 })
    const cleaned = heuristicCleanupMarkdown(parsed)
    args.onProgress?.({ stage: 'prune', label: 'Removing out-of-place and noisy text', progress: 86 })
    const pruned = pruneOutOfPlaceContent(cleaned.body || heuristicFirst.body)
    args.onProgress?.({ stage: 'metadata', label: 'Moving metadata to final section', progress: 90 })
    const relocated = relocateMetadataSection(pruned.body)
    return {
      body: relocated.body,
      mode: 'llm',
      promptVersion: ARTICLE_CLEANUP_PROMPT_VERSION,
      heuristicEdits: heuristicFirst.edits + cleaned.edits + pruned.removed + relocated.moved,
      modelId: status.modelPath?.trim() || status.kind
    }
  } catch {
    args.onProgress?.({ stage: 'fallback', label: 'Model call failed, using deterministic fallback', progress: 74 })
    const pruned = pruneOutOfPlaceContent(heuristicFirst.body)
    const relocated = relocateMetadataSection(pruned.body)
    return {
      body: relocated.body,
      mode: 'heuristic',
      promptVersion: ARTICLE_CLEANUP_PROMPT_VERSION,
      fallbackReason: 'runtime_error',
      heuristicEdits: heuristicFirst.edits + pruned.removed + relocated.moved
    }
  }
}
