import type { KnowledgeGraphEdgeKind, KnowledgeGraphNode, KnowledgeGraphPayload } from '@shared/types'
import type { KgBox, KgPos, KnowledgeGraphLayoutResult } from './buildKnowledgeGraphLayout'
import { nodeRadius } from './buildKnowledgeGraphLayout'

export const KG_GRAVITY_STORAGE_KEY = 'kgSemanticGravity'
export const KG_MIN_GAP_STORAGE_KEY = 'kgMinSurfaceGap'

/** Parsed from localStorage; clamped to safe ranges. Default 0 = seeded layout only. */
export function readStoredGravity(): number {
  const raw = globalThis.localStorage?.getItem(KG_GRAVITY_STORAGE_KEY)
  if (raw == null || raw === '') return 0
  const v = Number(raw)
  if (!Number.isFinite(v)) return 0
  return Math.min(1.6, Math.max(0, v))
}

export function readStoredMinSurfaceGap(): number {
  const raw = globalThis.localStorage?.getItem(KG_MIN_GAP_STORAGE_KEY)
  if (raw == null || raw === '') return 11
  const v = Number(raw)
  if (!Number.isFinite(v)) return 11
  return Math.min(28, Math.max(5, v))
}

type Spring = { rest: number; weight: number }

function edgeSpring(kind: KnowledgeGraphEdgeKind, confidence?: number, recency?: number): Spring {
  const c = typeof confidence === 'number' ? Math.min(1.4, Math.max(0.35, confidence)) : 1
  const r = typeof recency === 'number' ? Math.min(1.25, Math.max(0.5, recency + 0.5)) : 1
  const adjust = c * r
  switch (kind) {
    case 'contains':
      return { rest: 26, weight: 1.18 * adjust }
    case 'compiled_from':
      return { rest: 38, weight: 1.05 * adjust }
    case 'indexes':
      return { rest: 30, weight: 0.9 * adjust }
    case 'related':
      return { rest: 88, weight: 0.58 * adjust }
    default:
      return { rest: 40, weight: 0.5 * adjust }
  }
}

type Vec = { x: number; y: number }

function bucketKey(x: number, y: number, cell: number): string {
  return `${Math.floor(x / cell)},${Math.floor(y / cell)}`
}

/**
 * Refines seed positions with edge-weighted springs (semantic proximity) and
 * repulsion that enforces a minimum surface gap between circles.
 */
