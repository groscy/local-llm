import type { KnowledgeGraphNode, KnowledgeGraphPayload } from '@shared/types'
import type { KnowledgeGraphLayoutResult } from './buildKnowledgeGraphLayout'
import { nodeRadius } from './buildKnowledgeGraphLayout'

export type NodeDragOffsetMap = Readonly<Record<string, { dx: number; dy: number }>>

function dragBoundsForNode(n: KnowledgeGraphNode, r: number, base: KnowledgeGraphLayoutResult) {
  const top = n.kind === 'wiki' ? r + 18 : n.kind === 'source' ? r + 20 : r + 12
  const bottom = n.kind === 'wiki' ? r + 46 : n.kind === 'source' ? r + 52 : r + 30
  const side = n.kind === 'chunk' ? r + 8 : r + 12
  return {
    minX: side,
    maxX: Math.max(side + 1, base.width - side),
    minY: top,
    maxY: Math.max(top + 1, base.height - bottom)
  }
}

/** Clamp total offset from the layout seed so the node (and label) stays inside the graph canvas. */
export function clampDragOffsetForNode(
  p0: { x: number; y: number },
  dx: number,
  dy: number,
  n: KnowledgeGraphNode,
  base: KnowledgeGraphLayoutResult
): { dx: number; dy: number } {
  const r = nodeRadius(n)
  const b = dragBoundsForNode(n, r, base)
  const x = Math.max(b.minX, Math.min(b.maxX, p0.x + dx))
  const y = Math.max(b.minY, Math.min(b.maxY, p0.y + dy))
  return { dx: x - p0.x, dy: y - p0.y }
}

export function mergeNodeDragIntoLayout(
  base: KnowledgeGraphLayoutResult,
  data: KnowledgeGraphPayload,
  offsets: NodeDragOffsetMap
): KnowledgeGraphLayoutResult {
  if (Object.keys(offsets).length === 0) return base
  const positions = new Map(base.positions)
  const boxes = new Map(base.boxes)
  let touched = false
  for (const n of data.nodes) {
    const o = offsets[n.id]
    if (!o || (o.dx === 0 && o.dy === 0)) continue
    const p0 = base.positions.get(n.id)
    if (!p0) continue
    touched = true
    const c = clampDragOffsetForNode(p0, o.dx, o.dy, n, base)
    const r = nodeRadius(n)
    const p = { x: p0.x + c.dx, y: p0.y + c.dy }
    positions.set(n.id, p)
    const d = r * 2
    boxes.set(n.id, { x: p.x - r, y: p.y - r, w: d, h: d })
  }
  if (!touched) return base
  return { positions, boxes, width: base.width, height: base.height }
}
