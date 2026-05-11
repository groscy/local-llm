import { buildKnowledgeGraphSourceGroups } from '@shared/knowledgeGraphAnalysis'
import type {
  KnowledgeGraphClusterMode,
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeKind,
  KnowledgeGraphNode,
  KnowledgeGraphPayload
} from '@shared/types'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'
import type { KgBox, KgPos, KnowledgeGraphLayoutResult } from './buildKnowledgeGraphLayout'
import { nodeRadius } from './buildKnowledgeGraphLayout'

export const KG_GRAVITY_STORAGE_KEY = 'kgSemanticGravity'
export const KG_MIN_GAP_STORAGE_KEY = 'kgMinSurfaceGap'

export function readStoredGravity(): number {
  const raw = globalThis.localStorage?.getItem(KG_GRAVITY_STORAGE_KEY)
  if (raw == null || raw === '') return 0.72
  const v = Number(raw)
  if (!Number.isFinite(v)) return 0.72
  return Math.min(1.7, Math.max(0.2, v))
}

export function readStoredMinSurfaceGap(): number {
  const raw = globalThis.localStorage?.getItem(KG_MIN_GAP_STORAGE_KEY)
  if (raw == null || raw === '') return 14
  const v = Number(raw)
  if (!Number.isFinite(v)) return 14
  return Math.min(34, Math.max(8, v))
}

type KgForceNode = SimulationNodeDatum & {
  id: string
  kind: KnowledgeGraphNode['kind']
  radius: number
  groupId: string
  seedX: number
  seedY: number
}

type KgForceLink = SimulationLinkDatum<KgForceNode> & {
  source: string | KgForceNode
  target: string | KgForceNode
  kind: KnowledgeGraphEdgeKind
  salience: number
  distance: number
  strength: number
}

export type EdgeVisibility = Record<KnowledgeGraphEdgeKind, boolean>

export type GroupHull = {
  id: string
  label: string
  mode: KnowledgeGraphClusterMode | 'wiki'
  nodeIds: string[]
  cx: number
  cy: number
  rx: number
  ry: number
}

export type ForceSnapshot = KnowledgeGraphLayoutResult & {
  hulls: GroupHull[]
}

export type ForceSimulationHandle = {
  simulation: Simulation<KgForceNode, KgForceLink>
  dragNode: (nodeId: string, x: number, y: number) => void
  pinNode: (nodeId: string, pos: { x: number; y: number } | null) => void
  reheat: (alpha?: number) => void
  destroy: () => void
}

export type ForceSimulationOptions = {
  gravity: number
  minSurfaceGap: number
  clusterMode: KnowledgeGraphClusterMode
  visibleEdges: EdgeVisibility
  pinnedNodePositions?: ReadonlyMap<string, { x: number; y: number }>
  onTick: (snapshot: ForceSnapshot) => void
}

const WORKER_LAYOUT_NODE_THRESHOLD = 1400

function edgeBaseDistance(kind: KnowledgeGraphEdgeKind): number {
  switch (kind) {
    case 'contains':
      return 66
    case 'compiled_from':
      return 86
    case 'indexes':
      return 76
    case 'related':
      return 136
    default:
      return 98
  }
}

function edgeBaseStrength(kind: KnowledgeGraphEdgeKind): number {
  switch (kind) {
    case 'contains':
      return 0.26
    case 'compiled_from':
      return 0.23
    case 'indexes':
      return 0.2
    case 'related':
      return 0.12
    default:
      return 0.15
  }
}

function edgeSalience(edge: KnowledgeGraphEdge): number {
  const kindBoost =
    edge.kind === 'contains'
      ? 0.75
      : edge.kind === 'compiled_from'
        ? 0.68
        : edge.kind === 'indexes'
          ? 0.56
          : 0.42
  const c = edge.confidence == null ? 0.6 : Math.max(0, Math.min(1, edge.confidence))
  const r = edge.recency == null ? 0.55 : Math.max(0, Math.min(1, edge.recency))
  return Math.max(0.08, Math.min(1, kindBoost * 0.58 + c * 0.24 + r * 0.18))
}

