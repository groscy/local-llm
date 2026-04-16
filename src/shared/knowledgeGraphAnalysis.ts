import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphPayload
} from './types'

export interface KnowledgeGraphCluster {
  /** Stable id (cluster index) */
  id: string
  /** KB source ids in this cluster (related-title component) */
  sourceIds: string[]
  /** Human-readable labels */
  labels: string[]
}

export interface KnowledgeGraphHub {
  sourceId: string
  label: string
  edgeCount: number
}

export interface KnowledgeGraphSuggestedLink {
  fromSourceId: string
  fromLabel: string
  toSourceId: string
  toLabel: string
  reason: string
}

export interface KnowledgeGraphRefinementNote {
  kind: 'wiki_gap' | 'duplicate_title' | 'isolated'
  sourceIds: string[]
  detail: string
}

export interface KnowledgeGraphAnalysisResult {
  generatedAt: string
  truncated: boolean
  counts: {
    sources: number
    chunks: number
    wikiPages: number
    edgesContains: number
    edgesIndexes: number
    edgesCompiledFrom: number
    edgesRelated: number
  }
  clusters: KnowledgeGraphCluster[]
  hubs: KnowledgeGraphHub[]
  suggestedLinks: KnowledgeGraphSuggestedLink[]
  refinements: KnowledgeGraphRefinementNote[]
  summary: string
}

/** IPC result for `kb:graphAnalysisRun`. */
export type KnowledgeGraphAnalysisRunResponse =
  | { ok: true; result: KnowledgeGraphAnalysisResult; markdown: string; ingestedSourceId?: string }
  | { ok: false; error: string }

function tokenizeTitle(title: string): string[] {
  const raw = title.toLowerCase().match(/[a-z0-9]{4,}/g)
  return raw ? [...new Set(raw)] : []
}

class UnionFind {
  private readonly p = new Map<string, string>()
  find(a: string): string {
    if (!this.p.has(a)) this.p.set(a, a)
    let x = a
    while (this.p.get(x) !== x) {
      const n = this.p.get(x)!
      this.p.set(x, this.p.get(n)!)
      x = this.p.get(x)!
    }
    return x
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.p.set(ra, rb)
  }
}

function nodeMap(data: KnowledgeGraphPayload): Map<string, KnowledgeGraphNode> {
  const m = new Map<string, KnowledgeGraphNode>()
  for (const n of data.nodes) m.set(n.id, n)
  return m
}

function sourceLabels(data: KnowledgeGraphPayload): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of data.nodes) {
    if (n.kind === 'source') m.set(n.id, n.label)
  }
  return m
}

/**
 * Deterministic analysis: group sources by `related` edges, find hubs, transitive link suggestions,
 * wiki compile gaps, and duplicate titles.
 */
