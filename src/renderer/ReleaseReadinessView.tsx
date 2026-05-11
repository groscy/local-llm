import { useMemo, type ReactElement } from 'react'

type ReleaseFeatureSnapshot = {
  runtimeRunning: boolean
  modelConfigured: boolean
  bridgeEnabled: boolean
  integrationTokenConfigured: boolean
  pluginReportCount: number
  wikiTopicCount: number
  knowledgeGraphNodeCount: number
  ontologyEntityCount: number
  codebaseAnalysisCount: number
  trainJobCount: number
  metricsSampleCount: number
  downloadsCompleteCount: number
  updatesSupported: boolean
}

type FeatureDef = {
  id: string
  name: string
  area: string
  description: string
  progress: (s: ReleaseFeatureSnapshot) => number
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

function weightedProgress(parts: Array<[ok: boolean, weight: number]>): number {
  const total = parts.reduce((sum, [, w]) => sum + w, 0)
  if (total <= 0) return 0
  const got = parts.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0)
  return clampPct((100 * got) / total)
}

function maturityLabel(progress: number): string {
  if (progress >= 90) return 'Release candidate'
  if (progress >= 75) return 'Beta'
  if (progress >= 55) return 'Preview'
  if (progress >= 35) return 'Alpha'
  return 'Prototype'
}

function maturityClass(progress: number): string {
  if (progress >= 90) return 'release-maturity release-maturity--rc'
  if (progress >= 75) return 'release-maturity release-maturity--beta'
  if (progress >= 55) return 'release-maturity release-maturity--preview'
  if (progress >= 35) return 'release-maturity release-maturity--alpha'
  return 'release-maturity release-maturity--proto'
}

const FEATURE_DEFS: FeatureDef[] = [
  {
    id: 'runtime_orchestration',
    name: 'Runtime orchestration',
    area: 'Core',
    description: 'Local model startup, runtime controls, and stable execution path.',
    progress: (s) =>
      weightedProgress([
        [s.modelConfigured, 35],
        [s.runtimeRunning, 40],
        [s.downloadsCompleteCount > 0, 25]
      ])
  },
  {
    id: 'knowledge_capture',
    name: 'Knowledge capture',
    area: 'Knowledge',
    description: 'Wiki ingestion, reusable notes, and searchable internal context.',
    progress: (s) =>
      weightedProgress([
        [s.wikiTopicCount >= 10, 50],
        [s.wikiTopicCount >= 1, 20],
        [s.downloadsCompleteCount > 0, 30]
      ])
  },
  {
    id: 'graph_and_ontology',
    name: 'Graph + ontology',
    area: 'Knowledge',
    description: 'Relationship graph and ontology evidence pipelines.',
    progress: (s) =>
      weightedProgress([
        [s.knowledgeGraphNodeCount >= 25, 40],
        [s.ontologyEntityCount >= 20, 40],
        [s.metricsSampleCount >= 5, 20]
      ])
  },
  {
    id: 'architecture_and_validation',
    name: 'Architecture + validation',
    area: 'Engineering',
    description: 'Architecture repository and implementation validation surfaces.',
    progress: (s) =>
      weightedProgress([
        [s.codebaseAnalysisCount >= 1, 45],
        [s.codebaseAnalysisCount >= 3, 20],
        [s.knowledgeGraphNodeCount >= 20, 35]
      ])
  },
  {
    id: 'training_pipeline',
    name: 'Training pipeline',
    area: 'ML',
    description: 'Fine-tuning workflow and train job lifecycle.',
    progress: (s) =>
      weightedProgress([
        [s.trainJobCount >= 1, 45],
        [s.trainJobCount >= 3, 20],
        [s.runtimeRunning, 35]
      ])
  },
  {
    id: 'ide_bridge',
    name: 'IDE bridge',
    area: 'Integrations',
    description: 'Editor integration transport, token auth, and plugin traffic.',
    progress: (s) =>
      weightedProgress([
        [s.bridgeEnabled, 40],
        [s.integrationTokenConfigured, 30],
        [s.pluginReportCount >= 1, 30]
      ])
  },
  {
    id: 'observability',
    name: 'Metrics + observability',
    area: 'Operations',
    description: 'Runtime/system telemetry visibility and trend history.',
    progress: (s) =>
      weightedProgress([
        [s.metricsSampleCount >= 30, 50],
        [s.metricsSampleCount >= 5, 20],
        [s.runtimeRunning, 30]
      ])
  },
  {
    id: 'release_distribution',
    name: 'Release distribution',
    area: 'Operations',
    description: 'Packaging/update readiness and release control switches.',
    progress: (s) =>
      weightedProgress([
        [s.updatesSupported, 55],
        [s.downloadsCompleteCount > 0, 20],
        [s.metricsSampleCount >= 5, 25]
      ])
  }
]

