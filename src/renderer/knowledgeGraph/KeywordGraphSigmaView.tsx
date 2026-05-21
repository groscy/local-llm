import Graph from 'graphology'
import Sigma from 'sigma'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { KeywordGraphPayload } from '@shared/types'

function round2(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '0.00'
}

function stablePoint(index: number, total: number): { x: number; y: number } {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const t = index + 1
  const r = Math.sqrt(t / Math.max(1, total))
  const a = t * golden
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}

function toSigmaGraph(payload: KeywordGraphPayload): Graph {
  const graph = new Graph({ multi: true, type: 'directed' })
  const indexById = new Map(payload.nodes.map((n, i) => [n.id, i] as const))
  const total = Math.max(1, payload.nodes.length)
  for (const node of payload.nodes) {
    const i = indexById.get(node.id) ?? 0
    const point = stablePoint(i, total)
    graph.addNode(node.id, {
      label: node.canonicalLabel,
      x: point.x,
      y: point.y,
      size: 4 + node.salience * 6,
      color: node.type === 'scope' ? '#ffb454' : '#8b9dff',
      type: 'circle'
    })
  }
  for (const edge of payload.edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) continue
    if (edge.from === edge.to) continue
    graph.addEdgeWithKey(edge.id, edge.from, edge.to, {
      label: edge.predicate,
      size: 1 + edge.confidence * 1.8,
      color: edge.confidence >= 0.72 ? '#8ec5ff' : '#64748b'
    })
  }
  return graph
}

function mergePayload(prev: KeywordGraphPayload | null, next: KeywordGraphPayload): KeywordGraphPayload {
  if (!prev) return next
  const nodeById = new Map(prev.nodes.map((n) => [n.id, n] as const))
  for (const node of next.nodes) nodeById.set(node.id, node)
  const edgeById = new Map(prev.edges.map((e) => [e.id, e] as const))
  for (const edge of next.edges) edgeById.set(edge.id, edge)
  return {
    nodes: [...nodeById.values()],
    edges: [...edgeById.values()],
    truncated: prev.truncated || next.truncated,
    nextCursor: next.nextCursor,
    projectionMeta: next.projectionMeta ?? prev.projectionMeta
  }
}

export function KeywordGraphSigmaView(props?: {
  onMetricsChange?: (metrics: { nodes: number; edges: number; truncated: boolean }) => void
}): ReactNode {
  const mountRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const [payload, setPayload] = useState<KeywordGraphPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [minConfidence, setMinConfidence] = useState(0.45)
  const [relationTypes, setRelationTypes] = useState<string[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchHits, setSearchHits] = useState<Array<{ id: string; canonicalLabel: string; score: number }>>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const availableRelationTypes = useMemo(() => {
    const s = new Set<string>()
    for (const edge of payload?.edges ?? []) s.add(edge.predicate)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [payload])

  useEffect(() => {
    props?.onMetricsChange?.({
      nodes: payload?.nodes.length ?? 0,
      edges: payload?.edges.length ?? 0,
      truncated: payload?.truncated === true
    })
  }, [payload, props])

  const loadGraph = useCallback(
    async (opts?: { focusNodeId?: string; append?: boolean; cursor?: string | null }) => {
      const append = opts?.append === true
      if (append) setLoadingMore(true)
      else setLoading(true)
      if (!append) setError(null)
      try {
        const data = opts?.focusNodeId
          ? await window.api.kbKeywordGraphNeighbors({
              nodeId: opts.focusNodeId,
              hops: 2,
              limitNodes: 180,
              limitEdges: 500
            })
          : await window.api.kbKeywordGraph({
              query: query.trim() || undefined,
              relationTypes: relationTypes.length ? relationTypes : undefined,
              minConfidence,
              limitNodes: 220,
              limitEdges: 900,
              cursor: opts?.cursor ?? undefined
            })
        if (append) setPayload((prev) => mergePayload(prev, data))
        else setPayload(data)
        setNextCursor(data.nextCursor ?? null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    },
    [query, relationTypes, minConfidence]
  )

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(() => {
      const q = query.trim()
      if (!q) {
        setSearchHits([])
        return
      }
      void window.api.kbKeywordGraphSearch(q, 8).then((hits) => {
        if (cancelled) return
        setSearchHits(hits.map((h) => ({ id: h.id, canonicalLabel: h.canonicalLabel, score: h.score })))
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    const container = mountRef.current
    if (!container || !payload) return
    const graph = toSigmaGraph(payload)
    sigmaRef.current?.kill()
    const sigma = new Sigma(graph, container, {
      renderEdgeLabels: false,
      allowInvalidContainer: true,
      labelDensity: 0.1,
      labelRenderedSizeThreshold: 10,
      labelGridCellSize: 120
    })
    sigma.on('clickNode', ({ node }) => {
      setSelectedNodeId(node)
      void loadGraph({ focusNodeId: String(node) })
    })
    sigmaRef.current = sigma
    return () => {
      sigma.kill()
      sigmaRef.current = null
    }
  }, [payload, loadGraph])

  return (
    <div className="kg-sigma-shell">
      <div className="kg-sigma-toolbar">
        <div className="kg-sigma-toolbar-row">
          <input
            className="input"
            value={query}
            placeholder="Search keyword..."
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={() => void loadGraph()} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!nextCursor || loadingMore || loading}
            onClick={() => void loadGraph({ append: true, cursor: nextCursor })}
          >
            {loadingMore ? 'Loading more...' : 'Load more'}
          </button>
        </div>
        {searchHits.length > 0 ? (
          <div className="kg-sigma-search-hits">
            {searchHits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="kg-sigma-search-hit"
                onClick={() => {
                  setSelectedNodeId(hit.id)
                  void loadGraph({ focusNodeId: hit.id })
                }}
              >
                <span>{hit.canonicalLabel}</span>
                <small>{round2(hit.score)}</small>
              </button>
            ))}
          </div>
        ) : null}
        <label className="kg-sigma-range">
          <span>
            Min confidence <strong>{round2(minConfidence)}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            onPointerUp={() => void loadGraph()}
          />
        </label>
        {availableRelationTypes.length > 0 ? (
          <div className="kg-sigma-relations">
            {availableRelationTypes.slice(0, 12).map((rel) => {
              const checked = relationTypes.includes(rel)
              return (
                <label key={rel} className="kg-sigma-relation-pill">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setRelationTypes((prev) => {
                        if (prev.includes(rel)) return prev.filter((x) => x !== rel)
                        return [...prev, rel]
                      })
                    }}
                    onBlur={() => void loadGraph()}
                  />
                  <span>{rel}</span>
                </label>
              )
            })}
          </div>
        ) : null}
        <div className="kg-sigma-meta muted">
          <span>Nodes: {payload?.nodes.length ?? 0}</span>
          <span>Edges: {payload?.edges.length ?? 0}</span>
          <span>{nextCursor ? 'More pages available' : 'End of result set'}</span>
          {selectedNodeId ? <span>Focus: {selectedNodeId.slice(0, 10)}</span> : null}
        </div>
        {error ? <p className="kg-sigma-error">{error}</p> : null}
      </div>
      <div className="kg-sigma-canvas" ref={mountRef} />
    </div>
  )
}
