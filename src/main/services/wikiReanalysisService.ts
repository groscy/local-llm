import type Database from 'better-sqlite3'
import type { RuntimeAdapter } from './runtime/types'
import {
  applyWikiReanalysis,
  getWikiPageBody,
  listSources,
  normalizeWikiKeyword
} from './kbService'
import type { WikiReanalyzeProgress, WikiReanalyzeResult } from '@shared/types'

const REANALYZE_PROMPT_VERSION = '2026-04-20.v1'
const REANALYZE_MAX_TOKENS = 768

const REANALYZE_SYSTEM = `You rewrite one existing wiki article into a distilled knowledge-entry format.
Hard rules:
- Exactly ONE canonical keyword (single noun phrase) per entry.
- Keep only essential information required for future retrieval.
- Maintain neutral, factual tone.
- Keep explicit links to related keywords.
- Prefer compact markdown.

Output format (exactly):
<canonical_keyword>keyword phrase</canonical_keyword>
<entry_markdown>
::: glossary
**Keyword** - one sentence definition.
:::

## Practice / Context
- essential usage points

## Related concepts
- **OtherKeyword** - relation phrase

## Notes
- optional caveat bullets
</entry_markdown>
<relations_json>[{"keyword":"OtherKeyword","relation":"depends_on","confidence":0.73}]</relations_json>`

type ParsedReanalysis = {
  canonicalKeyword: string
  markdown: string
  relations: Array<{ keyword: string; relation: string; confidence: number }>
}

function tagValue(raw: string, tag: string): string {
  const rx = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = raw.match(rx)
  return (m?.[1] ?? '').trim()
}

function parseRelationsJson(raw: string): Array<{ keyword: string; relation: string; confidence: number }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => {
        const o = (x ?? {}) as Record<string, unknown>
        const keyword = typeof o.keyword === 'string' ? o.keyword.trim() : ''
        const relation = typeof o.relation === 'string' ? o.relation.trim() : 'related'
        const confidence = typeof o.confidence === 'number' ? o.confidence : 0.5
        return { keyword, relation, confidence }
      })
      .filter((x) => x.keyword.length > 0)
      .slice(0, 24)
  } catch {
    return []
  }
}

export function parseWikiReanalyzeResponse(raw: string): ParsedReanalysis | null {
  const canonicalRaw = tagValue(raw, 'canonical_keyword')
  const markdown = tagValue(raw, 'entry_markdown')
  const relationsRaw = tagValue(raw, 'relations_json')
  const canonicalKeyword = normalizeWikiKeyword(canonicalRaw)
  if (!canonicalKeyword || !markdown) return null
  return {
    canonicalKeyword,
    markdown: markdown.trim(),
    relations: parseRelationsJson(relationsRaw)
  }
}

function fallbackParsed(title: string, body: string): ParsedReanalysis {
  const keyword = normalizeWikiKeyword(title) || 'untitled concept'
  const compact = body.replace(/\r\n/g, '\n').trim().slice(0, 3600)
  return {
    canonicalKeyword: keyword,
    markdown: compact || `::: glossary\n**${keyword}** - No distilled content was produced.\n:::`,
    relations: []
  }
}

type RunArgs = {
  db: Database.Database
  runtime: RuntimeAdapter
  onProgress?: (p: WikiReanalyzeProgress) => void
}

export async function runWikiReanalysisBatch(args: RunArgs): Promise<WikiReanalyzeResult> {
  const { db, runtime } = args
  const status = runtime.getStatus()
  if (!status.running) throw new Error('Runtime is not running. Start a model first.')

  const sources = listSources(db)
  args.onProgress?.({ kind: 'started', totalSources: sources.length })
  if (sources.length === 0) {
    const empty: WikiReanalyzeResult = {
      ok: true,
      processedSources: 0,
      processedEntries: 0,
      mergedEntries: 0,
      skippedSources: 0,
      modelId: status.modelPath?.trim() || status.kind,
      promptVersion: REANALYZE_PROMPT_VERSION
    }
    args.onProgress?.({ kind: 'done', summary: empty })
    return empty
  }

  const grouped = new Map<
    string,
    {
      canonicalKeyword: string
      title: string
      sourceIds: Set<string>
      bodies: string[]
      relations: Array<{ toKeyword: string; relationType: string; confidence: number }>
    }
  >()
  let skipped = 0

  for (const [idx, source] of sources.entries()) {
    args.onProgress?.({
      kind: 'source',
      index: idx + 1,
      totalSources: sources.length,
      sourceId: source.id,
      title: source.title
    })
    const baseBody = getWikiPageBody(db, source.id)
    const payload = `SOURCE_TITLE: ${source.title}\n\nSOURCE_BODY:\n${baseBody.slice(0, 16_000)}`
    let parsed: ParsedReanalysis | null = null
    try {
      const out = await runtime.chat(
        [
          { role: 'system', content: REANALYZE_SYSTEM },
          { role: 'user', content: payload }
        ],
        { maxTokens: REANALYZE_MAX_TOKENS }
      )
      parsed = parseWikiReanalyzeResponse(out)
    } catch {
      parsed = null
    }
    if (!parsed) {
      skipped++
      parsed = fallbackParsed(source.title, baseBody)
    }
    const canonical = normalizeWikiKeyword(parsed.canonicalKeyword)
    const key = canonical || normalizeWikiKeyword(source.title) || source.id
    if (!grouped.has(key)) {
      grouped.set(key, {
        canonicalKeyword: key,
        title: source.title,
        sourceIds: new Set<string>(),
        bodies: [],
        relations: []
      })
    }
    const g = grouped.get(key)!
    g.sourceIds.add(source.id)
    g.bodies.push(parsed.markdown)
    for (const rel of parsed.relations) {
      g.relations.push({
        toKeyword: rel.keyword,
        relationType: rel.relation || 'related',
        confidence: typeof rel.confidence === 'number' ? rel.confidence : 0.5
      })
    }
  }

  args.onProgress?.({ kind: 'merging', totalKeywords: grouped.size })

  const entries = [...grouped.values()].map((g) => {
    const chosenBody =
      g.bodies
        .map((b) => b.trim())
        .filter(Boolean)
        .sort((a, b) => a.length - b.length)[0] || `::: glossary\n**${g.canonicalKeyword}** - No content.\n:::`
    return {
      canonicalKeyword: g.canonicalKeyword,
      title: g.title,
      body: chosenBody,
      sourceIds: [...g.sourceIds],
      relations: g.relations
    }
  })

  const summary = applyWikiReanalysis(db, {
    modelId: status.modelPath?.trim() || status.kind,
    promptVersion: REANALYZE_PROMPT_VERSION,
    entries
  })
  summary.skippedSources = skipped
  args.onProgress?.({ kind: 'done', summary })
  return summary
}

