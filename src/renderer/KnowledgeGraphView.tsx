import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { KnowledgeGraphNode, KnowledgeGraphPayload } from '@shared/types'

type Pos = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

function layoutGraph(
  data: KnowledgeGraphPayload,
  containerWidth: number
): { positions: Map<string, Pos>; boxes: Map<string, Box>; width: number; height: number } {
  const pad = 28
  const wikiBoxW = 136
  const wikiBoxH = 36
  const wikiGapX = 14
  const wikiRowGap = 22
  const sourceR = 22
  const sourceBoxW = 128
  const sourceBoxH = sourceR * 2
  const chunkW = 88
  const chunkH = 24
  const chunkGapY = 8
  const chunkGapX = 10
  const colGap = 14

  const sources = data.nodes.filter((n) => n.kind === 'source')
  const wikis = data.nodes.filter((n) => n.kind === 'wiki')
  const chunksBySource = new Map<string, KnowledgeGraphNode[]>()
  for (const n of data.nodes) {
    if (n.kind === 'chunk' && n.sourceId) {
      const arr = chunksBySource.get(n.sourceId) ?? []
      arr.push(n)
      chunksBySource.set(n.sourceId, arr)
    }
  }

  const chunkColsFor = (n: number): number => {
    if (n <= 8) return 1
    if (n <= 20) return 2
    return 3
  }

  const nCol = Math.max(sources.length, 1)
  const minSourceTrack =
    nCol > 24 ? 104 : nCol > 16 ? 118 : nCol > 10 ? 132 : 148

  const positions = new Map<string, Pos>()
  const boxes = new Map<string, Box>()

  const innerFromContainer = Math.max(containerWidth - pad * 2, 200)
  const minInnerForSources = nCol * minSourceTrack + (nCol - 1) * colGap
  const innerW = Math.max(innerFromContainer, minInnerForSources)
  const layoutWidth = innerW + pad * 2

  let yTop = pad

  if (wikis.length > 0) {
    const wikiSlot = wikiBoxW + wikiGapX
    const wikisPerRow = Math.max(1, Math.floor((innerW + wikiGapX) / wikiSlot))
    for (let rowStart = 0; rowStart < wikis.length; rowStart += wikisPerRow) {
      const row = wikis.slice(rowStart, rowStart + wikisPerRow)
      const n = row.length
      const rowContentW = n * wikiBoxW + (n - 1) * wikiGapX
      const x0 = pad + Math.max(0, (innerW - rowContentW) / 2)
      for (let i = 0; i < n; i++) {
        const w = row[i]!
        const cx = x0 + wikiBoxW / 2 + i * (wikiBoxW + wikiGapX)
        const cy = yTop + wikiBoxH / 2
        positions.set(w.id, { x: cx, y: cy })
        boxes.set(w.id, {
          x: cx - wikiBoxW / 2,
          y: cy - wikiBoxH / 2,
          w: wikiBoxW,
          h: wikiBoxH
        })
      }
      yTop += wikiBoxH + wikiRowGap
    }
    yTop += 8
  } else {
    yTop += 6
  }

  const colW = (innerW - colGap * (nCol - 1)) / nCol
  const ySource = yTop + sourceR + 8

  let deepest = ySource + sourceR

  sources.forEach((s, i) => {
    const x = pad + colW * i + colGap * i + colW / 2
    positions.set(s.id, { x, y: ySource })
    boxes.set(s.id, {
      x: x - sourceBoxW / 2,
      y: ySource - sourceR,
      w: sourceBoxW,
      h: sourceBoxH
    })

    const chunks = chunksBySource.get(s.id) ?? []
    const cols = chunkColsFor(chunks.length)
    const colStride = chunkW + chunkGapX
    const blockHalf = ((cols - 1) * colStride) / 2
    const rows = Math.ceil(chunks.length / cols)
    let y = ySource + sourceR + 18
    for (let idx = 0; idx < chunks.length; idx++) {
      const ch = chunks[idx]!
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const xc = x - blockHalf + col * colStride
      const yc = y + row * (chunkH + chunkGapY)
      positions.set(ch.id, { x: xc, y: yc })
      boxes.set(ch.id, {
        x: xc - chunkW / 2,
        y: yc - chunkH / 2,
        w: chunkW,
        h: chunkH
      })
      deepest = Math.max(deepest, yc + chunkH / 2)
    }
  })

  const height = Math.max(340, deepest + pad + 48)
  return { positions, boxes, width: layoutWidth, height }
}

