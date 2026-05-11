/// <reference lib="webworker" />

type InitNode = {
  id: string
  x: number
  y: number
  seedX: number
  seedY: number
  groupId: string
}

type InitEdge = {
  from: string
  to: string
  weight: number
}

type WorkerInitMessage = {
  type: 'init'
  nodes: InitNode[]
  edges: InitEdge[]
  gravity: number
}

type WorkerDragMessage = {
  type: 'drag'
  nodeId: string
  x: number
  y: number
}

type WorkerPinMessage = {
  type: 'pin'
  nodeId: string
  x: number | null
  y: number | null
}

type WorkerReheatMessage = {
  type: 'reheat'
  alpha: number
}

type WorkerDestroyMessage = {
  type: 'destroy'
}

type MessageIn = WorkerInitMessage | WorkerDragMessage | WorkerPinMessage | WorkerReheatMessage | WorkerDestroyMessage

type MessageOut = {
  type: 'snapshot'
  positions: Array<{ id: string; x: number; y: number }>
}

let nodes: InitNode[] = []
let edges: InitEdge[] = []
let pinned = new Map<string, { x: number; y: number }>()
let alpha = 0.25
let gravity = 0.72
let timer: number | null = null
let nodeById = new Map<string, InitNode>()

const MAX_EDGES_PER_TICK = 12000

function ensureTimer(): void {
  if (timer != null) return
  timer = self.setInterval(tick, 33)
}

function stopTimer(): void {
  if (timer == null) return
  self.clearInterval(timer)
  timer = null
}

function emit(): void {
  const payload: MessageOut = {
    type: 'snapshot',
    positions: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }))
  }
  self.postMessage(payload)
}

function tick(): void {
  if (nodes.length === 0) return
  const groupCenters = new Map<string, { x: number; y: number; c: number }>()
  for (const node of nodes) {
    const g = groupCenters.get(node.groupId) ?? { x: 0, y: 0, c: 0 }
    g.x += node.x
    g.y += node.y
    g.c += 1
    groupCenters.set(node.groupId, g)
  }
  for (const [groupId, c] of groupCenters) {
    groupCenters.set(groupId, { x: c.x / Math.max(1, c.c), y: c.y / Math.max(1, c.c), c: c.c })
  }

  const pullToSeed = 0.013 + gravity * 0.015
  const pullToGroup = 0.006 + gravity * 0.01
  for (const node of nodes) {
    const pin = pinned.get(node.id)
    if (pin) {
      node.x = pin.x
      node.y = pin.y
      continue
    }
    const group = groupCenters.get(node.groupId)
    const gx = group?.x ?? node.seedX
    const gy = group?.y ?? node.seedY
    node.x += (node.seedX - node.x) * pullToSeed * alpha + (gx - node.x) * pullToGroup * alpha
    node.y += (node.seedY - node.y) * pullToSeed * alpha + (gy - node.y) * pullToGroup * alpha
  }

  for (let i = 0; i < Math.min(edges.length, MAX_EDGES_PER_TICK); i++) {
    const edge = edges[i]!
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (!from || !to) continue
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.max(1, Math.hypot(dx, dy))
    const ideal = 90 - edge.weight * 26
    const delta = (dist - ideal) / dist
    const strength = (0.011 + edge.weight * 0.02) * alpha
    if (!pinned.has(from.id)) {
      from.x += dx * delta * strength
      from.y += dy * delta * strength
    }
    if (!pinned.has(to.id)) {
      to.x -= dx * delta * strength
      to.y -= dy * delta * strength
    }
  }

  alpha = Math.max(0.03, alpha * 0.982)
  emit()
}

self.onmessage = (event: MessageEvent<MessageIn>) => {
  const msg = event.data
  if (msg.type === 'init') {
    nodes = msg.nodes.map((n) => ({ ...n }))
    edges = msg.edges
    gravity = msg.gravity
    alpha = 0.32
    pinned = new Map<string, { x: number; y: number }>()
    nodeById = new Map(nodes.map((n) => [n.id, n] as const))
    ensureTimer()
    emit()
    return
  }
  if (msg.type === 'drag') {
    const node = nodeById.get(msg.nodeId)
    if (!node) return
    node.x = msg.x
    node.y = msg.y
    pinned.set(msg.nodeId, { x: msg.x, y: msg.y })
    alpha = Math.max(alpha, 0.24)
    emit()
    return
  }
  if (msg.type === 'pin') {
    const node = nodeById.get(msg.nodeId)
    if (!node) return
    if (msg.x == null || msg.y == null) {
      pinned.delete(msg.nodeId)
      alpha = Math.max(alpha, 0.16)
      return
    }
    pinned.set(msg.nodeId, { x: msg.x, y: msg.y })
    node.x = msg.x
    node.y = msg.y
    emit()
    return
  }
  if (msg.type === 'reheat') {
    alpha = Math.max(alpha, Math.max(0.06, Math.min(0.55, msg.alpha)))
    return
  }
  if (msg.type === 'destroy') {
    stopTimer()
  }
}
