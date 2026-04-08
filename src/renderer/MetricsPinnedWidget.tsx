import type { MetricsSnapshot } from '@shared/types'

const SPARK_W = 220
const SPARK_H = 36

function rssSparkPath(points: MetricsSnapshot[]): string | null {
  const pairs: number[] = []
  for (const p of points) {
    const v = p.processRssMb
    if (typeof v === 'number' && !Number.isNaN(v)) pairs.push(v)
  }
  if (pairs.length < 2) return null
  const min = Math.min(...pairs)
  const max = Math.max(...pairs)
  const pad = Math.max((max - min) * 0.08, 1)
  const y0 = min - pad
  const y1 = max + pad
  const span = Math.max(y1 - y0, 1e-6)
  const innerW = SPARK_W - 4
  const innerH = SPARK_H - 4
  return pairs
    .map((v, idx) => {
      const x = 2 + (idx / (pairs.length - 1)) * innerW
      const y = 2 + (1 - (v - y0) / span) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' L ')
}

export function MetricsPinnedWidget(props: {
  snapshot: MetricsSnapshot | null
  series: MetricsSnapshot[]
  refreshMs: number
  runtimeOn: boolean
  onUnpin: () => void
  onOpenStats: () => void
}): React.ReactElement {
  const { snapshot, series, refreshMs, runtimeOn, onUnpin, onOpenStats } = props
  const pathD = rssSparkPath(series)
  const secs = refreshMs / 1000

  return (
    <aside className="metrics-pinned-widget" aria-label="Live metrics">
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
      {pathD && (
        <svg className="metrics-pinned-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden>
          <path
            d={`M ${pathD}`}
            fill="none"
            stroke="url(#metricsSparkGrad)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <defs>
            <linearGradient id="metricsSparkGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#5a8dee" />
              <stop offset="100%" stopColor="#7c6cf0" />
            </linearGradient>
          </defs>
        </svg>
      )}
      <div className="metrics-pinned-grid">
        <div className="metrics-pinned-stat">
          <span className="metrics-pinned-label">RSS</span>
          <span className="metrics-pinned-value">{snapshot?.processRssMb != null ? `${snapshot.processRssMb.toFixed(0)} MB` : '—'}</span>
        </div>
        <div className="metrics-pinned-stat">
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
        <div className="metrics-pinned-stat">
          <span className="metrics-pinned-label">Runtime</span>
          <span className={`metrics-pinned-value ${runtimeOn ? 'on' : ''}`}>{runtimeOn ? 'On' : 'Off'}</span>
        </div>
      </div>
    </aside>
  )
}