function edgePath(
  from: Pos,
  to: Pos,
  kind: string,
  b1: Box,
  b2: Box
): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const start = {
    x: from.x + ux * (Math.min(b1.w, b1.h) / 2 + 4),
    y: from.y + uy * (Math.min(b1.w, b1.h) / 2 + 4)
  }
  const end = {
    x: to.x - ux * (Math.min(b2.w, b2.h) / 2 + 4),
    y: to.y - uy * (Math.min(b2.w, b2.h) / 2 + 4)
  }
  if (kind === 'related' && Math.abs(dy) < 8) {
    const lift = 36
    const midX = (start.x + end.x) / 2
    return `M ${start.x} ${start.y} Q ${midX} ${start.y - lift} ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export function KnowledgeGraphView(props: {
  data: KnowledgeGraphPayload | null
  loading: boolean
  onRefresh: () => void
  onPickSource?: (sourceId: string) => void
  /** When true, omit the toolbar title (parent supplies a section heading). */
  hideToolbarTitle?: boolean
  /** Optional graph analysis job (cluster / hubs / refinements); wired from main process. */
  graphAnalysis?: {
    busy: boolean
    error: string | null
    summary: string | null
    markdown: string | null
    ingestedId: string | null
  }
  onRunGraphAnalysis?: (opts: { ingestReport: boolean }) => void
}): ReactNode {
  const { data, loading, onRefresh, onPickSource, hideToolbarTitle, graphAnalysis, onRunGraphAnalysis } =
    props
  const tbClass = `kg-toolbar${hideToolbarTitle ? ' kg-toolbar--embedded' : ''}`
  const analysisBusy = graphAnalysis?.busy ?? false
  const graphInitialLoad = loading && data == null
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr && cr.width > 40) setW(Math.floor(cr.width))
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    if (rect.width > 40) setW(Math.floor(rect.width))
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    if (!data || data.nodes.length === 0) return null
    return layoutGraph(data, w)
  }, [data, w])

  const graphCounts = useMemo(() => {
    if (!data) return null
    const sources = data.nodes.filter((n) => n.kind === 'source').length
    const chunks = data.nodes.filter((n) => n.kind === 'chunk').length
    const wikis = data.nodes.filter((n) => n.kind === 'wiki').length
    const edges = data.edges.length
    return { sources, chunks, wikis, edges }
  }, [data])

  useLayoutEffect(() => {
    setZoom(1)
  }, [data])

  const edgeHighlight = useCallback(
    (from: string, to: string): boolean => {
      if (!hoverId) return false
      return from === hoverId || to === hoverId
    },
    [hoverId]
  )

  const onNodeClick = useCallback(
    (node: KnowledgeGraphNode) => {
      if (node.kind === 'source') onPickSource?.(node.id)
      else if (node.kind === 'chunk' && node.sourceId) onPickSource?.(node.sourceId)
      else if (node.kind === 'wiki' && node.id.startsWith('src:')) onPickSource?.(node.id.slice(4))
    },
    [onPickSource]
  )

  const fitZoom = useCallback(() => {
    const el = wrapRef.current
    if (!el || !layout) return
    const pad = 20
    const zw = Math.max(120, el.clientWidth - pad)
    const zh = Math.max(120, el.clientHeight - pad)
    const sx = zw / layout.width
    const sy = zh / layout.height
    setZoom(Math.min(2.4, Math.max(0.1, Math.min(sx, sy))))
  }, [layout])

  const analysisPanel =
    graphAnalysis &&
    (graphAnalysis.error ||
      graphAnalysis.summary ||
      graphAnalysis.markdown ||
      graphAnalysis.ingestedId) ? (
      <div className="kg-analysis" aria-live="polite">
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
      </div>
    ) : null

  if (loading && !data) {
    return (
      <div className="kg-panel">
        <div className={tbClass}>
          {!hideToolbarTitle ? <span className="kg-toolbar-title">Knowledge graph</span> : null}
          <div className="kg-toolbar-meta">
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
        <div className={tbClass}>
          {!hideToolbarTitle ? <span className="kg-toolbar-title">Knowledge graph</span> : null}
          <div className="kg-toolbar-meta">
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

  if (!layout) return null

  const { positions, boxes, width: layoutWidth, height } = layout
  const scaledW = layoutWidth * zoom
  const scaledH = height * zoom

  return (
    <div className="kg-panel">
      <div className={tbClass}>
        {!hideToolbarTitle ? <span className="kg-toolbar-title">Knowledge graph</span> : null}
        <div className="kg-toolbar-meta">
          {graphCounts ? (
            <span className="kg-toolbar-counts" title="Nodes shown in this view (large libraries may be sampled)">
              {graphCounts.sources} sources · {graphCounts.chunks} chunk nodes · {graphCounts.wikis} wiki ·{' '}
              {graphCounts.edges} edges
            </span>
          ) : null}
          {data.truncated && (
            <span className="kg-truncation-note" title="Some chunks, wiki pages, or cross-links are omitted to keep the graph fast">
              Sampled
            </span>
          )}
          <span className="kg-zoom-cluster" aria-label="Zoom">
            <button type="button" className="btn-secondary btn-sm" onClick={() => fitZoom()} title="Fit graph to panel">
              Fit
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setZoom((z) => Math.max(0.1, Math.round((z / 1.12) * 1000) / 1000))}
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setZoom((z) => Math.min(2.5, Math.round(z * 1.12 * 1000) / 1000))}
              title="Zoom in"
            >
              +
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom(1)} title="Reset zoom (100%)">
              100%
            </button>
            <span className="kg-zoom-hint muted">Ctrl+wheel</span>
          </span>
          {onRunGraphAnalysis ? (
            <>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={loading || analysisBusy}
                onClick={() => onRunGraphAnalysis({ ingestReport: false })}
              >
                {analysisBusy ? '…' : 'Analyze graph'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={loading || analysisBusy}
                onClick={() => onRunGraphAnalysis({ ingestReport: true })}
              >
                {analysisBusy ? '…' : 'Save report to library'}
              </button>
            </>
          ) : null}
          <button type="button" className="btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="kg-svg-wrap"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          setZoom((z) => {
            const next = e.deltaY < 0 ? z * 1.08 : z / 1.08
            return Math.min(2.5, Math.max(0.1, Math.round(next * 1000) / 1000))
          })
        }}
      >
        <div
          className="kg-svg-scale-box"
          style={{ width: scaledW, height: scaledH }}
        >
          <svg
            className="kg-graph-svg"
            width={layoutWidth}
            height={height}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            viewBox={`0 0 ${layoutWidth} ${height}`}
            role="img"
            aria-label="Knowledge base structure: sources, indexed chunks, and wiki pages"
          >
          <g className="kg-edges">
            {data.edges.map((e, i) => {
              const p1 = positions.get(e.from)
              const p2 = positions.get(e.to)
              const b1 = boxes.get(e.from)
              const b2 = boxes.get(e.to)
              if (!p1 || !p2 || !b1 || !b2) return null
              const hi = edgeHighlight(e.from, e.to)
              return (
                <path
                  key={`${e.from}-${e.to}-${e.kind}-${i}`}
                  d={edgePath(p1, p2, e.kind, b1, b2)}
                  className={`kg-edge kg-edge--${e.kind}${hi ? ' kg-edge--hi' : ''}`}
                  fill="none"
                />
              )
            })}
          </g>

          <g className="kg-nodes">
            {data.nodes.map((n) => {
              const p = positions.get(n.id)
              const b = boxes.get(n.id)
              if (!p || !b) return null
              const hi = hoverId === n.id
              const isOverflow = n.kind === 'chunk' && n.id.startsWith('kg-overflow:')
              const label = truncate(n.label, n.kind === 'chunk' ? (isOverflow ? 12 : 16) : 26)
              if (n.kind === 'wiki') {
                return (
                  <g
                    key={n.id}
                    className={`kg-node kg-node--wiki${hi ? ' kg-node--hi' : ''}`}
                    style={{ cursor: onPickSource ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => onNodeClick(n)}
                  >
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx={10}
                      className="kg-shape"
                    />
                    <text x={p.x} y={p.y + 4} textAnchor="middle" className="kg-label">
                      {label}
                    </text>
                    <title>{n.label}</title>
                  </g>
                )
              }
              if (n.kind === 'source') {
                return (
                  <g
                    key={n.id}
                    className={`kg-node kg-node--source${hi ? ' kg-node--hi' : ''}`}
                    style={{ cursor: onPickSource ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => onNodeClick(n)}
                  >
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      rx={12}
                      className="kg-shape"
                    />
                    <text x={p.x} y={p.y + 5} textAnchor="middle" className="kg-label">
                      {label}
                    </text>
                    <title>{n.label}</title>
                  </g>
                )
              }
              return (
                <g
                  key={n.id}
                  className={`kg-node kg-node--chunk${isOverflow ? ' kg-node--overflow' : ''}${hi ? ' kg-node--hi' : ''}`}
                  style={{ cursor: onPickSource ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={() => onNodeClick(n)}
                >
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className="kg-shape" />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" className="kg-label kg-label--sm">
                    {label}
                  </text>
                  <title>{n.sublabel ? `${n.label} — ${n.sublabel}` : n.label}</title>
                </g>
              )
            })}
          </g>
        </svg>
        </div>
      </div>

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
      </ul>

      {analysisPanel}
    </div>
  )
}
