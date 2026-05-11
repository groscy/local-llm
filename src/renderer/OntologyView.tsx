import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { KnowledgeGraphPayload, OntologyEntityDetails, OntologyQueryRequest, OntologyStats, OntologySubgraphPayload } from '@shared/types'
import { KnowledgeGraphView } from './KnowledgeGraphView'

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

  const graphData = useMemo<KnowledgeGraphPayload | null>(() => {
    if (!data) return null
    const nodes = data.nodes.map((node) => ({
      id: node.iri,
      kind: 'source' as const,
      label: node.label,
      shortLabel: node.label,
      sublabel: node.type,
      domainId: node.type,
      confidence: node.confidence
    }))
    const edges = data.edges
      .filter((edge) => Boolean(edge.objectIri))
      .map((edge) => ({
        from: edge.subjectIri,
        to: edge.objectIri as string,
        kind: 'semantic_related' as const,
        confidence: edge.confidence
      }))
    return { nodes, edges, truncated: data.truncated }
  }, [data])

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
          <KnowledgeGraphView
            hideToolbarTitle
            data={graphData}
            loading={loading}
            onRefresh={onRefresh}
            onInspectNode={({ node, anchorClient }) => {
              const rect = graphCardRef.current?.getBoundingClientRect()
              if (rect) {
                setSelectionAnchor({
                  x: Math.max(12, Math.min(rect.width - 24, anchorClient.x - rect.left)),
                  y: Math.max(12, Math.min(rect.height - 24, anchorClient.y - rect.top))
                })
              }
              onSelectEntity(node.id)
            }}
          />
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
