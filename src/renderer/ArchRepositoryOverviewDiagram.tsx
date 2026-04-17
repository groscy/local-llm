import type { ReactElement } from 'react'
import type { TogafRepositoryArtifactId } from './togafRepositoryArtifacts'

type PartitionTile = {
  targetId: TogafRepositoryArtifactId
  title: string
  subtitle: string
}

/** Core partitions per TOGAF Architecture Repository structure. */
const REPOSITORY_PARTITIONS: PartitionTile[] = [
  {
    targetId: 'repo_architecture_metamodel',
    title: 'Architecture Metamodel',
    subtitle: 'Types of architectural things'
  },
  {
    targetId: 'repo_architecture_capability',
    title: 'Architecture Capability',
    subtitle: 'How architecture is performed'
  },
  {
    targetId: 'repo_architecture_landscape',
    title: 'Architecture Landscape',
    subtitle: 'Building block inventory'
  },
  {
    targetId: 'standards_information_base',
    title: 'Standards Information Base',
    subtitle: 'Norms & policies'
  },
  {
    targetId: 'reference_library',
    title: 'Reference Library',
    subtitle: 'Patterns & reference models'
  },
  {
    targetId: 'architecture_governance_log',
    title: 'Governance Repository',
    subtitle: 'Decisions & compliance'
  }
]

const RELATED_ENTRIES: { targetId: TogafRepositoryArtifactId; label: string; hint: string }[] = [
  { targetId: 'enterprise_continuum', label: 'Enterprise Continuum', hint: 'Foundation → Organization' },
  { targetId: 'acf_deliverables_artifacts', label: 'ACF — Deliverables & artifacts', hint: 'Content Framework' },
  { targetId: 'architecture_requirements_catalog', label: 'Requirements Management', hint: 'Across ADM' },
  { targetId: 'architecture_repository_diagrams', label: 'ADM & repository views', hint: 'Diagrams' },
  { targetId: 'adm_preliminary_phase', label: 'Preliminary Phase', hint: 'ADM entry' }
]

export function ArchRepositoryOverviewDiagram(props: {
  onNavigate: (target: TogafRepositoryArtifactId) => void
}): ReactElement {
  return (
    <section className="arch-repo-overview" aria-labelledby="arch-repo-overview-heading">
      <h3 id="arch-repo-overview-heading" className="settings-section-title">
        <i className="fa-solid fa-diagram-project" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
        Architecture Repository — standard partitions
      </h3>
      <p className="arch-repo-overview-lead muted">
        Each tile opens the matching chapter in the sidebar. Structure follows the TOGAF description of the Architecture
        Repository.
      </p>

      <div className="arch-repo-overview-hub" aria-hidden="true">
        <span className="arch-repo-overview-hub-label">Architecture Repository</span>
      </div>

      <div className="arch-repo-overview-grid">
        {REPOSITORY_PARTITIONS.map((p) => (
          <button
            key={p.targetId}
            type="button"
            className="arch-repo-overview-tile"
            onClick={() => props.onNavigate(p.targetId)}
          >
            <span className="arch-repo-overview-tile-title">{p.title}</span>
            <span className="arch-repo-overview-tile-sub muted">{p.subtitle}</span>
            <span className="arch-repo-overview-tile-cta">
              Open <i className="fa-solid fa-arrow-right" aria-hidden />
            </span>
          </button>
        ))}
      </div>

      <h4 className="arch-repo-overview-related-title">Related TOGAF domains</h4>
      <p className="muted arch-repo-overview-related-lead">
        Entry points outside the six core partitions but linked to the same repository view.
      </p>
      <div className="arch-repo-overview-related">
        {RELATED_ENTRIES.map((r) => (
          <button
            key={r.targetId}
            type="button"
            className="arch-repo-overview-chip"
            title={r.hint}
            onClick={() => props.onNavigate(r.targetId)}
          >
            <span className="arch-repo-overview-chip-label">{r.label}</span>
            <span className="arch-repo-overview-chip-hint muted">{r.hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
