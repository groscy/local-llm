import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { KnowledgeGraphNode, KnowledgeGraphPayload } from '@shared/types'

type Pos = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }

function layoutGraph(
  data: KnowledgeGraphPayload,
  width: number
): { positions: Map<string, Pos>; boxes: Map<string, Box>; height: number } {
  const pad = 28
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

  const positions = new Map<string, Pos>()
  const boxes = new Map<string, Box>()

  let yTop = pad
  const wikiRowH = 48
  const sourceR = 22
  const chunkH = 22
  const chunkGap = 5

  if (wikis.length > 0) {
    const inner = Math.max(width - pad * 2, 120)
    const step = inner / (wikis.length + 1)
    for (let i = 0; i < wikis.length; i++) {
      const w = wikis[i]
      const x = pad + step * (i + 1)
      const y = yTop + wikiRowH / 2
      positions.set(w.id, { x, y })
      boxes.set(w.id, { x: x - 56, y: y - 17, w: 112, h: 34 })
    }
    yTop += wikiRowH + 28
  } else {
    yTop += 4
  }

  const nCol = Math.max(sources.length, 1)
  const colGap = 12
  const innerW = Math.max(width - pad * 2, 200)
  const colW = (innerW - colGap * (nCol - 1)) / nCol
  const ySource = yTop + sourceR + 6

  let deepest = ySource

  sources.forEach((s, i) => {
    const x = pad + colW * i + colGap * i + colW / 2
    positions.set(s.id, { x, y: ySource })
    boxes.set(s.id, { x: x - 62, y: ySource - sourceR, w: 124, h: sourceR * 2 })

    const chunks = chunksBySource.get(s.id) ?? []
    let y = ySource + sourceR + 18
    for (const ch of chunks) {
      y += chunkH / 2
      positions.set(ch.id, { x, y })
      boxes.set(ch.id, { x: x - 42, y: y - chunkH / 2, w: 84, h: chunkH })
      y += chunkH / 2 + chunkGap
    }
    deepest = Math.max(deepest, y)
  })

  const height = Math.max(280, deepest + 72)
  return { positions, boxes, height }
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
}): ReactNode {
  const { data, loading, onRefresh, onPickSource } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hoverId, setHoverId] = useState<string | null>(null)

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

  if (loading && !data) {
    return (
      <div className="kg-panel">
        <div className="kg-toolbar">
          <span className="kg-toolbar-title">Knowledge graph</span>
          <button type="button" className="btn-secondary btn-sm" onClick={onRefresh} disabled>
            Refresh
          </button>
        </div>
        <p className="muted kg-empty">Loading graph…</p>
      </div>
    )
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="kg-panel">
        <div className="kg-toolbar">
          <span className="kg-toolbar-title">Knowledge graph</span>
          <button type="button" className="btn-secondary btn-sm" onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <p className="muted kg-empty">
          No sources yet. Use <strong>+ Add document</strong> in the library to ingest text; then open this view again.
        </p>
      </div>
    )
  }

  if (!layout) return null

  const { positions, boxes, height } = layout

  return (
    <div className="kg-panel">
      <div className="kg-toolbar">
        <span className="kg-toolbar-title">Knowledge graph</span>
        <div className="kg-toolbar-meta">
          {data.truncated && <span className="kg-truncation-note">Sampled for display</span>}
          <button type="button" className="btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="kg-svg-wrap">
        <svg
          className="kg-graph-svg"
          width={w}
          height={height}
          viewBox={`0 0 ${w} ${height}`}
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
              const label = truncate(n.label, n.kind === 'chunk' ? 14 : 22)
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
                  className={`kg-node kg-node--chunk${hi ? ' kg-node--hi' : ''}`}
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

      <ul className="kg-legend" aria-label="Legend">
        <li>
          <span className="kg-legend-swatch kg-node--source" /> Source
        </li>
        <li>
          <span className="kg-legend-swatch kg-node--chunk" /> Chunk
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
    </div>
  )
}