export function analyzeKnowledgeGraph(data: KnowledgeGraphPayload): KnowledgeGraphAnalysisResult {
  const nodes = nodeMap(data)
  const labels = sourceLabels(data)
  const sourceIds = [...labels.keys()]

  let edgesContains = 0
  let edgesIndexes = 0
  let edgesCompiledFrom = 0
  let edgesRelated = 0
  const relatedAdj = new Map<string, Set<string>>()
  const addAdj = (a: string, b: string): void => {
    if (!relatedAdj.has(a)) relatedAdj.set(a, new Set())
    if (!relatedAdj.has(b)) relatedAdj.set(b, new Set())
    relatedAdj.get(a)!.add(b)
    relatedAdj.get(b)!.add(a)
  }

  for (const e of data.edges) {
    if (e.kind === 'contains') edgesContains++
    else if (e.kind === 'indexes') edgesIndexes++
    else if (e.kind === 'compiled_from') {
      edgesCompiledFrom++
    } else if (e.kind === 'related') {
      edgesRelated++
      const a = nodes.get(e.from)
      const b = nodes.get(e.to)
      if (a?.kind === 'source' && b?.kind === 'source') addAdj(a.id, b.id)
    }
  }

  for (const id of sourceIds) {
    if (!relatedAdj.has(id)) relatedAdj.set(id, new Set())
  }

  const uf = new UnionFind()
  for (const e of data.edges) {
    if (e.kind !== 'related') continue
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (a?.kind === 'source' && b?.kind === 'source') uf.union(a.id, b.id)
  }

  const clusterMap = new Map<string, string[]>()
  for (const id of sourceIds) {
    const root = uf.find(id)
    const arr = clusterMap.get(root) ?? []
    arr.push(id)
    clusterMap.set(root, arr)
  }

  const clusters: KnowledgeGraphCluster[] = []
  let cidx = 0
  for (const [, ids] of clusterMap) {
    if (ids.length === 0) continue
    const sorted = [...ids].sort()
    clusters.push({
      id: `c${cidx++}`,
      sourceIds: sorted,
      labels: sorted.map((sid) => labels.get(sid) ?? sid)
    })
  }
  clusters.sort((a, b) => b.sourceIds.length - a.sourceIds.length)

  const degree = new Map<string, number>()
  for (const id of sourceIds) degree.set(id, 0)
  const bump = (id: string): void => {
    degree.set(id, (degree.get(id) ?? 0) + 1)
  }
  for (const e of data.edges) {
    if (e.kind === 'contains' && nodes.get(e.from)?.kind === 'source') bump(e.from)
    if (e.kind === 'related') {
      if (nodes.get(e.from)?.kind === 'source') bump(e.from)
      if (nodes.get(e.to)?.kind === 'source') bump(e.to)
    }
    if (e.kind === 'compiled_from' && nodes.get(e.to)?.kind === 'source') bump(e.to)
  }

  const hubs: KnowledgeGraphHub[] = sourceIds
    .map((sourceId) => ({
      sourceId,
      label: labels.get(sourceId) ?? sourceId,
      edgeCount: degree.get(sourceId) ?? 0
    }))
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, 12)

  const suggestedLinks: KnowledgeGraphSuggestedLink[] = []
  const relatedPair = new Set<string>()
  for (const e of data.edges) {
    if (e.kind !== 'related') continue
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (a?.kind !== 'source' || b?.kind !== 'source') continue
    const k = a.id < b.id ? `${a.id}\0${b.id}` : `${b.id}\0${a.id}`
    relatedPair.add(k)
  }

  for (let i = 0; i < sourceIds.length; i++) {
    for (let j = i + 1; j < sourceIds.length; j++) {
      const a = sourceIds[i]!
      const b = sourceIds[j]!
      const k = a < b ? `${a}\0${b}` : `${b}\0${a}`
      if (relatedPair.has(k)) continue
      const na = relatedAdj.get(a)!
      let shareNeighbor = false
      for (const nb of na) {
        if (nb === b) continue
        if (relatedAdj.get(b)?.has(nb)) {
          shareNeighbor = true
          break
        }
      }
      if (shareNeighbor) {
        suggestedLinks.push({
          fromSourceId: a,
          fromLabel: labels.get(a) ?? a,
          toSourceId: b,
          toLabel: labels.get(b) ?? b,
          reason: 'Share a related neighbor — consider linking titles or merging topics'
        })
      }
    }
  }
  const maxSuggest = 24
  if (suggestedLinks.length > maxSuggest) suggestedLinks.length = maxSuggest

  const refinements: KnowledgeGraphRefinementNote[] = []
  const compiledFromSource = new Set<string>()
  for (const e of data.edges) {
    if (e.kind !== 'compiled_from') continue
    const tgt = nodes.get(e.to)
    if (tgt?.kind === 'source') compiledFromSource.add(tgt.id)
  }

  const chunkCountBySource = new Map<string, number>()
  for (const e of data.edges) {
    if (e.kind !== 'contains') continue
    const src = nodes.get(e.from)
    const ch = nodes.get(e.to)
    if (src?.kind === 'source' && ch?.kind === 'chunk') {
      chunkCountBySource.set(src.id, (chunkCountBySource.get(src.id) ?? 0) + 1)
    }
  }

  let wikiGaps = 0
  for (const id of sourceIds) {
    if ((chunkCountBySource.get(id) ?? 0) > 0 && !compiledFromSource.has(id)) {
      if (wikiGaps >= 40) break
      wikiGaps++
      refinements.push({
        kind: 'wiki_gap',
        sourceIds: [id],
        detail: `Source has chunks but no compiled wiki page (src:${id}) — compile for easier reading and graph links`
      })
    }
  }

  const titleNorm = new Map<string, string[]>()
  for (const id of sourceIds) {
    const t = (labels.get(id) ?? '').trim().toLowerCase()
    if (!t) continue
    const arr = titleNorm.get(t) ?? []
    arr.push(id)
    titleNorm.set(t, arr)
  }
  for (const [, ids] of titleNorm) {
    if (ids.length > 1) {
      const show = labels.get(ids[0]!) ?? ids[0]!
      refinements.push({
        kind: 'duplicate_title',
        sourceIds: ids,
        detail: `Duplicate title “${show}” (${ids.length} sources) — consider deduplicating or renaming`
      })
    }
  }

  let isolatedN = 0
  for (const id of sourceIds) {
    const n = relatedAdj.get(id)?.size ?? 0
    if (n === 0 && sourceIds.length > 1) {
      if (isolatedN >= 20) break
      isolatedN++
      refinements.push({
        kind: 'isolated',
        sourceIds: [id],
        detail: 'No title-token related links to other sources — add cross-references or broader titles'
      })
    }
  }

  const nChunks = data.nodes.filter((x) => x.kind === 'chunk').length
  const nWiki = data.nodes.filter((x) => x.kind === 'wiki').length
  const nSources = sourceIds.length

  const summary = [
    `${nSources} sources, ${nChunks} chunks, ${nWiki} wiki nodes;`,
    `${clusters.filter((c) => c.sourceIds.length > 1).length} multi-source cluster(s) from related titles;`,
    `${suggestedLinks.length} suggested new link(s);`,
    `${refinements.length} refinement note(s).`,
    data.truncated ? ' Graph was sampled — re-run after cleanup for full coverage.' : ''
  ]
    .join(' ')
    .trim()

  return {
    generatedAt: new Date().toISOString(),
    truncated: data.truncated,
    counts: {
      sources: nSources,
      chunks: nChunks,
      wikiPages: nWiki,
      edgesContains,
      edgesIndexes,
      edgesCompiledFrom,
      edgesRelated
    },
    clusters,
    hubs,
    suggestedLinks,
    refinements,
    summary
  }
}