function buildNodeGroupMap(
  data: KnowledgeGraphPayload,
  clusterMode: KnowledgeGraphClusterMode
): Map<string, { id: string; mode: KnowledgeGraphClusterMode | 'wiki'; label: string }> {
  const sourceGroups = buildKnowledgeGraphSourceGroups(data, clusterMode)
  const sourceToGroup = new Map<string, { id: string; mode: KnowledgeGraphClusterMode; label: string }>()
  for (const group of sourceGroups) {
    for (const sourceId of group.sourceIds) {
      sourceToGroup.set(sourceId, { id: group.id, mode: group.mode, label: group.label })
    }
  }
  const map = new Map<string, { id: string; mode: KnowledgeGraphClusterMode | 'wiki'; label: string }>()
  for (const node of data.nodes) {
    if (node.kind === 'wiki') {
      map.set(node.id, { id: 'wiki-band', mode: 'wiki', label: 'Wiki pages' })
      continue
    }
    const group = sourceToGroup.get(node.kind === 'source' ? node.id : node.sourceId ?? '')
    if (group) map.set(node.id, group)
    else map.set(node.id, { id: 'related:unscoped', mode: clusterMode, label: 'Unscoped' })
  }
  return map
}

function makeClusterForce(nodes: KgForceNode[], gravity: number): Force<KgForceNode, KgForceLink> {
  const byGroup = new Map<string, KgForceNode[]>()
  for (const node of nodes) {
    const list = byGroup.get(node.groupId) ?? []
    list.push(node)
    byGroup.set(node.groupId, list)
  }

  const force = ((alpha: number) => {
    for (const [groupId, groupNodes] of byGroup) {
      if (!groupNodes.length || groupId === 'wiki-band') continue
      let cx = 0
      let cy = 0
      for (const node of groupNodes) {
        cx += node.x ?? node.seedX
        cy += node.y ?? node.seedY
      }
      cx /= groupNodes.length
      cy /= groupNodes.length
      const pull = (0.02 + gravity * 0.02) * alpha
      for (const node of groupNodes) {
        if (node.fx != null && node.fy != null) continue
        const nx = node.x ?? node.seedX
        const ny = node.y ?? node.seedY
        node.vx = (node.vx ?? 0) + (cx - nx) * pull
        node.vy = (node.vy ?? 0) + (cy - ny) * pull
      }
    }
  }) as Force<KgForceNode, KgForceLink>

  force.initialize = () => {
    /* initialized from closure */
  }
  return force
}

function buildSnapshot(
  data: KnowledgeGraphPayload,
  simNodes: KgForceNode[],
  nodeGroupMap: Map<string, { id: string; mode: KnowledgeGraphClusterMode | 'wiki'; label: string }>,
  seed: KnowledgeGraphLayoutResult
): ForceSnapshot {
  const positions = new Map<string, KgPos>()
  const boxes = new Map<string, KgBox>()
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const pad = 34

  for (const node of simNodes) {
    const x = Number.isFinite(node.x) ? (node.x as number) : node.seedX
    const y = Number.isFinite(node.y) ? (node.y as number) : node.seedY
    positions.set(node.id, { x, y })
    const d = node.radius * 2
    const box = { x: x - node.radius, y: y - node.radius, w: d, h: d }
    boxes.set(node.id, box)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
  }

  const shiftX = Number.isFinite(minX) && minX < pad ? pad - minX : 0
  const shiftY = Number.isFinite(minY) && minY < pad ? pad - minY : 0
  if (shiftX !== 0 || shiftY !== 0) {
    for (const [id, p] of positions) {
      positions.set(id, { x: p.x + shiftX, y: p.y + shiftY })
    }
    for (const [id, b] of boxes) {
      boxes.set(id, { ...b, x: b.x + shiftX, y: b.y + shiftY })
    }
    maxX += shiftX
    maxY += shiftY
  }

  const width = Math.max(seed.width, maxX + pad)
  const height = Math.max(seed.height, maxY + pad)
  const groupBuckets = new Map<string, { label: string; mode: KnowledgeGraphClusterMode | 'wiki'; ids: string[] }>()
  for (const node of data.nodes) {
    const g = nodeGroupMap.get(node.id)
    if (!g) continue
    const bucket = groupBuckets.get(g.id) ?? { label: g.label, mode: g.mode, ids: [] }
    bucket.ids.push(node.id)
    groupBuckets.set(g.id, bucket)
  }

  const hulls: GroupHull[] = []
  for (const [groupId, bucket] of groupBuckets) {
    if (bucket.ids.length < 2) continue
    let gx0 = Number.POSITIVE_INFINITY
    let gy0 = Number.POSITIVE_INFINITY
    let gx1 = Number.NEGATIVE_INFINITY
    let gy1 = Number.NEGATIVE_INFINITY
    for (const nodeId of bucket.ids) {
      const box = boxes.get(nodeId)
      if (!box) continue
      gx0 = Math.min(gx0, box.x)
      gy0 = Math.min(gy0, box.y)
      gx1 = Math.max(gx1, box.x + box.w)
      gy1 = Math.max(gy1, box.y + box.h)
    }
    if (!Number.isFinite(gx0) || !Number.isFinite(gy0) || !Number.isFinite(gx1) || !Number.isFinite(gy1)) continue
    const padHull = bucket.mode === 'wiki' ? 22 : 18
    const cx = (gx0 + gx1) / 2
    const cy = (gy0 + gy1) / 2
    hulls.push({
      id: groupId,
      label: bucket.label,
      mode: bucket.mode,
      nodeIds: bucket.ids,
      cx,
      cy,
      rx: Math.max(30, (gx1 - gx0) / 2 + padHull),
      ry: Math.max(24, (gy1 - gy0) / 2 + padHull)
    })
  }

  return { positions, boxes, width, height, hulls }
}

