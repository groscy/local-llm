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
import type { KnowledgeGraphAnalysisResult } from '@shared/knowledgeGraphAnalysis'
import type { KnowledgeGraphEdgeKind, KnowledgeGraphNode, KnowledgeGraphPayload } from '@shared/types'
import { buildKnowledgeGraphLayout, kgEdgePath, nodeRadius } from './knowledgeGraph/buildKnowledgeGraphLayout'
import { clampDragOffsetForNode, mergeNodeDragIntoLayout } from './knowledgeGraph/mergeNodeDragOffsets'
import {
  applySemanticGravity,
  KG_GRAVITY_STORAGE_KEY,
  KG_MIN_GAP_STORAGE_KEY,
  readStoredGravity,
  readStoredMinSurfaceGap
} from './knowledgeGraph/semanticGravityLayout'
import { useKnowledgeGraphViewport } from './knowledgeGraph/useKnowledgeGraphViewport'

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
  return `${s.slice(0, max - 1)}…`
}

function clusterStrokeForSource(
  analysis: KnowledgeGraphAnalysisResult | null | undefined,
  sourceId: string
): string | undefined {
  if (!analysis?.clusters?.length) return undefined
  for (let i = 0; i < analysis.clusters.length; i++) {
    const c = analysis.clusters[i]!
    if (c.sourceIds.includes(sourceId)) return CLUSTER_STROKE[i % CLUSTER_STROKE.length]
  }
  return undefined
}