export function knowledgeGraphAnalysisToMarkdown(
  data: KnowledgeGraphPayload,
  result: KnowledgeGraphAnalysisResult
): string {
  const lines: string[] = []
  lines.push(`# Knowledge graph analysis`)
  lines.push('')
  lines.push(`_Generated ${result.generatedAt}${result.truncated ? ' · graph display was truncated' : ''}_`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(result.summary)
  lines.push('')
  lines.push('## Counts')
  lines.push('')
  lines.push(
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Sources | ${result.counts.sources} |`,
    `| Chunks (in graph) | ${result.counts.chunks} |`,
    `| Wiki pages | ${result.counts.wikiPages} |`,
    `| contains edges | ${result.counts.edgesContains} |`,
    `| indexes edges | ${result.counts.edgesIndexes} |`,
    `| compiled_from edges | ${result.counts.edgesCompiledFrom} |`,
    `| related edges | ${result.counts.edgesRelated} |`,
    ''
  )

  lines.push('## Topic groups (related-title components)')
  lines.push('')
  for (const c of result.clusters) {
    if (c.sourceIds.length < 2) continue
    lines.push(`### ${c.id} (${c.sourceIds.length} sources)`)
    for (const lab of c.labels) lines.push(`- ${lab}`)
    lines.push('')
  }
  if (!result.clusters.some((c) => c.sourceIds.length > 2)) {
    lines.push('_No multi-source clusters — add more overlapping title tokens or related material._')
    lines.push('')
  }

  lines.push('## Hub sources (by connection count)')
  lines.push('')
  for (const h of result.hubs.slice(0, 8)) {
    lines.push(`- **${h.label}** (${h.edgeCount} edges)`)
  }
  lines.push('')

  if (result.suggestedLinks.length > 0) {
    lines.push('## Suggested links (refine graph)')
    lines.push('')
    for (const s of result.suggestedLinks) {
      lines.push(`- **${s.fromLabel}** ↔ **${s.toLabel}** — ${s.reason}`)
    }
    lines.push('')
  }

  if (result.refinements.length > 0) {
    lines.push('## Refinement checklist')
    lines.push('')
    for (const r of result.refinements) {
      lines.push(`- **${r.kind}**: ${r.detail}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push(
    'This report was produced automatically from the structural graph (sources, chunks, wiki, and title-token relations).'
  )
  return lines.join('\n')
}