export function createKnowledgeGraphSimulation(
  data: KnowledgeGraphPayload,
  seed: KnowledgeGraphLayoutResult,
  opts: ForceSimulationOptions
): ForceSimulationHandle {
  const {
    gravity,
    minSurfaceGap,
    clusterMode,
    visibleEdges,
    pinnedNodePositions = new Map<string, { x: number; y: number }>(),
    onTick
  } = opts
  const nodeGroupMap = buildNodeGroupMap(data, clusterMode)
  const collisionPadForNode = (node: KgForceNode): number => {
    if (node.kind === 'source') return 16
    if (node.kind === 'wiki') return 11
    return 5
  }
  const nodes: KgForceNode[] = []
  for (const node of data.nodes) {
    const seedPos = seed.positions.get(node.id)
    if (!seedPos) continue
    const pinned = pinnedNodePositions.get(node.id)
    nodes.push({
      id: node.id,
      kind: node.kind,
      radius: nodeRadius(node),
      groupId: nodeGroupMap.get(node.id)?.id ?? 'related:unscoped',
      seedX: seedPos.x,
      seedY: seedPos.y,
      x: pinned?.x ?? seedPos.x,
      y: pinned?.y ?? seedPos.y,
      fx: pinned?.x,
      fy: pinned?.y
    })
  }

  const links: KgForceLink[] = data.edges
    .filter((edge) => visibleEdges[edge.kind])
    .map((edge) => {
      const salience = edgeSalience(edge)
      const confidenceScale = edge.confidence == null ? 0.9 : Math.max(0.55, Math.min(1.4, edge.confidence + 0.35))
      return {
        source: edge.from,
        target: edge.to,
        kind: edge.kind,
        salience,
        distance: edgeBaseDistance(edge.kind) * (1.2 - salience * 0.35),
        strength: edgeBaseStrength(edge.kind) * confidenceScale * (0.5 + gravity * 0.8)
      }
    })

  if (nodes.length >= WORKER_LAYOUT_NODE_THRESHOLD) {
    return createWorkerSimulationHandle(data, seed, opts, nodes, links, nodeGroupMap)
  }

  const simulation = forceSimulation<KgForceNode, KgForceLink>(nodes)
    .alpha(0.92)
    .alphaMin(0.02)
    .alphaDecay(0.065)
    .velocityDecay(0.43)
    .force(
      'link',
      forceLink<KgForceNode, KgForceLink>(links)
        .id((node) => node.id)
        .distance((link) => link.distance)
        .strength((link) => link.strength)
    )
    .force('charge', forceManyBody<KgForceNode>().strength(-34 - gravity * 88))
    .force(
      'collide',
      forceCollide<KgForceNode>()
        .radius((node) => node.radius + collisionPadForNode(node) + minSurfaceGap * 0.62)
        .strength(0.99)
    )
    .force('anchorX', forceX<KgForceNode>((node) => node.seedX).strength(0.015 + gravity * 0.015))
    .force('anchorY', forceY<KgForceNode>((node) => node.seedY).strength(0.015 + gravity * 0.018))
    .force('cluster', makeClusterForce(nodes, gravity))
    .force('center', forceCenter<KgForceNode>(seed.width / 2, seed.height / 2).strength(0.02))
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))

  let raf = 0
  let lastTickEmitMs = 0
  const emitTick = () => {
    raf = 0
    for (const node of nodes) {
      const vx = node.vx ?? 0
      const vy = node.vy ?? 0
      const speed = Math.hypot(vx, vy)
      const cap = 3.8
      if (speed > cap && speed > 0) {
        const m = cap / speed
        node.vx = vx * m
        node.vy = vy * m
      }
    }
    onTick(buildSnapshot(data, nodes, nodeGroupMap, seed))
  }

  simulation.on('tick', () => {
    const now = globalThis.performance.now()
    if (simulation.alpha() > 0.08 && now - lastTickEmitMs < 30) return
    lastTickEmitMs = now
    if (raf !== 0) return
    raf = globalThis.requestAnimationFrame(emitTick)
  })

  onTick(buildSnapshot(data, nodes, nodeGroupMap, seed))

  return {
    simulation,
    dragNode(nodeId, x, y) {
      const node = nodeById.get(nodeId)
      if (!node) return
      node.fx = x
      node.fy = y
      node.x = x
      node.y = y
      node.vx = 0
      node.vy = 0
      simulation.alphaTarget(0.22).restart()
      simulation.alpha(0.45)
    },
    pinNode(nodeId, pos) {
      const node = nodeById.get(nodeId)
      if (!node) return
      if (!pos) {
        node.fx = null
        node.fy = null
      } else {
        node.fx = pos.x
        node.fy = pos.y
        node.x = pos.x
        node.y = pos.y
      }
      simulation.alphaTarget(0.12).restart()
    },
    reheat(alpha = 0.38) {
      simulation.alphaTarget(0.14).alpha(Math.max(simulation.alpha(), alpha)).restart()
    },
    destroy() {
      if (raf !== 0) {
        globalThis.cancelAnimationFrame(raf)
        raf = 0
      }
      simulation.stop()
    }
  }
}