export function applySemanticGravity(
  data: KnowledgeGraphPayload,
  seed: KnowledgeGraphLayoutResult,
  opts: {
    gravity: number
    minSurfaceGap: number
    iterations?: number
  }
): KnowledgeGraphLayoutResult {
  const { gravity, minSurfaceGap } = opts
  if (gravity < 0.004) return seed

  const nodeById = new Map<string, KnowledgeGraphNode>()
  for (const n of data.nodes) nodeById.set(n.id, n)

  const ids = [...seed.positions.keys()]
  if (ids.length < 2) return seed

  const pos = new Map<string, KgPos>()
  for (const id of ids) {
    const p = seed.positions.get(id)!
    pos.set(id, { x: p.x, y: p.y })
  }

  const iter = opts.iterations ?? Math.min(52, Math.max(22, Math.floor(5200 / Math.sqrt(ids.length + 1))))
  const damping = 0.78
  const dt = 0.92
  const anchor = 0.11

  const cell = ids.length > 380 ? 105 : 88
  const repulseRadius = ids.length > 380 ? 155 : 195

  const springK = 0.048 * gravity
  const repulseK = 1.35 * gravity
  const minGap = minSurfaceGap

  for (let step = 0; step < iter; step++) {
    const f = new Map<string, Vec>()
    for (const id of ids) f.set(id, { x: 0, y: 0 })

    // —— Semantic springs (edges) ——
    for (const e of data.edges) {
      const pA = pos.get(e.from)
      const pB = pos.get(e.to)
      if (!pA || !pB) continue
      const nA = nodeById.get(e.from)
      const nB = nodeById.get(e.to)
      if (!nA || !nB) continue
      const { rest, weight } = edgeSpring(e.kind, e.confidence, e.recency)
      const dx = pB.x - pA.x
      const dy = pB.y - pA.y
      const dist = Math.hypot(dx, dy) || 0.001
      const diff = dist - rest
      const mag = springK * weight * diff
      const ux = dx / dist
      const uy = dy / dist
      const fa = f.get(e.from)!
      const fb = f.get(e.to)!
      fa.x += ux * mag
      fa.y += uy * mag
      fb.x -= ux * mag
      fb.y -= uy * mag
    }

    // —— Repulsion + minimum surface separation (grid-neighbour pairs only) ——
    const buckets = new Map<string, string[]>()
    for (const id of ids) {
      const p = pos.get(id)!
      const k = bucketKey(p.x, p.y, cell)
      const arr = buckets.get(k) ?? []
      arr.push(id)
      buckets.set(k, arr)
    }

    const addRepulse = (idA: string, idB: string): void => {
      if (idA === idB) return
      const pA = pos.get(idA)!
      const pB = pos.get(idB)!
      const nA = nodeById.get(idA)
      const nB = nodeById.get(idB)
      if (!nA || !nB) return
      const rA = nodeRadius(nA)
      const rB = nodeRadius(nB)
      const dx = pB.x - pA.x
      const dy = pB.y - pA.y
      const dist = Math.hypot(dx, dy) || 0.001
      const minCenter = rA + rB + minGap
      const fa = f.get(idA)!
      const fb = f.get(idB)!
      const ux = dx / dist
      const uy = dy / dist

      if (dist < minCenter) {
        const penetration = minCenter - dist
        const push = repulseK * penetration * (0.55 + 0.45 * (1 - dist / minCenter))
        fa.x -= ux * push
        fa.y -= uy * push
        fb.x += ux * push
        fb.y += uy * push
      } else if (dist < repulseRadius) {
        const soft = (repulseRadius - dist) / repulseRadius
        const inv = repulseK * soft * soft * 14 * (rA + rB) / (dist * dist + 120)
        fa.x -= ux * inv
        fa.y -= uy * inv
        fb.x += ux * inv
        fb.y += uy * inv
      }
    }

    const seenPair = new Set<string>()
    for (const [key, list] of buckets) {
      const [ci, cj] = key.split(',').map(Number) as [number, number]
      const local = list
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const nk = `${ci + di},${cj + dj}`
          const other = buckets.get(nk)
          if (!other) continue
          for (const a of local) {
            for (const b of other) {
              if (a === b) continue
              const u = a < b ? a : b
              const v = a < b ? b : a
              const pk = `${u}\0${v}`
              if (seenPair.has(pk)) continue
              seenPair.add(pk)
              addRepulse(u, v)
            }
          }
        }
      }
    }

    // —— Weak anchor to seed (keeps global structure) ——
    for (const id of ids) {
      const p = pos.get(id)!
      const s = seed.positions.get(id)!
      const fa = f.get(id)!
      fa.x += anchor * gravity * (s.x - p.x) * 0.018
      fa.y += anchor * gravity * (s.y - p.y) * 0.018
    }

    // —— Integrate ——
    for (const id of ids) {
      const p = pos.get(id)!
      const fa = f.get(id)!
      let vx = fa.x * dt
      let vy = fa.y * dt
      vx *= damping
      vy *= damping
      const cap = 9 + step * 0.08
      const m = Math.hypot(vx, vy)
      if (m > cap) {
        vx = (vx / m) * cap
        vy = (vy / m) * cap
      }
      p.x += vx
      p.y += vy
    }
  }

  // —— Shift into positive padded canvas; recompute bounds & hit boxes ——
  const pad = 36
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const p = pos.get(id)!
    const n = nodeById.get(id)
    if (!n) continue
    const r = nodeRadius(n)
    minX = Math.min(minX, p.x - r)
    minY = Math.min(minY, p.y - r)
    maxX = Math.max(maxX, p.x + r)
    maxY = Math.max(maxY, p.y + r)
  }
  const shiftX = minX < pad ? pad - minX : 0
  const shiftY = minY < pad ? pad - minY : 0
  for (const id of ids) {
    const p = pos.get(id)!
    p.x += shiftX
    p.y += shiftY
  }

  const boxes = new Map<string, KgBox>()
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  for (const id of ids) {
    const p = pos.get(id)!
    const n = nodeById.get(id)
    if (!n) continue
    const r = nodeRadius(n)
    const b = { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 }
    boxes.set(id, b)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }

  const layoutWidth = Math.max(seed.width, maxX + pad)
  const height = Math.max(seed.height, maxY + pad)

  return { positions: pos, boxes, width: layoutWidth, height }
}
