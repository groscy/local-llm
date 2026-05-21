import Graph from 'graphology'
import Sigma from 'sigma'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { OntologyEntityDetails, OntologyQueryRequest, OntologyStats, OntologySubgraphPayload } from '@shared/types'

type Props = {
  data: OntologySubgraphPayload | null
  stats: OntologyStats | null
  loading: boolean
  detailLoading: boolean
  details: OntologyEntityDetails | null
  onQuery: (request: OntologyQueryRequest) => void
  onSelectEntity: (iri: string) => void
  onRefresh: () => void
  onRebuild: () => void
  onExport: () => void
}

function predicateLabel(iri: string): string {
  const short = iri.replace(/^app:/, '')
  return short || iri
}

export function OntologyView(props: Props): ReactNode {
  const { data, stats, loading, detailLoading, details, onQuery, onSelectEntity, onRefresh, onRebuild, onExport } = props
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [predicateFilter, setPredicateFilter] = useState('')
  const [recentMode, setRecentMode] = useState<'all' | '24h' | '7d'>('all')
  const [selectionAnchor, setSelectionAnchor] = useState<{ x: number; y: number } | null>(null)
  const graphCardRef = useRef<HTMLDivElement>(null)
  const graphMountRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)

  const availableTypes = useMemo(() => {
    if (!data) return [] as string[]
    return [...new Set(data.nodes.map((n) => n.type).filter((v) => v.trim().length > 0))].sort()
  }, [data])
  const availablePredicates = useMemo(() => {
    if (!data) return [] as string[]
    return [...new Set(data.edges.map((e) => e.predicateIri).filter((v) => v.trim().length > 0))].sort()
  }, [data])

  const requestFromControls = (): OntologyQueryRequest => {
    const recentOnlyMs =
      recentMode === '24h'
        ? 24 * 60 * 60 * 1000
        : recentMode === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : undefined
    return {
      query: query.trim() || undefined,
      typeFilters: typeFilter ? [typeFilter] : undefined,
      predicateFilters: predicateFilter ? [predicateFilter] : undefined,
      recentOnlyMs,
      lodTier: 'mid',
      maxEdgeDensity: 0.65,
      limitEntities: 130,
      limitTriples: 320,
      maxHops: 2
    }
  }

  const graphData = useMemo(() => {
    if (!data) return null
    const graph = new Graph({ multi: true, type: 'directed' })
    const total = Math.max(1, data.nodes.length)
    const golden = Math.PI * (3 - Math.sqrt(5))
    data.nodes.forEach((node, i) => {
      const t = i + 1
      const radius = Math.sqrt(t / total)
      const angle = t * golden
      graph.addNode(node.iri, {
        label: node.label,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        size: 3.4 + Math.max(0, Math.min(1, node.confidence)) * 5.2,
        color: '#8b9dff'
      })
    })
    for (const edge of data.edges) {
      if (!edge.objectIri) continue
      if (!graph.hasNode(edge.subjectIri) || !graph.hasNode(edge.objectIri)) continue
      if (edge.subjectIri === edge.objectIri) continue
      graph.addEdgeWithKey(edge.id, edge.subjectIri, edge.objectIri, {
        label: predicateLabel(edge.predicateIri),
        size: 1.2 + Math.max(0, Math.min(1, edge.confidence)) * 1.6,
        color: edge.confidence >= 0.72 ? '#8ec5ff' : '#64748b'
      })
    }
    return graph
  }, [data])

  useEffect(() => {
    const mount = graphMountRef.current
    if (!mount || !graphData) return
    sigmaRef.current?.kill()
    const sigma = new Sigma(graphData, mount, {
      renderEdgeLabels: false,
      allowInvalidContainer: true,
      labelDensity: 0.1,
      labelRenderedSizeThreshold: 10
    })
    sigma.on('clickNode', ({ node }) => {
      const rect = graphCardRef.current?.getBoundingClientRect()
      if (rect) {
        setSelectionAnchor({
          x: Math.max(12, Math.min(rect.width - 24, rect.width * 0.72)),
          y: Math.max(12, Math.min(rect.height - 24, rect.height * 0.22))
        })
      }
      onSelectEntity(String(node))
    })
    sigmaRef.current = sigma
    return () => {
      sigma.kill()
      sigmaRef.current = null
    }
  }, [graphData, onSelectEntity])

  return (
    <div className="ontology-shell">
      <section className="ontology-toolbar card">
        <div className="ontology-toolbar-row">
          <input
            className="input ontology-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search entities, tools, domains..."
          />
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All entity types</option>
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select className="input" value={predicateFilter} onChange={(e) => setPredicateFilter(e.target.value)}>
            <option value="">All predicates</option>
            {availablePredicates.map((predicate) => (
              <option key={predicate} value={predicate}>
                {predicateLabel(predicate)}
              </option>
            ))}
          </select>
          <select className="input" value={recentMode} onChange={(e) => setRecentMode(e.target.value as 'all' | '24h' | '7d')}>
            <option value="all">All time</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => onQuery(requestFromControls())}>
            Apply
          </button>
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="btn-secondary" onClick={onRebuild}>
            Rebuild snapshot
          </button>
          <button type="button" className="btn-secondary" onClick={onExport}>
            Export JSON-LD
          </button>
        </div>
        {stats ? (
          <div className="ontology-stats muted">
            {stats.entityCount} entities - {stats.tripleCount} triples - {stats.recentTripleCount} recent facts
          </div>
        ) : null}
      </section>

      <div className="ontology-main">
        <div ref={graphCardRef} className="ontology-graph card">
          <div className="ontology-sigma-canvas" ref={graphMountRef} />
          {!detailLoading && !details?.entity ? (
            <p className="ontology-overlay-hint muted">Select a graph node to inspect provenance.</p>
          ) : null}
          {detailLoading || details?.entity ? (
            <aside
              className="ontology-details ontology-details--overlay ontology-details--popover card"
              style={
                selectionAnchor
                  ? ({
                      left: selectionAnchor.x,
                      top: selectionAnchor.y
                    } as const)
                  : undefined
              }
            >
              <h3>Entity details</h3>
              {detailLoading ? <p className="muted">Loading entity details...</p> : null}
              {details?.entity ? (
                <>
                  <p>
                    <strong>{details.entity.label}</strong>
                  </p>
                  <p className="muted">
                    {details.entity.type} - confidence {(details.entity.confidence * 100).toFixed(0)}%
                  </p>
                  <p className="muted ontology-iri">{details.entity.iri}</p>
                  <h4>Outgoing facts</h4>
                  <ul className="ontology-fact-list">
                    {details.outgoing.slice(0, 50).map((edge) => (
                      <li key={edge.id}>
                        <span className="ontology-fact-predicate">{predicateLabel(edge.predicateIri)}</span>{' '}
                        <span>{edge.objectIri ?? edge.objectLiteral ?? '(unknown)'}</span>
                        <div className="muted ontology-fact-meta">
                          {edge.sourceType} - {edge.sourceRef}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <h4>Incoming facts</h4>
                  <ul className="ontology-fact-list">
                    {details.incoming.slice(0, 50).map((edge) => (
                      <li key={edge.id}>
                        <span>{edge.subjectIri}</span>{' '}
                        <span className="ontology-fact-predicate">{predicateLabel(edge.predicateIri)}</span>
                        <div className="muted ontology-fact-meta">
                          {edge.sourceType} - {edge.sourceRef}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