function createWorkerSimulationHandle(
  data: KnowledgeGraphPayload,
  seed: KnowledgeGraphLayoutResult,
  opts: ForceSimulationOptions,
  nodes: KgForceNode[],
  links: KgForceLink[],
  nodeGroupMap: Map<string, { id: string; mode: KnowledgeGraphClusterMode | 'wiki'; label: string }>
): ForceSimulationHandle {
  const worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))
  let disposed = false
  const onMessage = (event: MessageEvent<{ type: 'snapshot'; positions: Array<{ id: string; x: number; y: number }> }>) => {
    if (disposed) return
    if (event.data?.type !== 'snapshot') return
    for (const p of event.data.positions) {
      const node = nodeById.get(p.id)
      if (!node) continue
      node.x = p.x
      node.y = p.y
    }
    opts.onTick(buildSnapshot(data, nodes, nodeGroupMap, seed))
  }
  worker.addEventListener('message', onMessage)

  worker.postMessage({
    type: 'init',
    gravity: opts.gravity,
    nodes: nodes.map((node) => ({
      id: node.id,
      x: Number.isFinite(node.x) ? Number(node.x) : node.seedX,
      y: Number.isFinite(node.y) ? Number(node.y) : node.seedY,
      seedX: node.seedX,
      seedY: node.seedY,
      groupId: node.groupId
    })),
    edges: links.map((link) => ({
      from: typeof link.source === 'string' ? link.source : link.source.id,
      to: typeof link.target === 'string' ? link.target : link.target.id,
      weight: link.salience
    }))
  })
  opts.onTick(buildSnapshot(data, nodes, nodeGroupMap, seed))

  return {
    simulation: {} as Simulation<KgForceNode, KgForceLink>,
    dragNode(nodeId, x, y) {
      if (disposed) return
      const node = nodeById.get(nodeId)
      if (node) {
        node.fx = x
        node.fy = y
        node.x = x
        node.y = y
      }
      worker.postMessage({ type: 'drag', nodeId, x, y })
    },
    pinNode(nodeId, pos) {
      if (disposed) return
      const node = nodeById.get(nodeId)
      if (!node) return
      if (!pos) {
        node.fx = null
        node.fy = null
        worker.postMessage({ type: 'pin', nodeId, x: null, y: null })
        return
      }
      node.fx = pos.x
      node.fy = pos.y
      node.x = pos.x
      node.y = pos.y
      worker.postMessage({ type: 'pin', nodeId, x: pos.x, y: pos.y })
    },
    reheat(alpha = 0.38) {
      if (disposed) return
      worker.postMessage({ type: 'reheat', alpha })
    },
    destroy() {
      if (disposed) return
      disposed = true
      worker.postMessage({ type: 'destroy' })
      worker.removeEventListener('message', onMessage)
      worker.terminate()
    }
  }
}