function hubSourceSet(analysis: KnowledgeGraphAnalysisResult | null | undefined): Set<string> {
  const s = new Set<string>()
  if (!analysis?.hubs) return s
  for (const h of analysis.hubs) s.add(h.sourceId)
  return s
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
  hideToolbarTitle?: boolean
  graphAnalysis?: KnowledgeGraphAnalysisPanelProps
  onRunGraphAnalysis?: (opts: { ingestReport: boolean }) => void
}): ReactNode {
  const { data, loading, onRefresh, onPickSource, hideToolbarTitle, graphAnalysis, onRunGraphAnalysis } = props
  const analysisBusy = graphAnalysis?.busy ?? false
  const graphInitialLoad = loading && data == null
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [layoutW, setLayoutW] = useState(640)
  const [wrapSize, setWrapSize] = useState({ w: 640, h: 420 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [collapsedSourceIds, setCollapsedSourceIds] = useState<Set<string>>(() => new Set())
  const [edgeShow, setEdgeShow] = useState<Record<KnowledgeGraphEdgeKind, boolean>>({
    contains: true,
    indexes: true,
    compiled_from: true,
    related: false
  })
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(true)
  const [minimapOpen, setMinimapOpen] = useState(true)
  const [minimalTextMode, setMinimalTextMode] = useState(true)
  const [clusterMode, setClusterMode] = useState<'related' | 'domain'>('related')
  const [kbdFocusId, setKbdFocusId] = useState<string | null>(null)
  const [semanticGravity, setSemanticGravity] = useState(() => readStoredGravity())
  const [minSurfaceGap, setMinSurfaceGap] = useState(() => readStoredMinSurfaceGap())
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
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr && cr.width > 40) {
        setLayoutW(Math.floor(cr.width))
        setWrapSize({ w: Math.floor(cr.width), h: Math.max(120, Math.floor(cr.height)) })
      }
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    if (rect.width > 40) {
      setLayoutW(Math.floor(rect.width))
      setWrapSize({ w: Math.floor(rect.width), h: Math.max(120, Math.floor(rect.height)) })
    }
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null
    const seed = buildKnowledgeGraphLayout(data, {
      containerWidth: layoutW,
      collapsedSourceIds,
      clusterMode
    })
    return applySemanticGravity(data, seed, {
      gravity: semanticGravity,
      minSurfaceGap: minSurfaceGap
    })
  }, [data, layoutW, collapsedSourceIds, semanticGravity, minSurfaceGap, clusterMode])

  const resetKey = data ? `${data.nodes.length}-${data.edges.length}-${[...collapsedSourceIds].sort().join(',')}` : '0'

  const [nodeDragOffsets, setNodeDragOffsets] = useState<Record<string, { dx: number; dy: number }>>({})

  useEffect(() => {
    setNodeDragOffsets({})
  }, [resetKey])

  const displayLayout = useMemo(() => {
    if (!layout || !data) return null
    return mergeNodeDragIntoLayout(layout, data, nodeDragOffsets)
  }, [layout, data, nodeDragOffsets])

  const vpApi = useKnowledgeGraphViewport(wrapRef, {
    contentW: displayLayout?.width ?? layout?.width ?? 1,
    contentH: displayLayout?.height ?? layout?.height ?? 1,
    resetKey
  })

  const vpApiRef = useRef(vpApi)
  vpApiRef.current = vpApi

  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const nodeDragOffsetsRef = useRef(nodeDragOffsets)
  nodeDragOffsetsRef.current = nodeDragOffsets

  const nodeDragActiveRef = useRef<{
    id: string
    startClient: { x: number; y: number }
    startOff: { dx: number; dy: number }
    moved: boolean
  } | null>(null)
  const suppressNodeClickRef = useRef(false)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)

  const onWrapPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = nodeDragActiveRef.current
    const lay = layoutRef.current
    if (d && data && lay) {
      const scale = vpApiRef.current.viewport.scale
      const rawDx = d.startOff.dx + (e.clientX - d.startClient.x) / scale
      const rawDy = d.startOff.dy + (e.clientY - d.startClient.y) / scale
      const node = data.nodes.find((x) => x.id === d.id)
      const p0 = lay.positions.get(d.id)
      if (node && p0) {
        const next = clampDragOffsetForNode(p0, rawDx, rawDy, node, lay)
        if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) > 5) d.moved = true
        setNodeDragOffsets((prev) => ({ ...prev, [d.id]: next }))
      }
    }
    vpApiRef.current.onPointerMove(e)
  }, [data])

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
    }
    vpApiRef.current.onPointerUp(e)
  }, [])

  const beginNodeDrag = useCallback((e: ReactPointerEvent<SVGGElement>, n: KnowledgeGraphNode) => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('.kg-source-collapse-hit')) return
    if (n.kind === 'source' && e.shiftKey) return
    e.stopPropagation()
    e.preventDefault()
    const w = wrapRef.current
    const lay = layoutRef.current
    if (!w || !lay) return
    try {
      w.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const off = nodeDragOffsetsRef.current[n.id] ?? { dx: 0, dy: 0 }
    nodeDragActiveRef.current = {
      id: n.id,
      startClient: { x: e.clientX, y: e.clientY },
      startOff: { ...off },
      moved: false
    }
    setDraggingNodeId(n.id)
  }, [])

  const graphCounts = useMemo(() => {
    if (!data) return null
    const sources = data.nodes.filter((n) => n.kind === 'source').length
    const chunks = data.nodes.filter((n) => n.kind === 'chunk').length
    const wikis = data.nodes.filter((n) => n.kind === 'wiki').length
    const edges = data.edges.length
    return { sources, chunks, wikis, edges }
  }, [data])

  const hubIds = useMemo(() => hubSourceSet(graphAnalysis?.result), [graphAnalysis?.result])

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

  const collapseAllChunks = useCallback(() => {
    if (!data) return
    const all = data.nodes.filter((n) => n.kind === 'source').map((n) => n.id)
    setCollapsedSourceIds(new Set(all))
  }, [data])

  const expandAllChunks = useCallback(() => {
    setCollapsedSourceIds(new Set())
  }, [])

  const edgeHighlight = useCallback(
    (from: string, to: string): boolean => {
      if (!hoverId && !kbdFocusId) return false
      const h = hoverId ?? kbdFocusId
      return from === h || to === h
    },
    [hoverId, kbdFocusId]
  )

  const relatedEdgeVisible = useCallback(
    (from: string, to: string): boolean => {
      if (edgeShow.related) return true
      const h = hoverId ?? kbdFocusId
      if (!h) return false
      return from === h || to === h
    },
    [edgeShow.related, hoverId, kbdFocusId]
  )

  const onNodeClick = useCallback(
    (node: KnowledgeGraphNode, e?: ReactMouseEvent) => {
      if (suppressNodeClickRef.current) {
        suppressNodeClickRef.current = false
        return
      }
      if (node.kind === 'source' && e?.shiftKey) {
        e.preventDefault()
        toggleSourceCollapse(node.id)
        return
      }
      if (node.kind === 'source') onPickSource?.(node.id)
      else if (node.kind === 'chunk' && node.sourceId) onPickSource?.(node.sourceId)
      else if (node.kind === 'wiki' && node.id.startsWith('src:')) onPickSource?.(node.id.slice(4))
    },
    [onPickSource, toggleSourceCollapse]
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
      }
    },
    [kbdOrderIds, activateKbdFocus]
  )

  const analysisPanelInner =
    graphAnalysis &&
    (graphAnalysis.error ||
      graphAnalysis.summary ||
      graphAnalysis.markdown ||
      graphAnalysis.ingestedId) ? (
      <>
        {graphAnalysis.error ? (
          <p className="kg-analysis-error" role="alert">
            {graphAnalysis.error}
          </p>
        ) : null}
        {graphAnalysis.summary ? <p className="kg-analysis-summary">{graphAnalysis.summary}</p> : null}
        {graphAnalysis.ingestedId ? (
          <p className="muted kg-analysis-ingested">Report saved as a new library document.</p>
        ) : null}
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
      const el = e.currentTarget
      const rect = el.getBoundingClientRect()
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
    const { width: cw, height: ch } = displayLayout
    const mw = 120
    const mh = 86
    const mm = Math.min(mw / cw, mh / ch)
    const wv = wrapSize.w
    const hv = wrapSize.h
    const { scale: zs, tx, ty } = vpApi.viewport
    const worldLeft = -tx / zs
    const worldTop = -ty / zs
    const worldW = wv / zs
    const worldH = hv / zs
    const worldWm = cw * mm
    const worldHm = ch * mm
    const vx = Math.max(0, Math.min(worldWm - 4, worldLeft * mm))
    const vy = Math.max(0, Math.min(worldHm - 4, worldTop * mm))
    const vwClamped = Math.min(worldWm - vx, Math.max(4, worldW * mm))
    const vhClamped = Math.min(worldHm - vy, Math.max(4, worldH * mm))
    return (
      <div
        className="kg-minimap"
        data-kg-no-pan=""
        role="presentation"
        onPointerDown={minimapClick}
        title="Click to center view on point"
      >
        <svg width={mw + 2} height={mh + 2} viewBox={`0 0 ${mw + 2} ${mh + 2}`} className="kg-minimap-svg">
          <rect x={0.5} y={0.5} width={worldWm} height={worldHm} className="kg-minimap-world" rx={2} />
          <rect x={0.5 + vx} y={0.5 + vy} width={vwClamped} height={vhClamped} className="kg-minimap-vp" rx={1} />
        </svg>
      </div>
    )
  }

  /** Floating controls inside the graph viewport (map-style). */
  const renderMapOverlays = (): ReactNode => (
    <div className="kg-map-overlay-root">
      {graphCounts || !hideToolbarTitle ? (
        <div
          className="kg-map-interactive kg-map-chip kg-map-chip--info"
          title="Nodes in this view (large libraries may be sampled)"
        >
          {!hideToolbarTitle ? <div className="kg-map-chip-heading">Knowledge graph</div> : null}
          {graphCounts ? (
            <div className="kg-map-chip-body">
              <span className="kg-map-chip-stats">
                {graphCounts.sources} src · {graphCounts.chunks} chk · {graphCounts.wikis} wiki · {graphCounts.edges} e
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
          −
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
        <div
          className="kg-map-layers-panel"
          role="dialog"
          aria-label="Graph layers and tools"
          onWheel={(e) => e.stopPropagation()}
        >
          <p className="kg-map-layers-hint muted">Wheel zoom · drag background to pan · drag nodes to move</p>
          <div className="kg-map-layers-section" role="group" aria-label="Edge types">
            <span className="kg-map-layers-section-title">Edges</span>
            <label className="kg-map-check">
              <input
                type="checkbox"
                checked={edgeShow.contains}
                onChange={() => setEdgeShow((s) => ({ ...s, contains: !s.contains }))}
              />
              contains
            </label>
            <label className="kg-map-check">
              <input
                type="checkbox"
                checked={edgeShow.indexes}
                onChange={() => setEdgeShow((s) => ({ ...s, indexes: !s.indexes }))}
              />
              indexes
            </label>
            <label className="kg-map-check">
              <input
                type="checkbox"
                checked={edgeShow.compiled_from}
                onChange={() => setEdgeShow((s) => ({ ...s, compiled_from: !s.compiled_from }))}
              />
              compiled
            </label>
            <label className="kg-map-check" title="When off, related edges show on hover or keyboard focus">
              <input
                type="checkbox"
                checked={edgeShow.related}
                onChange={() => setEdgeShow((s) => ({ ...s, related: !s.related }))}
              />
              related
            </label>
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
            <span className="kg-map-layers-section-title">Organization</span>
            <select
              className="input"
              value={clusterMode}
              onChange={(e) => setClusterMode(e.target.value === 'domain' ? 'domain' : 'related')}
            >
              <option value="related">Related-title clusters</option>
              <option value="domain">Domain clusters</option>
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
              <input
                type="range"
                min={0}
                max={1.55}
                step={0.03}
                value={semanticGravity}
                onChange={(e) => setSemanticGravity(Number(e.target.value))}
                aria-valuetext={`${semanticGravity.toFixed(2)}`}
              />
            </label>
            <p className="kg-map-layers-hint muted" style={{ marginTop: 4 }}>
              Linked nodes attract more when edges are semantically strong (strongest on contains and
              compiled-from, then indexes, then related). Zero keeps the seeded layout only.
            </p>
            <label className="kg-map-range">
              <span className="kg-map-range-head">
                Min surface gap
                <output className="kg-map-range-value">{Math.round(minSurfaceGap)} px</output>
              </span>
              <input
                type="range"
                min={5}
                max={26}
                step={1}
                value={minSurfaceGap}
                onChange={(e) => setMinSurfaceGap(Number(e.target.value))}
                aria-valuetext={`${Math.round(minSurfaceGap)} pixels between node circles`}
              />
            </label>
            <p className="kg-map-layers-hint muted" style={{ marginTop: 4 }}>
              Enforces a minimum space between node circles so labels stay readable.
            </p>
          </div>
          <div className="kg-map-layers-section">
            <span className="kg-map-layers-section-title">View</span>
            <button type="button" className="kg-map-panel-btn" onClick={() => vpApi.resetZoom()}>
              Reset zoom (100%)
            </button>
          </div>
          <div className="kg-map-layers-section kg-map-layers-section--actions">
            {onRunGraphAnalysis ? (
              <>
                <button
                  type="button"
                  className="kg-map-panel-btn kg-map-panel-btn--primary"
                  disabled={loading || analysisBusy}
                  onClick={() => onRunGraphAnalysis({ ingestReport: false })}
                >
                  {analysisBusy ? '…' : 'Analyze graph'}
                </button>
                <button
                  type="button"
                  className="kg-map-panel-btn"
                  disabled={loading || analysisBusy}
                  onClick={() => onRunGraphAnalysis({ ingestReport: true })}
                >
                  {analysisBusy ? '…' : 'Save report to library'}
                </button>
              </>
            ) : null}
            <button type="button" className="kg-map-panel-btn" onClick={onRefresh} disabled={loading}>
              {loading ? '…' : 'Refresh graph'}
            </button>
          </div>
        </div>
      </details>

      <div className="kg-map-interactive kg-map-bottombar" role="toolbar" aria-label="Refresh graph">
        <button type="button" className="kg-map-fab" onClick={onRefresh} disabled={loading} title="Refresh graph data">
          {loading ? '…' : '↻'}
        </button>
      </div>
    </div>
  )

  if (loading && !data) {
    return (
      <div className="kg-panel">
        <div className="kg-fallback-bar">
          {!hideToolbarTitle ? <span className="kg-toolbar-title">Knowledge graph</span> : null}
          <div className="kg-fallback-bar-actions">
            {onRunGraphAnalysis ? (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={graphInitialLoad || analysisBusy}
                  onClick={() => onRunGraphAnalysis({ ingestReport: false })}
                >
                  {analysisBusy ? '…' : 'Analyze graph'}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={graphInitialLoad || analysisBusy}
                  onClick={() => onRunGraphAnalysis({ ingestReport: true })}
                >
                  {analysisBusy ? '…' : 'Save report to library'}
                </button>
              </>
            ) : null}
            <button type="button" className="btn-secondary btn-sm" onClick={onRefresh} disabled>
              Refresh
            </button>
          </div>
        </div>
        <p className="muted kg-empty">Loading graph…</p>
        {analysisPanel}
      </div>
    )
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="kg-panel">
        <div className="kg-fallback-bar">
          {!hideToolbarTitle ? <span className="kg-toolbar-title">Knowledge graph</span> : null}
          <div className="kg-fallback-bar-actions">
            {onRunGraphAnalysis ? (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={graphInitialLoad || analysisBusy}
                  onClick={() => onRunGraphAnalysis({ ingestReport: false })}
                >
                  {analysisBusy ? '…' : 'Analyze graph'}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={graphInitialLoad || analysisBusy}
                  onClick={() => onRunGraphAnalysis({ ingestReport: true })}
                >
                  {analysisBusy ? '…' : 'Save report to library'}
                </button>
              </>
            ) : null}
            <button type="button" className="btn-secondary btn-sm" onClick={onRefresh}>
              Refresh
            </button>
          </div>
        </div>
        <p className="muted kg-empty">
          No sources yet. Use <strong>+ Add document</strong> in the library to ingest text; then open this view again.
        </p>
        {analysisPanel}
      </div>
    )
  }

  if (!displayLayout) return null

  const { positions, boxes, width: layoutWidth, height } = displayLayout
  const { tx, ty, scale: zs } = vpApi.viewport
  const hideChunkLabels = zs < 0.44
  const hideWikiLabels = zs < 0.34
  const matrix = `translate(${tx},${ty}) scale(${zs})`

  return (
    <div className="kg-panel">
      <div
        ref={wrapRef}
        className={['kg-svg-wrap kg-svg-wrap--viewport', draggingNodeId ? 'kg-svg-wrap--node-drag' : '']
          .filter(Boolean)
          .join(' ')}
        onWheel={vpApi.onWheel}
        onPointerDown={vpApi.onPointerDown}
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
          aria-label="Knowledge graph canvas. Drag nodes to reposition. Use arrow keys to move focus, Enter to open topic."
        >
          <svg
            className="kg-graph-svg kg-graph-svg--fill kg-graph-svg--obsidian"
            width="100%"
            height="100%"
            role="img"
            aria-activedescendant={kbdFocusId ? `kg-node-${kbdFocusId}` : undefined}
            aria-label="Knowledge base structure: sources, indexed chunks, and wiki pages"
          >
            <defs>
              <pattern id={`kgObsDots-${obsPatternId}`} patternUnits="userSpaceOnUse" width={20} height={20}>
                <circle cx={1.2} cy={1.2} r={0.85} className="kg-obs-dot" />
              </pattern>
            </defs>
            <g transform={matrix}>
              <g className="kg-world-planes">
                <rect x={0} y={0} width={layoutWidth} height={height} fill={`url(#kgObsDots-${obsPatternId})`} className="kg-obs-dots-layer" />
                <rect x={0} y={0} width={layoutWidth} height={height} className="kg-world-bg" />
              </g>
              <g className="kg-edges">
                {data.edges.map((e, i) => {
                  const showEdge =
                    e.kind === 'related'
                      ? edgeShow.related || relatedEdgeVisible(e.from, e.to)
                      : edgeShow[e.kind]
                  if (!showEdge) return null
                  const p1 = positions.get(e.from)
                  const p2 = positions.get(e.to)
                  const b1 = boxes.get(e.from)
                  const b2 = boxes.get(e.to)
                  if (!p1 || !p2 || !b1 || !b2) return null
                  const hi = edgeHighlight(e.from, e.to)
                  return (
                    <path
                      key={`${e.from}-${e.to}-${e.kind}-${i}`}
                      d={kgEdgePath(p1, p2, e.kind, b1, b2)}
                      className={`kg-edge kg-edge--${e.kind}${hi ? ' kg-edge--hi' : ''}`}
                      fill="none"
                    />
                  )
                })}
                {showSuggestions && graphAnalysis?.result?.suggestedLinks
                  ? graphAnalysis.result.suggestedLinks.map((s, i) => {
                      const p1 = positions.get(s.fromSourceId)
                      const p2 = positions.get(s.toSourceId)
                      const b1 = boxes.get(s.fromSourceId)
                      const b2 = boxes.get(s.toSourceId)
                      if (!p1 || !p2 || !b1 || !b2) return null
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
                {data.nodes.map((n) => {
                  const p = positions.get(n.id)
                  const b = boxes.get(n.id)
                  if (!p || !b) return null
                  const r = nodeRadius(n)
                  const hi = hoverId === n.id || kbdFocusId === n.id
                  const isOverflow = n.kind === 'chunk' && n.id.startsWith('kg-overflow:')
                  const clusterStroke = n.kind === 'source' ? clusterStrokeForSource(graphAnalysis?.result, n.id) : undefined
                  const isHub = n.kind === 'source' && hubIds.has(n.id)
                  const showLabel =
                    n.kind === 'chunk'
                      ? !hideChunkLabels
                      : n.kind === 'wiki'
                        ? !hideWikiLabels
                        : true
                  const compactLabel = n.shortLabel?.trim() || n.label
                  const label = showLabel
                    ? truncate(
                        minimalTextMode ? compactLabel : n.label,
                        n.kind === 'chunk' ? (isOverflow ? 12 : 14) : 22
                      )
                    : n.kind === 'chunk'
                      ? ''
                      : truncate(minimalTextMode ? compactLabel : n.label, 6)
                  const hasConfidenceRing = typeof n.confidence === 'number'
                  const confidencePct = Math.min(1, Math.max(0, n.confidence ?? 0))
                  const confidenceStroke = Math.max(1.2, Math.round(confidencePct * 3))
                  const isNovel = typeof n.novelty === 'number' && n.novelty > 0.66

                  if (n.kind === 'wiki') {
                    return (
                      <g
                        key={n.id}
                        id={`kg-node-${n.id}`}
                        className={`kg-node kg-node--wiki kg-node--draggable${hi ? ' kg-node--hi' : ''}${kbdFocusId === n.id ? ' kg-node--kbd' : ''}${draggingNodeId === n.id ? ' kg-node--dragging' : ''}`}
                        style={{ cursor: onPickSource ? 'grab' : 'grab' }}
                        onPointerDown={(e) => beginNodeDrag(e, n)}
                        onMouseEnter={() => setHoverId(n.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={() => onNodeClick(n)}
                        tabIndex={-1}
                        aria-label={n.label}
                      >
                        <circle cx={p.x} cy={p.y} r={r} className="kg-shape kg-node-dot" />
                        {hasConfidenceRing ? (
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={r + 2.2}
                            className="kg-confidence-ring"
                            strokeWidth={confidenceStroke}
                          />
                        ) : null}
                        {isNovel ? <circle cx={p.x + r + 2} cy={p.y - r - 2} r={2.2} className="kg-novelty-dot" /> : null}
                        {n.provenance === 'intellij-plugin' ? (
                          <text x={p.x + r + 5} y={p.y + 3} className="kg-provenance-badge">
                            I
                          </text>
                        ) : null}
                        {showLabel ? (
                          <text x={p.x} y={p.y + r + 12} textAnchor="middle" className="kg-label kg-label-below">
                            {label}
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
                        className={`kg-node kg-node--source kg-node--draggable${hi ? ' kg-node--hi' : ''}${isHub ? ' kg-node--hub' : ''}${kbdFocusId === n.id ? ' kg-node--kbd' : ''}${draggingNodeId === n.id ? ' kg-node--dragging' : ''}`}
                        style={{ cursor: onPickSource ? 'grab' : 'grab' }}
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
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={r + 2.6}
                            className="kg-confidence-ring"
                            strokeWidth={confidenceStroke}
                          />
                        ) : null}
                        {isNovel ? <circle cx={p.x + r + 2} cy={p.y - r - 2} r={2.2} className="kg-novelty-dot" /> : null}
                        {n.provenance === 'intellij-plugin' ? (
                          <text x={p.x + r + 6} y={p.y + 4} className="kg-provenance-badge">
                            I
                          </text>
                        ) : null}
                        <text x={p.x} y={p.y + r + 13} textAnchor="middle" className="kg-label kg-label-below kg-label-below--source">
                          {truncate(n.label, 24)}
                        </text>
                        <g
                          data-kg-no-pan=""
                          className="kg-source-collapse-hit"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSourceCollapse(n.id)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              toggleSourceCollapse(n.id)
                            }
                          }}
                          tabIndex={0}
                          aria-label={collapsed ? 'Expand chunks' : 'Collapse chunks'}
                        >
                          <rect
                            x={p.x + r - 15}
                            y={p.y - r - 2}
                            width={14}
                            height={14}
                            rx={3}
                            className="kg-source-collapse-rect"
                          />
                          <text
                            x={p.x + r - 8}
                            y={p.y - r + 8}
                            textAnchor="middle"
                            className="kg-collapse-glyph"
                          >
                            {collapsed ? '+' : '−'}
                          </text>
                        </g>
                        <title>{`${n.label} — Shift+click or use the corner control to show or hide chunks.`}</title>
                      </g>
                    )
                  }
                  return (
                    <g
                      key={n.id}
                      id={`kg-node-${n.id}`}
                      className={`kg-node kg-node--chunk kg-node--draggable${isOverflow ? ' kg-node--overflow' : ''}${hi ? ' kg-node--hi' : ''}${kbdFocusId === n.id ? ' kg-node--kbd' : ''}${draggingNodeId === n.id ? ' kg-node--dragging' : ''}`}
                      style={{ cursor: onPickSource ? 'grab' : 'grab' }}
                      onPointerDown={(e) => beginNodeDrag(e, n)}
                      onMouseEnter={() => setHoverId(n.id)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => onNodeClick(n)}
                      tabIndex={-1}
                      aria-label={n.sublabel ? `${n.label} — ${n.sublabel}` : n.label}
                    >
                      <circle cx={p.x} cy={p.y} r={r} className="kg-shape kg-node-dot" />
                      {hasConfidenceRing ? (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={r + 2.1}
                          className="kg-confidence-ring"
                          strokeWidth={confidenceStroke}
                        />
                      ) : null}
                      {isNovel ? <circle cx={p.x + r + 2} cy={p.y - r - 2} r={1.8} className="kg-novelty-dot" /> : null}
                      {n.provenance === 'intellij-plugin' ? (
                        <text x={p.x + r + 4} y={p.y + 2} className="kg-provenance-badge">
                          I
                        </text>
                      ) : null}
                      {showLabel ? (
                        <text x={p.x} y={p.y + r + 9} textAnchor="middle" className="kg-label kg-label-below kg-label-below--chunk">
                          {label}
                        </text>
                      ) : null}
                      <title>{n.sublabel ? `${n.label} — ${n.sublabel}` : n.label}</title>
                    </g>
                  )
                })}
              </g>
            </g>
          </svg>
          {renderMinimap()}
        </div>
        {renderMapOverlays()}
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
          <li className="kg-legend-drag-hint muted">Drag any node to reposition it. Manual positions reset when the graph reloads (refresh, library change, or chunk collapse).</li>
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
            <span className="kg-legend-line kg-edge--related" /> related title
          </li>
          <li className="kg-legend-edges">
            <span className="kg-legend-line kg-edge--suggested" /> suggested (analysis)
          </li>
        </ul>
      </details>

      {analysisPanel}
    </div>
  )
}
