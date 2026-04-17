import type { KnowledgeGraphNode, KnowledgeGraphPayload } from '@shared/types'

export type KgPos = { x: number; y: number }
export type KgBox = { x: number; y: number; w: number; h: number }

export type KnowledgeGraphLayoutOptions = {
  containerWidth: number
  collapsedSourceIds?: ReadonlySet<string>
}

export type KnowledgeGraphLayoutResult = {
  positions: Map<string, KgPos>
  boxes: Map<string, KgBox>
  width: number
  height: number
}

/** Hit / stroke radius per node kind (Obsidian-style dots). */
export function nodeRadius(n: KnowledgeGraphNode): number {
  if (n.kind === 'wiki') return 11
  if (n.kind === 'source') return 14
  if (n.kind === 'chunk' && n.id.startsWith('kg-overflow:')) return 7
  return 4.5
}

function circleBox(p: KgPos, r: number): KgBox {
  const d = r * 2
  return { x: p.x - r, y: p.y - r, w: d, h: d }
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

/**
 * Grouped layout (Obsidian-like information grouping):
 * — Wiki nodes in an upper band
 * — Sources clustered by `related` edge components, each cluster in its own column block
 * — Chunks in a compact arc below their source
 */
export function buildKnowledgeGraphLayout(
  data: KnowledgeGraphPayload,
  opts: KnowledgeGraphLayoutOptions
): KnowledgeGraphLayoutResult {
  const { containerWidth, collapsedSourceIds = new Set<string>() } = opts
  const pad = 40
  const wikiR = 11
  const wikiGap = 28
  const zoneGap = 56
  const clusterGapX = 36
  const sourceR = 14
  const chunkR = 4.5

  const sources = data.nodes.filter((n) => n.kind === 'source')
  const wikis = data.nodes.filter((n) => n.kind === 'wiki')
  const sourceIds = new Set(sources.map((s) => s.id))

  const chunksBySource = new Map<string, KnowledgeGraphNode[]>()
  for (const n of data.nodes) {
    if (n.kind === 'chunk' && n.sourceId) {
      const arr = chunksBySource.get(n.sourceId) ?? []
      arr.push(n)
      chunksBySource.set(n.sourceId, arr)
    }
  }

  const uf = new UnionFind()
  for (const s of sources) uf.find(s.id)
  for (const e of data.edges) {
    if (e.kind !== 'related') continue
    if (sourceIds.has(e.from) && sourceIds.has(e.to)) uf.union(e.from, e.to)
  }

  const clusterMap = new Map<string, string[]>()
  for (const s of sources) {
    const root = uf.find(s.id)
    const arr = clusterMap.get(root) ?? []
    arr.push(s.id)
    clusterMap.set(root, arr)
  }

  const clusters = [...clusterMap.values()].sort((a, b) => b.length - a.length)

  const innerW = Math.max(containerWidth - pad * 2, 360)

  const positions = new Map<string, KgPos>()
  const boxes = new Map<string, KgBox>()

  let yCursor = pad

  // —— Wiki band (grouped rows) ——
  if (wikis.length > 0) {
    const rowH = wikiR * 2 + 20
    const slot = wikiR * 2 + wikiGap
    const perRow = Math.max(1, Math.floor((innerW + wikiGap) / slot))
    let idx = 0
    while (idx < wikis.length) {
      const row = wikis.slice(idx, idx + perRow)
      const rowW = row.length * (wikiR * 2) + (row.length - 1) * wikiGap
      const left = pad + (innerW - rowW) / 2
      const cy = yCursor + wikiR
      for (let i = 0; i < row.length; i++) {
        const w = row[i]!
        const cx = left + wikiR + i * (wikiR * 2 + wikiGap)
        const p = { x: cx, y: cy }
        positions.set(w.id, p)
        boxes.set(w.id, circleBox(p, wikiR))
      }
      yCursor += rowH
      idx += perRow
    }
    yCursor += zoneGap * 0.35
  } else {
    yCursor += 12
  }

  const ySource = yCursor + sourceR + 6

  // —— Per-cluster column blocks ——
  const clusterBlockWidth = (nSources: number): number => {
    if (nSources <= 1) return 88
    const cols = nSources <= 4 ? 2 : nSources <= 9 ? 3 : 4
    const rows = Math.ceil(nSources / cols)
    return Math.max(100, cols * 76 + 24, rows * 52 + 20)
  }

  const clusterChunkDepth = (ids: string[]): number => {
    let maxRing = 0
    for (const sid of ids) {
      if (collapsedSourceIds.has(sid)) continue
      const n = chunksBySource.get(sid)?.length ?? 0
      if (n === 0) continue
      const perRing = 10
      maxRing = Math.max(maxRing, Math.ceil(n / perRing))
    }
    return maxRing === 0 ? 0 : 22 + maxRing * 16
  }

  let xCluster = pad
  let deepest = ySource + sourceR

  for (const cluster of clusters) {
    const cw = clusterBlockWidth(cluster.length)
    const chDepth = clusterChunkDepth(cluster)
    const blockH = sourceR * 2 + 28 + chDepth
    deepest = Math.max(deepest, ySource + blockH)

    const cols = cluster.length <= 1 ? 1 : cluster.length <= 4 ? 2 : cluster.length <= 9 ? 3 : 4
    const rows = Math.ceil(cluster.length / cols)
    const cellW = (cw - 20) / cols
    const cellH = Math.max(56, rows > 1 ? 58 : 52)

    for (let i = 0; i < cluster.length; i++) {
      const sid = cluster[i]!
      const col = i % cols
      const row = Math.floor(i / cols)
      const cx = xCluster + 10 + col * cellW + cellW / 2
      const cy = ySource + row * cellH
      const p = { x: cx, y: cy }
      positions.set(sid, p)
      boxes.set(sid, circleBox(p, sourceR))

      if (collapsedSourceIds.has(sid)) continue

      const chunks = chunksBySource.get(sid) ?? []
      const perRing = 10
      for (let j = 0; j < chunks.length; j++) {
        const ch = chunks[j]!
        const ring = Math.floor(j / perRing)
        const slot = j % perRing
        const inRing = Math.min(perRing, chunks.length - ring * perRing)
        const spread = Math.PI * 0.62
        const mid = Math.PI / 2
        const ang = inRing <= 1 ? mid : mid - spread / 2 + (spread * slot) / (inRing - 1)
        const rad = sourceR + 16 + ring * 15
        const cp = {
          x: cx + Math.cos(ang) * rad,
          y: cy + Math.sin(ang) * rad
        }
        positions.set(ch.id, cp)
        const r = ch.id.startsWith('kg-overflow:') ? 7 : chunkR
        boxes.set(ch.id, circleBox(cp, r))
        deepest = Math.max(deepest, cp.y + r + 6)
      }
    }

    xCluster += cw + clusterGapX
  }

  const layoutWidth = Math.max(innerW + pad * 2, xCluster + pad)
  const height = Math.max(380, deepest + pad + 36)

  return { positions, boxes, width: layoutWidth, height }
}

/** Edge path with circular endpoints and gentle curve (Obsidian-style). */
export function kgEdgePath(from: KgPos, to: KgPos, kind: string, b1: KgBox, b2: KgBox): string {
  const r1 = Math.min(b1.w, b1.h) / 2
  const r2 = Math.min(b2.w, b2.h) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const inset = 2
  const start = { x: from.x + ux * (r1 + inset), y: from.y + uy * (r1 + inset) }
  const end = { x: to.x - ux * (r2 + inset), y: to.y - uy * (r2 + inset) }

  if (kind === 'related' && Math.abs(dy) < 10 && len < 160) {
    const lift = Math.min(48, len * 0.35)
    const midX = (start.x + end.x) / 2
    return `M ${start.x} ${start.y} Q ${midX} ${start.y - lift} ${end.x} ${end.y}`
  }

  const mx = (start.x + end.x) / 2
  const my = (start.y + end.y) / 2
  const px = -uy
  const py = ux
  const curve = kind === 'contains' ? 0.12 : kind === 'indexes' ? 0.22 : kind === 'compiled_from' ? 0.14 : 0.18
  const off = Math.min(72, len * curve)
  const cx = mx + px * off
  const cy = my + py * off
  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`
}
