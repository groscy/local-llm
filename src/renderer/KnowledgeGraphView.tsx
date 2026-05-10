import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { buildKnowledgeGraphSourceGroups, type KnowledgeGraphAnalysisResult } from '@shared/knowledgeGraphAnalysis'
import type {
  KnowledgeGraphClusterMode,
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeKind,
  KnowledgeGraphNode,
  KnowledgeGraphPayload
} from '@shared/types'
import { buildKnowledgeGraphLayout, kgEdgePath, nodeRadius } from './knowledgeGraph/buildKnowledgeGraphLayout'
import {
  createKnowledgeGraphSimulation,
  KG_GRAVITY_STORAGE_KEY,
  KG_MIN_GAP_STORAGE_KEY,
  readStoredGravity,
  readStoredMinSurfaceGap,
  type EdgeVisibility,
  type ForceSnapshot
} from './knowledgeGraph/forceSimulationLayout'
import { useKnowledgeGraphViewport } from './knowledgeGraph/useKnowledgeGraphViewport'
import { KnowledgeGraphWebGLCanvas, type WebGLRenderEdge, type WebGLRenderNode } from './knowledgeGraph/KnowledgeGraphWebGLCanvas'

const CLUSTER_STROKE: string[] = [
  'hsl(200 55% 52%)',
  'hsl(280 45% 58%)',
  'hsl(140 50% 42%)',
  'hsl(32 85% 48%)',
  'hsl(340 55% 52%)',
  'hsl(175 45% 45%)',
  'hsl(55 70% 42%)',
  'hsl(220 40% 60%)'
]

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}...`
}

type LodTier = 'overview' | 'mid' | 'detail'

const LABEL_FONT_BY_KIND: Record<KnowledgeGraphNode['kind'], { size: number; weight: number }> = {
  source: { size: 10, weight: 600 },
  wiki: { size: 9, weight: 500 },
  chunk: { size: 8.5, weight: 500 }
}

function measureLabelWidth(
  cache: Map<string, number>,
  ctx: CanvasRenderingContext2D | null,
  text: string,
  font: { size: number; weight: number }
): number {
  if (!text) return 0
  const key = `${font.weight}-${font.size}:${text}`
  const cached = cache.get(key)
  if (cached != null) return cached
  if (!ctx) {
    const fallback = text.length * font.size * 0.58
    cache.set(key, fallback)
    return fallback
  }
  ctx.font = `${font.weight} ${font.size}px Inter, system-ui, sans-serif`
  const width = ctx.measureText(text).width
  cache.set(key, width)
  return width
}

function truncateToPixelWidth(
  truncateCache: Map<string, string>,
  widthCache: Map<string, number>,
  ctx: CanvasRenderingContext2D | null,
  text: string,
  maxWidth: number,
  font: { size: number; weight: number }
): string {
  if (maxWidth <= 0 || !text) return ''
  const key = `${font.weight}-${font.size}-${Math.round(maxWidth)}:${text}`
  const cached = truncateCache.get(key)
  if (cached != null) return cached
  if (measureLabelWidth(widthCache, ctx, text, font) <= maxWidth) {
    truncateCache.set(key, text)
    return text
  }
  const ellipsis = '...'
  let lo = 0
  let hi = text.length
  let best = ellipsis
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const attempt = `${text.slice(0, Math.max(0, mid)).trimEnd()}${ellipsis}`
    const width = measureLabelWidth(widthCache, ctx, attempt, font)
    if (width <= maxWidth) {
      best = attempt
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  truncateCache.set(key, best)
  return best
}

function hubSourceSet(analysis: KnowledgeGraphAnalysisResult | null | undefined): Set<string> {
  const s = new Set<string>()
  if (!analysis?.hubs) return s
  for (const h of analysis.hubs) s.add(h.sourceId)
  return s
}

function edgeSalience(edge: KnowledgeGraphEdge): number {
  if (typeof edge.salience === 'number') return Math.max(0, Math.min(1, edge.salience))
  const kindBoost =
    edge.kind === 'contains'
      ? 0.76
      : edge.kind === 'compiled_from'
        ? 0.69
        : edge.kind === 'indexes'
          ? 0.58
          : 0.4
  const confidence = edge.confidence == null ? 0.62 : Math.max(0, Math.min(1, edge.confidence))
  const recency = edge.recency == null ? 0.55 : Math.max(0, Math.min(1, edge.recency))
  return Math.max(0.08, Math.min(1, kindBoost * 0.56 + confidence * 0.24 + recency * 0.2))
}

export type KnowledgeGraphAnalysisPanelProps = {
  busy: boolean
  error: string | null
  summary: string | null
  markdown: string | null
  ingestedId: string | null
  result?: KnowledgeGraphAnalysisResult | null
}

export function KnowledgeGraphView(props: {
  data: KnowledgeGraphPayload | null
  loading: boolean
  onRefresh: () => void
  onPickSource?: (sourceId: string) => void
  onPickDestination?: (destination: { sourceId: string; sectionOrd?: number | null; sectionAnchor?: string | null }) => void
  hideToolbarTitle?: boolean
  onInspectNode?: (payload: { node: KnowledgeGraphNode; anchorClient: { x: number; y: number } }) => void
  graphAnalysis?: KnowledgeGraphAnalysisPanelProps
  onRunGraphAnalysis?: (opts: { ingestReport: boolean }) => void
}): ReactNode {
  const { data, loading, onRefresh, onPickSource, onPickDestination, hideToolbarTitle, onInspectNode, graphAnalysis, onRunGraphAnalysis } = props
  const graphInitialLoad = loading && data == null
  const analysisBusy = graphAnalysis?.busy ?? false
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [layoutW, setLayoutW] = useState(640)
  const [wrapSize, setWrapSize] = useState({ w: 640, h: 420 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [collapsedSourceIds, setCollapsedSourceIds] = useState<Set<string>>(() => new Set())
  const [edgeShow, setEdgeShow] = useState<EdgeVisibility>({
    contains: true,
    indexes: true,
    compiled_from: true,
    related: false,
    semantic_related: true
  })
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(true)
  const [minimapOpen, setMinimapOpen] = useState(true)
  const [minimalTextMode, setMinimalTextMode] = useState(true)
  const [rendererPreference, setRendererPreference] = useState<'auto' | 'svg' | 'webgl'>(() => {
    try {
      const raw = globalThis.localStorage?.getItem('kgRendererPreference')
      return raw === 'svg' || raw === 'webgl' ? raw : 'auto'
    } catch {
      return 'auto'
    }
  })
  const [clusterMode, setClusterMode] = useState<KnowledgeGraphClusterMode>('domain')
  const [kbdFocusId, setKbdFocusId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [semanticGravity, setSemanticGravity] = useState(() => readStoredGravity())
  const [minSurfaceGap, setMinSurfaceGap] = useState(() => readStoredMinSurfaceGap())
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [pinnedNodePositions, setPinnedNodePositions] = useState<Record<string, { x: number; y: number }>>({})
  const pinnedNodePositionsRef = useRef<Record<string, { x: number; y: number }>>({})
  const [forceLayout, setForceLayout] = useState<ForceSnapshot | null>(null)
  const obsPatternId = useId().replace(/:/g, '')

  useLayoutEffect(() => {
    try {
      globalThis.localStorage?.setItem(KG_GRAVITY_STORAGE_KEY, String(semanticGravity))
    } catch {
      /* ignore */
    }
  }, [semanticGravity])

  useLayoutEffect(() => {
    try {
      globalThis.localStorage?.setItem(KG_MIN_GAP_STORAGE_KEY, String(minSurfaceGap))
    } catch {
      /* ignore */
    }
  }, [minSurfaceGap])

  useLayoutEffect(() => {
    try {
      if (rendererPreference === 'auto') globalThis.localStorage?.removeItem('kgRendererPreference')
      else globalThis.localStorage?.setItem('kgRendererPreference', rendererPreference)
    } catch {
      /* ignore */
    }
  }, [rendererPreference])

  useLayoutEffect(() => {
    const canvas = globalThis.document?.createElement('canvas')
    if (!canvas) {
      labelMeasureCtxRef.current = null
      return
    }
    labelMeasureCtxRef.current = canvas.getContext('2d')
  }, [])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr || cr.width <= 40) return
      setLayoutW(Math.floor(cr.width))
      setWrapSize({ w: Math.floor(cr.width), h: Math.max(120, Math.floor(cr.height)) })
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    if (rect.width > 40) {
      setLayoutW(Math.floor(rect.width))
      setWrapSize({ w: Math.floor(rect.width), h: Math.max(120, Math.floor(rect.height)) })
    }
    return () => ro.disconnect()
  }, [])

  const seedLayout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null
    return buildKnowledgeGraphLayout(data, {
      containerWidth: layoutW,
      collapsedSourceIds,
      clusterMode
    })
  }, [data, layoutW, collapsedSourceIds, clusterMode])

  const topologyKey = data
    ? `${data.nodes.length}-${data.edges.length}-${[...collapsedSourceIds].sort().join(',')}-${clusterMode}`
    : '0'

  useEffect(() => {
    pinnedNodePositionsRef.current = {}
    setPinnedNodePositions({})
    setSelectedNodeId(null)
  }, [topologyKey])

  useEffect(
    () => () => {
      if (centerAnimRef.current != null) {
        globalThis.cancelAnimationFrame(centerAnimRef.current)
        centerAnimRef.current = null
      }
    },
    []
  )

  const simRef = useRef<ReturnType<typeof createKnowledgeGraphSimulation> | null>(null)
  useEffect(() => {
    if (!data || !seedLayout) {
      setForceLayout(null)
      return
    }
    simRef.current?.destroy()
    const pinned = new Map<string, { x: number; y: number }>(Object.entries(pinnedNodePositionsRef.current))
    const sim = createKnowledgeGraphSimulation(data, seedLayout, {
      gravity: semanticGravity,
      minSurfaceGap,
      clusterMode,
      visibleEdges: edgeShow,
      pinnedNodePositions: pinned,
      onTick: (snapshot) => {
        pendingSnapshotRef.current = snapshot
        if (tickRafRef.current != null) return
        tickRafRef.current = globalThis.requestAnimationFrame(() => {
          tickRafRef.current = null
          const next = pendingSnapshotRef.current
          pendingSnapshotRef.current = null
          if (next) setForceLayout(next)
        })
      }
    })
    simRef.current = sim
    return () => {
      sim.destroy()
      if (tickRafRef.current != null) {
        globalThis.cancelAnimationFrame(tickRafRef.current)
        tickRafRef.current = null
      }
      pendingSnapshotRef.current = null
    }
  }, [data, seedLayout, semanticGravity, minSurfaceGap, clusterMode, edgeShow])

  const displayLayout = forceLayout ?? seedLayout

  const vpApi = useKnowledgeGraphViewport(wrapRef, {
    contentW: displayLayout?.width ?? 1,
    contentH: displayLayout?.height ?? 1,
    resetKey: topologyKey
  })
  const vpApiRef = useRef(vpApi)
  vpApiRef.current = vpApi

  const displayLayoutRef = useRef(displayLayout)
  displayLayoutRef.current = displayLayout

  const nodeDragActiveRef = useRef<{
    id: string
    startClient: { x: number; y: number }
    startWorld: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const suppressNodeClickRef = useRef(false)
  const centerAnimRef = useRef<number | null>(null)
  const tickRafRef = useRef<number | null>(null)
  const pendingSnapshotRef = useRef<ForceSnapshot | null>(null)
  const perfRef = useRef<{ samples: number; totalMs: number; lastReportTs: number }>({ samples: 0, totalMs: 0, lastReportTs: 0 })
  const labelMeasureCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const labelWidthCacheRef = useRef<Map<string, number>>(new Map())
  const labelTruncateCacheRef = useRef<Map<string, string>>(new Map())

  const onWrapPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = nodeDragActiveRef.current
    const lay = displayLayoutRef.current
    if (d && lay) {
      const scale = vpApiRef.current.viewport.scale
      const worldX = d.startWorld.x + (e.clientX - d.startClient.x) / scale
      const worldY = d.startWorld.y + (e.clientY - d.startClient.y) / scale
      if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) > 4) d.moved = true
      simRef.current?.dragNode(d.id, worldX, worldY)
      pinnedNodePositionsRef.current = { ...pinnedNodePositionsRef.current, [d.id]: { x: worldX, y: worldY } }
    }
    vpApiRef.current.onPointerMove(e)
  }, [])

  const onWrapPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.closest('.kg-node') && !target.closest('.kg-map-interactive') && !target.closest('.kg-webgl-canvas')) {
      setSelectedNodeId(null)
      setKbdFocusId(null)
    }
    vpApiRef.current.onPointerDown(e)
  }, [])

  const onWrapPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = nodeDragActiveRef.current
    if (d) {
      if (d.moved) suppressNodeClickRef.current = true
      nodeDragActiveRef.current = null
      setDraggingNodeId(null)
      try {
        wrapRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      setPinnedNodePositions(pinnedNodePositionsRef.current)
      simRef.current?.reheat(0.32)
    }
    vpApiRef.current.onPointerUp(e)
  }, [])

  const beginNodeDrag = useCallback((e: ReactPointerEvent<SVGGElement>, n: KnowledgeGraphNode) => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('.kg-source-collapse-hit')) return
    if (n.kind === 'source' && e.shiftKey) return
    e.stopPropagation()
    e.preventDefault()
    const wrap = wrapRef.current
    const lay = displayLayoutRef.current
    if (!wrap || !lay) return
    const p = lay.positions.get(n.id)
    if (!p) return
    try {
      wrap.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    nodeDragActiveRef.current = {
      id: n.id,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: { x: p.x, y: p.y },
      moved: false
    }
    setDraggingNodeId(n.id)
    simRef.current?.pinNode(n.id, { x: p.x, y: p.y })
  }, [])

  const graphCounts = useMemo(() => {
    if (!data) return null
    const sources = data.nodes.filter((n) => n.kind === 'source').length
    const chunks = data.nodes.filter((n) => n.kind === 'chunk').length
    const wikis = data.nodes.filter((n) => n.kind === 'wiki').length
    return { sources, chunks, wikis, edges: data.edges.length }
  }, [data])

  const hubIds = useMemo(() => hubSourceSet(graphAnalysis?.result), [graphAnalysis?.result])

  const clusterStrokeBySource = useMemo(() => {
    if (!data) return new Map<string, string>()
    const groups = buildKnowledgeGraphSourceGroups(data, clusterMode)
    const map = new Map<string, string>()
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!
      const stroke = CLUSTER_STROKE[i % CLUSTER_STROKE.length]
      for (const sourceId of group.sourceIds) map.set(sourceId, stroke)
    }
    return map
  }, [data, clusterMode])

  const kbdOrderIds = useMemo(() => {
    if (!data || !displayLayout) return [] as string[]
    const pos = displayLayout.positions
    const wikis = data.nodes.filter((n) => n.kind === 'wiki').map((n) => n.id)
    const sources = data.nodes.filter((n) => n.kind === 'source').map((n) => n.id)
    const chunks = data.nodes
      .filter((n) => n.kind === 'chunk' && n.sourceId && !collapsedSourceIds.has(n.sourceId) && pos.has(n.id))
      .map((n) => n.id)
    return [...wikis, ...sources, ...chunks]
  }, [data, displayLayout, collapsedSourceIds])

  useLayoutEffect(() => {
    if (kbdFocusId && !kbdOrderIds.includes(kbdFocusId)) setKbdFocusId(null)
  }, [kbdFocusId, kbdOrderIds])

  const toggleSourceCollapse = useCallback((sourceId: string) => {
    setCollapsedSourceIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }, [])

  const clearPinnedNodes = useCallback(() => {
    pinnedNodePositionsRef.current = {}
    setPinnedNodePositions({})
    if (data) {
      for (const node of data.nodes) simRef.current?.pinNode(node.id, null)
    }
    simRef.current?.reheat(0.5)
  }, [data])

  const collapseAllChunks = useCallback(() => {
    if (!data) return
    setCollapsedSourceIds(new Set(data.nodes.filter((n) => n.kind === 'source').map((n) => n.id)))
  }, [data])

  const expandAllChunks = useCallback(() => {
    setCollapsedSourceIds(new Set())
  }, [])

  const edgeHighlight = useCallback(
    (from: string, to: string): boolean => {
      const focus = hoverId ?? kbdFocusId ?? selectedNodeId
      if (!focus) return false
      return from === focus || to === focus
    },
    [hoverId, kbdFocusId, selectedNodeId]
  )

  const relatedEdgeVisible = useCallback(
    (from: string, to: string): boolean => {
      if (edgeShow.related) return true
      const focus = hoverId ?? kbdFocusId ?? selectedNodeId
      if (!focus) return false
      return from === focus || to === focus
    },
    [edgeShow.related, hoverId, kbdFocusId, selectedNodeId]
  )

  const centerNodeInViewport = useCallback((nodeId: string) => {
    const lay = displayLayoutRef.current
    const wrap = wrapRef.current
    if (!lay || !wrap) return
    const p = lay.positions.get(nodeId)
    if (!p) return
    const start = vpApiRef.current.viewport
    const targetTx = wrap.clientWidth / 2 - p.x * start.scale
    const targetTy = wrap.clientHeight / 2 - p.y * start.scale
    const delta = Math.hypot(targetTx - start.tx, targetTy - start.ty)
    if (delta < 16) return
    const durationMs = 180
    const startedAt = globalThis.performance.now()
    if (centerAnimRef.current != null) globalThis.cancelAnimationFrame(centerAnimRef.current)
    const tick = (): void => {
      const t = Math.min(1, (globalThis.performance.now() - startedAt) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      vpApiRef.current.setViewport((prev) => ({
        ...prev,
        tx: start.tx + (targetTx - start.tx) * eased,
        ty: start.ty + (targetTy - start.ty) * eased
      }))
      if (t < 1) centerAnimRef.current = globalThis.requestAnimationFrame(tick)
      else centerAnimRef.current = null
    }
    centerAnimRef.current = globalThis.requestAnimationFrame(tick)
  }, [])

  const resolveNodeDestination = useCallback(
    (node: KnowledgeGraphNode): { sourceId: string; sectionOrd?: number | null; sectionAnchor?: string | null } | null => {
      const sourceId =
        node.kind === 'source'
          ? node.id
          : node.kind === 'chunk'
            ? node.sourceId || node.targetSourceId
            : node.targetSourceId || (node.id.startsWith('src:') ? node.id.slice(4) : '')
      if (!sourceId) return null
      return {
        sourceId,
        sectionOrd: node.kind === 'chunk' ? node.sectionOrd ?? null : null,
        sectionAnchor: node.kind === 'chunk' ? node.sectionAnchor ?? null : null
      }
    },
    []
  )

  const onNodeClick = useCallback(
    (node: KnowledgeGraphNode, e?: ReactMouseEvent) => {
      if (suppressNodeClickRef.current) {
        suppressNodeClickRef.current = false
        return
      }
      if (e?.altKey) {
        const cur = pinnedNodePositionsRef.current
        if (!(node.id in cur)) return
        const next = { ...cur }
        delete next[node.id]
        pinnedNodePositionsRef.current = next
        setPinnedNodePositions(next)
        simRef.current?.pinNode(node.id, null)
        simRef.current?.reheat(0.34)
        return
      }
      if (node.kind === 'source' && e?.shiftKey) {
        e.preventDefault()
        toggleSourceCollapse(node.id)
        return
      }
      setSelectedNodeId(node.id)
      setKbdFocusId(node.id)
      centerNodeInViewport(node.id)
      if (onInspectNode) {
        const lay = displayLayoutRef.current
        const p = lay?.positions.get(node.id)
        const wrapRect = wrapRef.current?.getBoundingClientRect()
        if (e) {
          onInspectNode({ node, anchorClient: { x: e.clientX, y: e.clientY } })
        } else if (p && wrapRect) {
          onInspectNode({
            node,
            anchorClient: {
              x: wrapRect.left + vpApiRef.current.viewport.tx + p.x * vpApiRef.current.viewport.scale,
              y: wrapRect.top + vpApiRef.current.viewport.ty + p.y * vpApiRef.current.viewport.scale
            }
          })
        }
      }
      const destination = resolveNodeDestination(node)
      if (destination) {
        if (onPickDestination) onPickDestination(destination)
        else onPickSource?.(destination.sourceId)
      }
    },
    [centerNodeInViewport, onInspectNode, onPickDestination, onPickSource, resolveNodeDestination, toggleSourceCollapse]
  )

  const activateKbdFocus = useCallback(() => {
    if (!data || !kbdFocusId) return
    const node = data.nodes.find((n) => n.id === kbdFocusId)
    if (node) onNodeClick(node)
  }, [data, kbdFocusId, onNodeClick])

  const onStageKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!kbdOrderIds.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        setKbdFocusId((cur) => {
          if (!cur) return kbdOrderIds[0] ?? null
          const i = kbdOrderIds.indexOf(cur)
          if (i < 0) return kbdOrderIds[0] ?? null
          return kbdOrderIds[Math.min(kbdOrderIds.length - 1, i + 1)] ?? null
        })
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setKbdFocusId((cur) => {
          if (!cur) return kbdOrderIds[kbdOrderIds.length - 1] ?? null
          const i = kbdOrderIds.indexOf(cur)
          if (i < 0) return kbdOrderIds[0] ?? null
          return kbdOrderIds[Math.max(0, i - 1)] ?? null
        })
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        activateKbdFocus()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setKbdFocusId(null)
        setSelectedNodeId(null)
      }
    },
    [kbdOrderIds, activateKbdFocus]
  )

  const analysisPanelInner =
    graphAnalysis &&
    (graphAnalysis.error || graphAnalysis.summary || graphAnalysis.markdown || graphAnalysis.ingestedId) ? (
      <>
        {graphAnalysis.error ? (
          <p className="kg-analysis-error" role="alert">
            {graphAnalysis.error}
          </p>
        ) : null}
        {graphAnalysis.summary ? <p className="kg-analysis-summary">{graphAnalysis.summary}</p> : null}
        {graphAnalysis.ingestedId ? <p className="muted kg-analysis-ingested">Report saved as a new library document.</p> : null}
        {graphAnalysis.markdown ? (
          <details className="kg-analysis-details">
            <summary>Full report (Markdown)</summary>
            <pre className="kg-analysis-md">{graphAnalysis.markdown}</pre>
          </details>
        ) : null}
      </>
    ) : null

  const analysisPanel =
    graphAnalysis && analysisPanelInner ? (
      <div className="kg-analysis kg-analysis--collapsible" aria-live="polite">
        <button
          type="button"
          className="btn-secondary btn-sm kg-analysis-toggle"
          onClick={() => setAnalysisOpen((o) => !o)}
          aria-expanded={analysisOpen}
        >
          {analysisOpen ? 'Hide analysis' : 'Show analysis'}
        </button>
        {analysisOpen ? <div className="kg-analysis-body">{analysisPanelInner}</div> : null}
      </div>
    ) : null

  const minimapClick = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      if (!displayLayout || !wrapRef.current) return
      const rect = e.currentTarget.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const mw = 120
      const mh = 86
      const mm = Math.min(mw / displayLayout.width, mh / displayLayout.height)
      const worldX = Math.max(0, Math.min(displayLayout.width, mx / mm))
      const worldY = Math.max(0, Math.min(displayLayout.height, my / mm))
      const vw = wrapRef.current.clientWidth
      const vh = wrapRef.current.clientHeight
      vpApi.setViewport((prev) => ({
        scale: prev.scale,
        tx: vw / 2 - worldX * prev.scale,
        ty: vh / 2 - worldY * prev.scale
      }))
    },
    [displayLayout, vpApi]
  )

  const renderMinimap = () => {
    if (!displayLayout || !minimapOpen) return null
    const mw = 120
    const mh = 86
    const mm = Math.min(mw / displayLayout.width, mh / displayLayout.height)
    const { scale: zs, tx, ty } = vpApi.viewport
    const worldLeft = -tx / zs
    const worldTop = -ty / zs
    const worldW = wrapSize.w / zs
    const worldH = wrapSize.h / zs
    const worldWm = displayLayout.width * mm
    const worldHm = displayLayout.height * mm
    const vx = Math.max(0, Math.min(worldWm - 4, worldLeft * mm))
    const vy = Math.max(0, Math.min(worldHm - 4, worldTop * mm))
    const vwClamped = Math.min(worldWm - vx, Math.max(4, worldW * mm))
    const vhClamped = Math.min(worldHm - vy, Math.max(4, worldH * mm))
    return (
      <div className="kg-minimap" data-kg-no-pan="" role="presentation" onPointerDown={minimapClick} title="Click to center view on point">
        <svg width={mw + 2} height={mh + 2} viewBox={`0 0 ${mw + 2} ${mh + 2}`} className="kg-minimap-svg">
          <rect x={0.5} y={0.5} width={worldWm} height={worldHm} className="kg-minimap-world" rx={2} />
          <rect x={0.5 + vx} y={0.5 + vy} width={vwClamped} height={vhClamped} className="kg-minimap-vp" rx={1} />
        </svg>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="kg-panel">
        <p className="muted kg-empty">Loading graph...</p>
        {analysisPanel}
      </div>
    )
  }

  if (!data || data.nodes.length === 0 || !displayLayout) {
    return (
      <div className="kg-panel">
        <p className="muted kg-empty">No sources yet. Use + Add document in the library to ingest text, then open this view again.</p>
        {analysisPanel}
      </div>
    )
  }

  const { positions, boxes } = displayLayout
  const hulls = forceLayout?.hulls ?? []
  const { tx, ty, scale: zs } = vpApi.viewport
  const autoWebgl =
    data.nodes.length > 1300 &&
    (data.nodes.every((n) => n.kind === 'source') || data.nodes.filter((n) => n.kind === 'source').length > data.nodes.length * 0.8)
  const activeRenderer = rendererPreference === 'auto' ? (autoWebgl ? 'webgl' : 'svg') : rendererPreference
  const hideChunkLabels = zs < 0.38
  const hideWikiLabels = zs < 0.24
  const lodTier: LodTier = zs < 0.3 ? 'overview' : zs < 0.78 ? 'mid' : 'detail'
  const matrix = `translate(${tx},${ty}) scale(${zs})`
  const hoverOrFocusId = hoverId ?? kbdFocusId ?? selectedNodeId
  const worldVp = {
    x0: -tx / zs,
    y0: -ty / zs,
    x1: (wrapSize.w - tx) / zs,
    y1: (wrapSize.h - ty) / zs
  }
  const intersectsWorldViewport = (x0: number, y0: number, x1: number, y1: number, pad = 0): boolean =>
    x1 >= worldVp.x0 - pad && x0 <= worldVp.x1 + pad && y1 >= worldVp.y0 - pad && y0 <= worldVp.y1 + pad
  const nodeById = new Map(data.nodes.map((n) => [n.id, n] as const))
  const graphPerfEnabled = (() => {
    try {
      return globalThis.localStorage?.getItem('kgPerfDebug') === '1'
    } catch {
      return false
    }
  })()
  const graphDerived = (() => {
    const startedAt = globalThis.performance.now()
    if (labelWidthCacheRef.current.size > 12000) labelWidthCacheRef.current.clear()
    if (labelTruncateCacheRef.current.size > 12000) labelTruncateCacheRef.current.clear()
    const cullOnlyExtreme = zs < 0.19 && data.nodes.length > 900
    const viewportPad = cullOnlyExtreme ? 220 : lodTier === 'overview' ? 380 : 450
    const visibleNodeIds = new Set<string>()
    for (const n of data.nodes) {
      const b = boxes.get(n.id)
      if (!b) continue
      if (
        n.id === hoverOrFocusId ||
        n.id === selectedNodeId ||
        n.id === draggingNodeId ||
        n.id in pinnedNodePositions ||
        intersectsWorldViewport(b.x, b.y, b.x + b.w, b.y + b.h, viewportPad)
      ) {
        visibleNodeIds.add(n.id)
      }
    }

    const degree = new Map<string, number>()
    for (const edge of data.edges) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
    }
    const maxDegree = Math.max(1, ...degree.values())
    const importance = new Map<string, number>()
    for (const n of data.nodes) {
      const deg = (degree.get(n.id) ?? 0) / maxDegree
      const confidence = typeof n.confidence === 'number' ? Math.max(0, Math.min(1, n.confidence)) : 0.56
      const novelty = typeof n.novelty === 'number' ? Math.max(0, Math.min(1, n.novelty)) : 0.4
      importance.set(n.id, Math.max(0.04, Math.min(1, deg * 0.5 + confidence * 0.32 + novelty * 0.18)))
    }
    const focusNeighbors = new Set<string>()
    if (hoverOrFocusId) {
      focusNeighbors.add(hoverOrFocusId)
      for (const edge of data.edges) {
        if (edge.from === hoverOrFocusId) focusNeighbors.add(edge.to)
        if (edge.to === hoverOrFocusId) focusNeighbors.add(edge.from)
      }
    }
    if (selectedNodeId) {
      focusNeighbors.add(selectedNodeId)
      for (const edge of data.edges) {
        if (edge.from === selectedNodeId) focusNeighbors.add(edge.to)
        if (edge.to === selectedNodeId) focusNeighbors.add(edge.from)
      }
    }
    const nodeIsDimmed = (id: string): boolean => {
      if (hoverOrFocusId || selectedNodeId) return !focusNeighbors.has(id)
      if (lodTier === 'overview') return (importance.get(id) ?? 0) < 0.2
      if (lodTier === 'mid') return (importance.get(id) ?? 0) < 0.11
      return false
    }

    const edgeRenderList = data.edges
      .map((edge, i) => {
        const p1 = positions.get(edge.from)
        const p2 = positions.get(edge.to)
        const b1 = boxes.get(edge.from)
        const b2 = boxes.get(edge.to)
        if (!p1 || !p2 || !b1 || !b2) return null
        const hi = edgeHighlight(edge.from, edge.to)
        if (!hi && !visibleNodeIds.has(edge.from) && !visibleNodeIds.has(edge.to)) return null
        const ex0 = Math.min(p1.x, p2.x)
        const ey0 = Math.min(p1.y, p2.y)
        const ex1 = Math.max(p1.x, p2.x)
        const ey1 = Math.max(p1.y, p2.y)
        if (!hi && !intersectsWorldViewport(ex0, ey0, ex1, ey1, 220)) return null
        const visible =
          edge.kind === 'related'
            ? edgeShow.related || relatedEdgeVisible(edge.from, edge.to)
            : edgeShow[edge.kind]
        if (!visible) return null
        const salience = edgeSalience(edge)
        if (!hi) {
          if (zs < 0.42 && salience < 0.42) return null
          if (salience < 0.14) return null
        }
        return { edge, p1, p2, b1, b2, hi, salience, key: `${edge.from}-${edge.to}-${edge.kind}-${i}` }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => Number(b.hi) - Number(a.hi) || b.salience - a.salience)

    const maxAmbientEdges =
      lodTier === 'overview'
        ? Math.min(320, Math.max(170, Math.floor(data.edges.length * 0.22)))
        : lodTier === 'mid'
          ? data.edges.length > 700
            ? 440
            : 620
          : data.edges.length > 700
            ? 560
            : data.edges.length > 400
              ? 760
              : 980
    const highlighted = edgeRenderList.filter((e) => e.hi)
    const ambient = edgeRenderList.filter((e) => !e.hi).slice(0, maxAmbientEdges)
    const boundedEdges = [...highlighted, ...ambient]

    const maxLabels = lodTier === 'overview' ? 60 : lodTier === 'mid' ? 160 : 320
    const labelTextById = new Map<string, string>()
    const visibleLabelIds = new Set<string>()
    const labelBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
    const candidates = data.nodes
      .map((n) => {
        if (!visibleNodeIds.has(n.id)) return null
        if (n.kind === 'chunk' && hideChunkLabels) return null
        if (n.kind === 'wiki' && hideWikiLabels) return null
        const p = positions.get(n.id)
        if (!p) return null
        const isOverflow = n.kind === 'chunk' && n.id.startsWith('kg-overflow:')
        const baseLabel = minimalTextMode && n.shortLabel ? n.shortLabel.trim() || n.label : n.label
        const font = LABEL_FONT_BY_KIND[n.kind]
        const baseWidth = n.kind === 'source' ? (lodTier === 'detail' ? 190 : 155) : n.kind === 'wiki' ? 150 : isOverflow ? 84 : 118
        const isPrimary = n.id === selectedNodeId || n.id === hoverId || n.id === kbdFocusId
        const isNeighbor = focusNeighbors.has(n.id)
        const isHub = n.kind === 'source' && hubIds.has(n.id)
        const maxWidth = Math.round(baseWidth * (isPrimary ? 1.5 : isNeighbor ? 1.24 : 1))
        const label = truncateToPixelWidth(
          labelTruncateCacheRef.current,
          labelWidthCacheRef.current,
          labelMeasureCtxRef.current,
          baseLabel,
          maxWidth,
          font
        )
        labelTextById.set(n.id, label)
        const textWidth = Math.max(16, measureLabelWidth(labelWidthCacheRef.current, labelMeasureCtxRef.current, label, font))
        const labelHeight = n.kind === 'source' ? 11.5 : 9.5
        const interactionBoost = isPrimary ? 100 : isNeighbor ? 60 : 0
        const kindBoost = n.kind === 'source' ? 20 : n.kind === 'wiki' ? 12 : 6
        const hubBoost = isHub ? 18 : 0
        const prio = interactionBoost + kindBoost + hubBoost + (importance.get(n.id) ?? 0) * 30
        const r = nodeRadius(n)
        return {
          id: n.id,
          prio,
          x0: p.x - textWidth / 2 - 3,
          y0: p.y + r + 1,
          x1: p.x + textWidth / 2 + 3,
          y1: p.y + r + labelHeight + 4
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.prio - a.prio)
    for (const c of candidates) {
      if (visibleLabelIds.size >= maxLabels) break
      const overlaps = labelBoxes.some((b) => c.x0 < b.x1 && c.x1 > b.x0 && c.y0 < b.y1 && c.y1 > b.y0)
      if (overlaps) continue
      visibleLabelIds.add(c.id)
      labelBoxes.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })
    }

    const webglNodes: WebGLRenderNode[] = data.nodes
      .map((n) => {
        if (!visibleNodeIds.has(n.id)) return null
        const p = positions.get(n.id)
        if (!p) return null
        return {
          id: n.id,
          kind: n.kind,
          x: p.x,
          y: p.y,
          r: nodeRadius(n),
          label: labelTextById.get(n.id) ?? truncate(n.label, n.kind === 'chunk' ? 14 : 22),
          highlighted: hoverId === n.id || kbdFocusId === n.id || selectedNodeId === n.id,
          dimmed: nodeIsDimmed(n.id),
          showLabel: visibleLabelIds.has(n.id)
        } satisfies WebGLRenderNode
      })
      .filter((n): n is WebGLRenderNode => n != null)

    const webglEdges: WebGLRenderEdge[] = boundedEdges.map((e) => ({
      key: e.key,
      kind: e.edge.kind,
      x1: e.p1.x,
      y1: e.p1.y,
      x2: e.p2.x,
      y2: e.p2.y,
      salience: e.salience,
      highlighted: e.hi,
      dimmed: nodeIsDimmed(e.edge.from) && nodeIsDimmed(e.edge.to)
    }))
    const elapsed = globalThis.performance.now() - startedAt
    if (graphPerfEnabled) {
      perfRef.current.samples += 1
      perfRef.current.totalMs += elapsed
      if (globalThis.performance.now() - perfRef.current.lastReportTs > 1500) {
        const avg = perfRef.current.totalMs / Math.max(1, perfRef.current.samples)
        globalThis.console.debug('[kg-perf] derive(ms)', {
          avg: Number(avg.toFixed(2)),
          latest: Number(elapsed.toFixed(2)),
          nodes: data.nodes.length,
          edges: data.edges.length,
          lodTier
        })
        perfRef.current.samples = 0
        perfRef.current.totalMs = 0
        perfRef.current.lastReportTs = globalThis.performance.now()
      }
    }
    return {
      visibleNodeIds,
      focusNeighbors,
      importance,
      boundedEdges,
      visibleLabelIds,
      labelTextById,
      webglNodes,
      webglEdges,
      maxLabels
    }
  })()
  const { visibleNodeIds, focusNeighbors, importance, boundedEdges, visibleLabelIds, labelTextById, webglNodes, webglEdges, maxLabels } =
    graphDerived
  const nodeIsDimmed = (id: string): boolean => {
    if (hoverOrFocusId || selectedNodeId) return !focusNeighbors.has(id)
    if (lodTier === 'overview') return (importance.get(id) ?? 0) < 0.2
    if (lodTier === 'mid') return (importance.get(id) ?? 0) < 0.11
    return false
  }

  return (
    <div className="kg-panel">
      <div
        ref={wrapRef}
        className={['kg-svg-wrap kg-svg-wrap--viewport', draggingNodeId ? 'kg-svg-wrap--node-drag' : ''].filter(Boolean).join(' ')}
        onWheel={vpApi.onWheel}
        onPointerDown={onWrapPointerDown}
        onPointerMove={onWrapPointerMove}
        onPointerUp={onWrapPointerUp}
        onPointerLeave={onWrapPointerUp}
        onPointerCancel={onWrapPointerUp}
      >
        <div
          ref={stageRef}
          className="kg-graph-stage"
          tabIndex={0}
          onKeyDown={onStageKeyDown}
          aria-label="Knowledge graph canvas. Drag nodes to pin positions. Alt+click a node to unpin."
        >
          {activeRenderer === 'webgl' ? (
            <KnowledgeGraphWebGLCanvas
              width={wrapSize.w}
              height={wrapSize.h}
              tx={tx}
              ty={ty}
              scale={zs}
              nodes={webglNodes}
              edges={webglEdges}
              lodTier={lodTier}
              onNodeHover={(id) => setHoverId(id)}
              onNodeClick={(id, clientX, clientY) => {
                const node = nodeById.get(id)
                if (!node) return
                setSelectedNodeId(node.id)
                setKbdFocusId(node.id)
                centerNodeInViewport(node.id)
                if (onInspectNode) onInspectNode({ node, anchorClient: { x: clientX, y: clientY } })
                const destination = resolveNodeDestination(node)
                if (destination) {
                  if (onPickDestination) onPickDestination(destination)
                  else onPickSource?.(destination.sourceId)
                }
              }}
            />
          ) : null}
          <svg
            className={[
              'kg-graph-svg kg-graph-svg--fill kg-graph-svg--obsidian',
              activeRenderer === 'webgl' ? 'kg-graph-svg--interaction' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            width="100%"
            height="100%"
            role="img"
            aria-activedescendant={kbdFocusId ?? selectedNodeId ? `kg-node-${kbdFocusId ?? selectedNodeId}` : undefined}
            aria-label="Knowledge base structure: sources, indexed chunks, and wiki pages"
          >
            <defs>
              <pattern id={`kgObsDots-${obsPatternId}`} patternUnits="userSpaceOnUse" width={20} height={20}>
                <circle cx={1.2} cy={1.2} r={0.85} className="kg-obs-dot" />
              </pattern>
            </defs>
            <g transform={matrix}>
              <g className="kg-world-planes">
                <rect x={0} y={0} width={displayLayout.width} height={displayLayout.height} fill={`url(#kgObsDots-${obsPatternId})`} className="kg-obs-dots-layer" />
                <rect x={0} y={0} width={displayLayout.width} height={displayLayout.height} className="kg-world-bg" />
              </g>
              <g className="kg-group-hulls">
                {activeRenderer === 'svg'
                  ? hulls
                      .filter((hull) => intersectsWorldViewport(hull.cx - hull.rx, hull.cy - hull.ry, hull.cx + hull.rx, hull.cy + hull.ry, 130))
                      .map((hull) => (
                        <g key={hull.id}>
                          <ellipse
                            cx={hull.cx}
                            cy={hull.cy}
                            rx={hull.rx}
                            ry={hull.ry}
                            className={`kg-group-hull kg-group-hull--${hull.mode === 'wiki' ? 'wiki' : 'source'}`}
                          />
                          {hull.mode === 'domain' ? (
                            <text
                              x={hull.cx}
                              y={hull.cy - hull.ry + 14}
                              textAnchor="middle"
                              className="kg-group-hull-label"
                            >
                              {truncate(hull.label || 'Unscoped', 26)}
                            </text>
                          ) : null}
                        </g>
                      ))
                  : null}
              </g>
              <g className="kg-edges">
                {activeRenderer === 'svg'
                  ? boundedEdges.map((e) => (
                      <path
                        key={e.key}
                        d={kgEdgePath(e.p1, e.p2, e.edge.kind, e.b1, e.b2)}
                        className={`kg-edge kg-edge--${e.edge.kind}${e.hi ? ' kg-edge--hi' : ''}${nodeIsDimmed(e.edge.from) && nodeIsDimmed(e.edge.to) ? ' kg-edge--dim' : ''} ${e.salience > 0.72 ? 'kg-edge--tier-strong' : e.salience > 0.45 ? 'kg-edge--tier-mid' : 'kg-edge--tier-faint'}`}
                        fill="none"
                      />
                    ))
                  : null}
                {activeRenderer === 'svg' && showSuggestions && graphAnalysis?.result?.suggestedLinks
                  ? graphAnalysis.result.suggestedLinks.map((s, i) => {
                      const p1 = positions.get(s.fromSourceId)
                      const p2 = positions.get(s.toSourceId)
                      const b1 = boxes.get(s.fromSourceId)
                      const b2 = boxes.get(s.toSourceId)
                      if (!p1 || !p2 || !b1 || !b2) return null
                      const ex0 = Math.min(p1.x, p2.x)
                      const ey0 = Math.min(p1.y, p2.y)
                      const ex1 = Math.max(p1.x, p2.x)
                      const ey1 = Math.max(p1.y, p2.y)
                      if (!intersectsWorldViewport(ex0, ey0, ex1, ey1, 160)) return null
                      return (
                        <path
                          key={`sug-${s.fromSourceId}-${s.toSourceId}-${i}`}
                          d={kgEdgePath(p1, p2, 'related', b1, b2)}
                          className="kg-edge kg-edge--suggested"
                          fill="none"
                        />
                      )
                    })
                  : null}
              </g>
              <g className="kg-nodes">
                {activeRenderer === 'svg'
                  ? data.nodes.map((n) => {
                  if (!visibleNodeIds.has(n.id)) return null
                  const p = positions.get(n.id)
                  const b = boxes.get(n.id)
                  if (!p || !b) return null
                  const r = nodeRadius(n)
                  const hi = hoverId === n.id || kbdFocusId === n.id || selectedNodeId === n.id
                  const isPinned = n.id in pinnedNodePositions
                  const isOverflow = n.kind === 'chunk' && n.id.startsWith('kg-overflow:')
                  const clusterStroke = n.kind === 'source' ? clusterStrokeBySource.get(n.id) : undefined
                  const isHub = n.kind === 'source' && hubIds.has(n.id)
                  const labelText = labelTextById.get(n.id) ?? (n.kind === 'source' ? truncate(n.label, 24) : truncate(n.label, isOverflow ? 12 : 20))
                  const showLabel = visibleLabelIds.has(n.id)
                  const hasConfidenceRing = typeof n.confidence === 'number'
                  const confidencePct = Math.min(1, Math.max(0, n.confidence ?? 0))
                  const confidenceStroke = Math.max(1.2, Math.round(confidencePct * 3))
                  const isNovel = typeof n.novelty === 'number' && n.novelty > 0.66

                  if (n.kind === 'wiki') {
                    return (
                      <g
                        key={n.id}
                        id={`kg-node-${n.id}`}
                        className={`kg-node kg-node--wiki kg-node--draggable${hi ? ' kg-node--hi' : ''}${nodeIsDimmed(n.id) ? ' kg-node--dim' : ''}${isPinned ? ' kg-node--pinned' : ''}${kbdFocusId === n.id ? ' kg-node--kbd' : ''}${draggingNodeId === n.id ? ' kg-node--dragging' : ''}`}
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => beginNodeDrag(e, n)}
                        onMouseEnter={() => setHoverId(n.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={(e) => onNodeClick(n, e)}
                        tabIndex={-1}
                        aria-label={n.label}
                      >
                        <circle cx={p.x} cy={p.y} r={r} className="kg-shape kg-node-dot" />
                        {hasConfidenceRing ? (
                          <circle cx={p.x} cy={p.y} r={r + 2.2} className="kg-confidence-ring" strokeWidth={confidenceStroke} />
                        ) : null}
                        {isNovel ? <circle cx={p.x + r + 2} cy={p.y - r - 2} r={2.2} className="kg-novelty-dot" /> : null}
                        {showLabel ? (
                          <text x={p.x} y={p.y + r + 12} textAnchor="middle" className="kg-label kg-label-below">
                            {labelText}
                          </text>
                        ) : null}
                        <title>{n.label}</title>
                      </g>
                    )
                  }

                  if (n.kind === 'source') {
                    const collapsed = collapsedSourceIds.has(n.id)
                    return (
                      <g
                        key={n.id}
                        id={`kg-node-${n.id}`}
                        className={`kg-node kg-node--source kg-node--draggable${hi ? ' kg-node--hi' : ''}${nodeIsDimmed(n.id) ? ' kg-node--dim' : ''}${isHub ? ' kg-node--hub' : ''}${isPinned ? ' kg-node--pinned' : ''}${kbdFocusId === n.id ? ' kg-node--kbd' : ''}${draggingNodeId === n.id ? ' kg-node--dragging' : ''}`}
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => beginNodeDrag(e, n)}
                        onMouseEnter={() => setHoverId(n.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={(ev) => onNodeClick(n, ev)}
                        tabIndex={-1}
                        aria-label={`${n.label}${collapsed ? ' (chunks collapsed)' : ''}. Shift+click to toggle chunks.`}
                      >
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={r}
                          className="kg-shape kg-node-dot"
                          stroke={clusterStroke}
                          strokeWidth={clusterStroke ? 2.4 : undefined}
                        />
                        {hasConfidenceRing ? (
                          <circle cx={p.x} cy={p.y} r={r + 2.6} className="kg-confidence-ring" strokeWidth={confidenceStroke} />
                        ) : null}
                        {isNovel ? <circle cx={p.x + r + 2} cy={p.y - r - 2} r={2.2} className="kg-novelty-dot" /> : null}
                        {showLabel ? (
                          <text x={p.x} y={p.y + r + 13} textAnchor="middle" className="kg-label kg-label-below kg-label-below--source">
                            {labelText}
                          </text>
                        ) : null}
                        <g
                          data-kg-no-pan=""
                          className="kg-source-collapse-hit"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSourceCollapse(n.id)
                          }}
                          tabIndex={0}
                          aria-label={collapsed ? 'Expand chunks' : 'Collapse chunks'}
                        >
                          <rect x={p.x + r - 15} y={p.y - r - 2} width={14} height={14} rx={3} className="kg-source-collapse-rect" />
                          <text x={p.x + r - 8} y={p.y - r + 8} textAnchor="middle" className="kg-collapse-glyph">
                            {collapsed ? '+' : '-'}
                          </text>
                        </g>
                        <title>{`${n.label} - drag to pin; Alt+click to unpin.`}</title>
                      </g>
                    )
                  }

                  return (
                    <g
                      key={n.id}
                      id={`kg-node-${n.id}`}
                      className={`kg-node kg-node--chunk kg-node--draggable${isOverflow ? ' kg-node--overflow' : ''}${hi ? ' kg-node--hi' : ''}${nodeIsDimmed(n.id) ? ' kg-node--dim' : ''}${isPinned ? ' kg-node--pinned' : ''}${kbdFocusId === n.id ? ' kg-node--kbd' : ''}${draggingNodeId === n.id ? ' kg-node--dragging' : ''}`}
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => beginNodeDrag(e, n)}
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={(e) => onNodeClick(n, e)}
                      tabIndex={-1}
                      aria-label={n.sublabel ? `${n.label} - ${n.sublabel}` : n.label}
                    >
                      <circle cx={p.x} cy={p.y} r={r} className="kg-shape kg-node-dot" />
                      {hasConfidenceRing ? (
                        <circle cx={p.x} cy={p.y} r={r + 2.1} className="kg-confidence-ring" strokeWidth={confidenceStroke} />
                      ) : null}
                      {isNovel ? <circle cx={p.x + r + 2} cy={p.y - r - 2} r={1.8} className="kg-novelty-dot" /> : null}
                      {showLabel ? (
                        <text x={p.x} y={p.y + r + 9} textAnchor="middle" className="kg-label kg-label-below kg-label-below--chunk">
                          {labelText}
                        </text>
                      ) : null}
                      <title>{n.sublabel ? `${n.label} - ${n.sublabel}` : n.label}</title>
                    </g>
                  )
                    })
                  : null}
              </g>
            </g>
          </svg>
          {activeRenderer === 'webgl' ? (
            <div className="kg-webgl-label-layer" aria-hidden>
              {webglNodes
                .filter((n) => n.showLabel)
                .slice(0, maxLabels)
                .map((n) => (
                  <span
                    key={`wgl-lbl-${n.id}`}
                    className={`kg-webgl-label${n.dimmed ? ' kg-webgl-label--dim' : ''}`}
                    title={nodeById.get(n.id)?.label ?? n.label}
                    style={{
                      transform: `translate(${tx + n.x * zs}px, ${ty + n.y * zs}px) translate(-50%, -50%)`
                    }}
                  >
                    {n.label}
                  </span>
                ))}
            </div>
          ) : null}
          {renderMinimap()}
        </div>

        <div className="kg-map-overlay-root">
          {graphCounts || !hideToolbarTitle ? (
            <div className="kg-map-interactive kg-map-chip kg-map-chip--info" title="Nodes in this view (large libraries may be sampled)">
              {!hideToolbarTitle ? <div className="kg-map-chip-heading">Knowledge graph</div> : null}
              {graphCounts ? (
                <div className="kg-map-chip-body">
                  <span className="kg-map-chip-stats">
                    {graphCounts.sources} src - {graphCounts.chunks} chk - {graphCounts.wikis} wiki - {graphCounts.edges} e
                  </span>
                  {data?.truncated ? (
                    <span className="kg-map-chip-sampled" title="Some items omitted for performance">
                      Sampled
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="kg-map-interactive kg-map-rail kg-map-rail--zoom" role="toolbar" aria-label="Map zoom">
            <button type="button" className="kg-map-rail-btn" onClick={() => vpApi.zoomIn()} title="Zoom in">
              +
            </button>
            <button type="button" className="kg-map-rail-btn" onClick={() => vpApi.zoomOut()} title="Zoom out">
              -
            </button>
            <button type="button" className="kg-map-rail-btn kg-map-rail-btn--fit" onClick={() => vpApi.fitToView()} title="Fit graph in view">
              fit
            </button>
          </div>
          <details className="kg-map-interactive kg-map-layers">
            <summary className="kg-map-layers-trigger" title="Edges, minimap, chunks, analysis">
              <span className="kg-map-layers-trigger-icon" aria-hidden>
                ◫
              </span>
              <span className="kg-map-layers-trigger-label">Layers</span>
            </summary>
            <div className="kg-map-layers-panel" role="dialog" aria-label="Graph layers and tools" onWheel={(e) => e.stopPropagation()}>
              <p className="kg-map-layers-hint muted">Wheel zoom, drag background to pan, drag nodes to pin</p>
              <div className="kg-map-layers-section" role="group" aria-label="Edge types">
                <span className="kg-map-layers-section-title">Edges</span>
                {(['contains', 'indexes', 'compiled_from', 'related'] as const).map((kind) => (
                  <label className="kg-map-check" key={kind}>
                    <input type="checkbox" checked={edgeShow[kind]} onChange={() => setEdgeShow((s) => ({ ...s, [kind]: !s[kind] }))} />
                    {kind}
                  </label>
                ))}
              </div>
              {graphAnalysis?.result?.suggestedLinks?.length ? (
                <label className="kg-map-check kg-map-check--solo">
                  <input type="checkbox" checked={showSuggestions} onChange={() => setShowSuggestions((v) => !v)} />
                  Show suggested links
                </label>
              ) : null}
              <label className="kg-map-check kg-map-check--solo">
                <input type="checkbox" checked={minimapOpen} onChange={() => setMinimapOpen((v) => !v)} />
                Minimap
              </label>
              <label className="kg-map-check kg-map-check--solo">
                <input type="checkbox" checked={minimalTextMode} onChange={() => setMinimalTextMode((v) => !v)} />
                Minimal text
              </label>
              <div className="kg-map-layers-section">
                <span className="kg-map-layers-section-title">Renderer</span>
                <select className="input" value={rendererPreference} onChange={(e) => setRendererPreference(e.target.value as 'auto' | 'svg' | 'webgl')}>
                  <option value="auto">Auto</option>
                  <option value="webgl">WebGL (high-scale)</option>
                  <option value="svg">SVG (detailed)</option>
                </select>
                <p className="kg-map-layers-hint muted">Active: {activeRenderer.toUpperCase()} - LOD: {lodTier}</p>
              </div>
              <div className="kg-map-layers-section">
                <span className="kg-map-layers-section-title">Organization</span>
                <select className="input" value={clusterMode} onChange={(e) => setClusterMode(e.target.value === 'domain' ? 'domain' : 'related')}>
                  <option value="domain">Domain clusters</option>
                  <option value="related">Lexical related clusters</option>
                </select>
              </div>
              <div className="kg-map-layers-section">
                <span className="kg-map-layers-section-title">Chunks</span>
                <div className="kg-map-layers-actions">
                  <button type="button" className="kg-map-panel-btn" onClick={collapseAllChunks}>
                    Collapse all
                  </button>
                  <button type="button" className="kg-map-panel-btn" onClick={expandAllChunks}>
                    Expand all
                  </button>
                </div>
              </div>
              <div className="kg-map-layers-section">
                <span className="kg-map-layers-section-title">Layout physics</span>
                <label className="kg-map-range">
                  <span className="kg-map-range-head">
                    Semantic gravity
                    <output className="kg-map-range-value">{semanticGravity.toFixed(2)}</output>
                  </span>
                  <input type="range" min={0.2} max={1.7} step={0.02} value={semanticGravity} onChange={(e) => setSemanticGravity(Number(e.target.value))} />
                </label>
                <label className="kg-map-range">
                  <span className="kg-map-range-head">
                    Min surface gap
                    <output className="kg-map-range-value">{Math.round(minSurfaceGap)} px</output>
                  </span>
                  <input type="range" min={8} max={34} step={1} value={minSurfaceGap} onChange={(e) => setMinSurfaceGap(Number(e.target.value))} />
                </label>
              </div>
              <div className="kg-map-layers-section">
                <span className="kg-map-layers-section-title">Pins</span>
                <button type="button" className="kg-map-panel-btn" onClick={clearPinnedNodes} disabled={!Object.keys(pinnedNodePositions).length}>
                  Clear pinned nodes ({Object.keys(pinnedNodePositions).length})
                </button>
              </div>
              <div className="kg-map-layers-section kg-map-layers-section--actions">
                {onRunGraphAnalysis ? (
                  <>
                    <button
                      type="button"
                      className="kg-map-panel-btn kg-map-panel-btn--primary"
                      disabled={graphInitialLoad || analysisBusy}
                      onClick={() => onRunGraphAnalysis({ ingestReport: false })}
                    >
                      {analysisBusy ? '...' : 'Analyze graph'}
                    </button>
                    <button
                      type="button"
                      className="kg-map-panel-btn"
                      disabled={graphInitialLoad || analysisBusy}
                      onClick={() => onRunGraphAnalysis({ ingestReport: true })}
                    >
                      {analysisBusy ? '...' : 'Save report to library'}
                    </button>
                  </>
                ) : null}
                <button type="button" className="kg-map-panel-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? '...' : 'Refresh graph'}
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      <details className="kg-legend-fold">
        <summary className="kg-legend-summary">Legend</summary>
        <ul className="kg-legend" aria-label="Legend">
          <li>
            <span className="kg-legend-swatch kg-node--source" /> Source
          </li>
          <li>
            <span className="kg-legend-swatch kg-node--chunk" /> Chunk
          </li>
          <li>
            <span className="kg-legend-swatch kg-node--overflow" /> +N more chunks (sampled)
          </li>
          <li>
            <span className="kg-legend-swatch kg-node--wiki" /> Wiki page
          </li>
          <li className="kg-legend-drag-hint muted">Drag pins nodes in place. Alt+click a node to unpin or clear pins from Layers.</li>
          <li className="kg-legend-edges">
            <span className="kg-legend-line kg-edge--contains" /> contains
          </li>
          <li className="kg-legend-edges">
            <span className="kg-legend-line kg-edge--indexes" /> indexes
          </li>
          <li className="kg-legend-edges">
            <span className="kg-legend-line kg-edge--compiled_from" /> compiled from source
          </li>
          <li className="kg-legend-edges">
            <span className="kg-legend-line kg-edge--related" /> lexical/entity relation
          </li>
          <li className="kg-legend-edges">
            <span className="kg-legend-line kg-edge--suggested" /> suggested (analysis)
          </li>
          {hoverOrFocusId ? (
            <li className="kg-legend-drag-hint muted">Focused node highlights intentful links and suppresses lower-salience clutter.</li>
          ) : null}
        </ul>
      </details>
      {analysisPanel}
    </div>
  )
}