export function defaultReleaseFeatureSet(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const f of FEATURE_DEFS) out[f.id] = true
  return out
}

export function normalizeReleaseFeatureSet(input: unknown): Record<string, boolean> {
  const defaults = defaultReleaseFeatureSet()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>
  for (const id of Object.keys(defaults)) {
    if (typeof raw[id] === 'boolean') defaults[id] = raw[id] as boolean
  }
  return defaults
}

export function ReleaseReadinessView(props: {
  snapshot: ReleaseFeatureSnapshot
  featureSet: Record<string, boolean>
  onFeatureSetChange: (next: Record<string, boolean>) => void
}): ReactElement {
  const rows = useMemo(
    () =>
      FEATURE_DEFS.map((f) => {
        const progress = clampPct(f.progress(props.snapshot))
        return {
          ...f,
          progress,
          maturity: maturityLabel(progress),
          selected: props.featureSet[f.id] !== false
        }
      }),
    [props.snapshot, props.featureSet]
  )

  const selectedRows = rows.filter((r) => r.selected)
  const overallProgress =
    selectedRows.length > 0
      ? clampPct(selectedRows.reduce((sum, r) => sum + r.progress, 0) / selectedRows.length)
      : 0

  const patchFeature = (featureId: string, enabled: boolean): void => {
    props.onFeatureSetChange({ ...props.featureSet, [featureId]: enabled })
  }

  const setByThreshold = (minProgress: number): void => {
    const next = { ...props.featureSet }
    for (const row of rows) next[row.id] = row.progress >= minProgress
    props.onFeatureSetChange(next)
  }

  return (
    <div className="release-readiness-shell">
      <section className="release-readiness-summary card">
        <h2>Next release plan</h2>
        <p className="muted">
          Final narrator step: confirm the feature set for the next release. Progress reflects current workspace signals and
          maturity estimates.
        </p>
        <div className="release-readiness-summary-row">
          <span className="release-readiness-summary-label">Selected features</span>
          <strong>
            {selectedRows.length} / {rows.length}
          </strong>
        </div>
        <div className="release-readiness-summary-row">
          <span className="release-readiness-summary-label">Average readiness</span>
          <strong>{overallProgress}%</strong>
        </div>
        <div className="release-readiness-summary-actions">
          <button type="button" className="btn-secondary" onClick={() => setByThreshold(0)}>
            Include all
          </button>
          <button type="button" className="btn-secondary" onClick={() => setByThreshold(75)}>
            Include beta+ (presentation default)
          </button>
          <button type="button" className="btn-secondary" onClick={() => setByThreshold(101)}>
            Clear all
          </button>
        </div>
      </section>

      <section className="release-readiness-grid" aria-label="Feature readiness list">
        {rows.map((row) => (
          <article key={row.id} className={`release-feature-card${row.selected ? ' release-feature-card--selected' : ''}`}>
            <div className="release-feature-head">
              <div>
                <p className="release-feature-area">{row.area}</p>
                <h3>{row.name}</h3>
              </div>
              <span className={maturityClass(row.progress)}>{row.maturity}</span>
            </div>
            <p className="muted release-feature-desc">{row.description}</p>
            <div className="release-feature-progress">
              <div className="release-feature-progress-track" aria-hidden>
                <span className="release-feature-progress-fill" style={{ width: `${row.progress}%` }} />
              </div>
              <span className="release-feature-progress-label">Progress {row.progress}%</span>
            </div>
            <label className="release-feature-toggle">
              <input
                type="checkbox"
                checked={row.selected}
                onChange={(e) => patchFeature(row.id, e.target.checked)}
              />
              <span>Include in next release build</span>
            </label>
          </article>
        ))}
      </section>
    </div>
  )
}
