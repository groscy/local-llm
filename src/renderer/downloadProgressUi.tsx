import type { ReactElement } from 'react'
import type { DownloadRow } from '@shared/types'

export function fileNameFromPath(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function formatBytes(n: number): string {
  if (!n || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function downloadRowProgressPct(r: DownloadRow): number | null {
  if (r.status !== 'downloading' && r.status !== 'pending') return null
  if (typeof r.progress_percent === 'number' && Number.isFinite(r.progress_percent)) {
    return Math.min(100, Math.max(0, r.progress_percent))
  }
  const bt = Number(r.bytes_total) || 0
  const br = typeof r.bytes_received === 'number' ? r.bytes_received : NaN
  if (bt > 0 && Number.isFinite(br) && br >= 0) {
    return Math.min(100, Math.round((100 * br) / bt))
  }
  return null
}

export function DownloadProgressBar(props: {
  pct: number | null
  meta?: string
  compact?: boolean
}): ReactElement {
  const indeterminate = props.pct === null
  return (
    <div className={`download-progress-block${props.compact ? ' download-progress-block--compact' : ''}`}>
      <div className="download-progress-track">
        {indeterminate ? (
          <div className="download-progress-fill download-progress-fill--indeterminate" />
        ) : (
          <div
            className="download-progress-fill"
            style={{ width: `${props.pct}%` }}
            role="progressbar"
            aria-valuenow={props.pct ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        )}
      </div>
      {props.meta ? <div className="download-progress-meta">{props.meta}</div> : null}
    </div>
  )
}
