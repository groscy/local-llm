import type { ReactElement } from 'react'
import type { MetricsSnapshot } from '@shared/types'
import { MetricsTimeSeries } from './MetricsTimeSeries'

export function MetricsPinnedWidget(props: {
  snapshot: MetricsSnapshot | null
  series: MetricsSnapshot[]
  refreshMs: number
  runtimeOn: boolean
  onUnpin: () => void
  onOpenStats: () => void
}): ReactElement {
  const { snapshot, series, refreshMs, runtimeOn, onUnpin, onOpenStats } = props
  const secs = refreshMs / 1000

  return (
    <aside className="metrics-pinned-widget" aria-label="Live metrics">
      <div className="metrics-pinned-widget-surface">
        <div className="metrics-pinned-widget-header">
          <span className="metrics-pinned-widget-title">Live metrics</span>
          <span className="metrics-pinned-widget-interval">every {secs < 1 ? `${refreshMs}ms` : `${secs}s`}</span>
          <div className="metrics-pinned-widget-actions">
            <button type="button" className="metrics-pinned-widget-link" onClick={onOpenStats}>
              Full stats
            </button>
            <button type="button" className="metrics-pinned-widget-unpin" onClick={onUnpin} title="Unpin widget">
              Unpin
            </button>
          </div>
        </div>
        <div className="metrics-pinned-charts">
          <MetricsTimeSeries history={series} variant="pinned" />
        </div>
        <div className="metrics-pinned-stat-grid-wrap">
          <div className="metrics-pinned-grid">
            <div className="metrics-pinned-stat">
              <span className="metrics-pinned-label">Resident memory</span>
              <span className="metrics-pinned-value">
                {snapshot?.processRssMb != null ? `${snapshot.processRssMb.toFixed(0)} MB` : '—'}
              </span>
            </div>
            <div className="metrics-pinned-stat metrics-pinned-stat--min-hide">
              <span className="metrics-pinned-label">CPU</span>
              <span className="metrics-pinned-value">
                {snapshot?.processCpuPercent != null ? `${snapshot.processCpuPercent.toFixed(0)}%` : '—'}
              </span>
            </div>
            <div className="metrics-pinned-stat">
              <span className="metrics-pinned-label">Tok/s</span>
              <span className="metrics-pinned-value">
                {snapshot?.runtimeTokensPerSec != null ? snapshot.runtimeTokensPerSec.toFixed(1) : '—'}
              </span>
            </div>
            <div className="metrics-pinned-stat metrics-pinned-stat--min-hide">
              <span className="metrics-pinned-label">Avg prompt→reply</span>
              <span className="metrics-pinned-value">
                {snapshot?.avgPromptToResponseMs != null && Number.isFinite(snapshot.avgPromptToResponseMs)
                  ? `${(snapshot.avgPromptToResponseMs / 1000).toFixed(snapshot.avgPromptToResponseMs >= 10_000 ? 0 : 1)} s`
                  : '—'}
              </span>
            </div>
            <div className="metrics-pinned-stat metrics-pinned-stat--min-hide">
              <span className="metrics-pinned-label">GPU</span>
              <span className="metrics-pinned-value">
                {snapshot?.gpuMemUsedMb != null && snapshot?.gpuMemTotalMb != null
                  ? `${snapshot.gpuMemUsedMb.toFixed(0)} / ${snapshot.gpuMemTotalMb.toFixed(0)}`
                  : '—'}
              </span>
            </div>
            <div className="metrics-pinned-stat metrics-pinned-stat--min-hide">
              <span className="metrics-pinned-label">Model</span>
              <span className="metrics-pinned-value">
                {snapshot?.modelMemoryMb != null ? `${snapshot.modelMemoryMb.toFixed(0)} MB` : '—'}
              </span>
            </div>
            <div className="metrics-pinned-stat">
              <span className="metrics-pinned-label">Runtime</span>
              <span className={`metrics-pinned-value ${runtimeOn ? 'on' : ''}`}>{runtimeOn ? 'On' : 'Off'}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
