import type { ReactElement } from 'react'
import type { DownloadRow } from '@shared/types'
import { DownloadProgressBar, downloadRowProgressPct, fileNameFromPath, formatBytes } from './downloadProgressUi'

const POLL_LABEL_SEC = 1

export function DownloadsPinnedWidget(props: {
  downloads: DownloadRow[]
  onUnpin: () => void
  onOpenRun: () => void
  onCancelJob: (jobId: string) => void
}): ReactElement {
  const { downloads, onUnpin, onOpenRun, onCancelJob } = props
  const active = downloads.filter((r) => r.status === 'downloading' || r.status === 'pending')

  return (
    <aside className="downloads-pinned-widget" aria-label="Download progress">
      <div className="downloads-pinned-widget-header">
        <span className="downloads-pinned-widget-title">Downloads</span>
        <span className="downloads-pinned-widget-interval">~{POLL_LABEL_SEC}s refresh</span>
        <div className="downloads-pinned-widget-actions">
          <button type="button" className="downloads-pinned-widget-link" onClick={onOpenRun}>
            Open Run
          </button>
          <button type="button" className="downloads-pinned-widget-unpin" onClick={onUnpin} title="Unpin widget">
            Unpin
          </button>
        </div>
      </div>
      {active.length === 0 ? (
        <p className="downloads-pinned-widget-empty">No active downloads. Start one from the Hub.</p>
      ) : (
        <ul className="downloads-pinned-list">
          {active.map((r) => {
            const dlPct = downloadRowProgressPct(r)
            const dlMeta =
              dlPct != null
                ? `${dlPct}%${
                    typeof r.bytes_received === 'number' && Number(r.bytes_total) > 0
                      ? ` · ${formatBytes(r.bytes_received)} / ${formatBytes(Number(r.bytes_total))}`
                      : ''
                  }`
                : 'Starting…'
            const fileLabel = fileNameFromPath(r.local_path)
            const primary = r.chat_display_name?.trim() || fileLabel
            return (
              <li key={r.id} className="downloads-pinned-item">
                <div className="downloads-pinned-item-head">
                  <span className="downloads-pinned-item-name" title={`${primary}\n${r.local_path}`}>
                    {primary}
                  </span>
                  <button type="button" className="btn-ghost-sm" onClick={() => void onCancelJob(r.id)}>
                    Cancel
                  </button>
                </div>
                <div className="downloads-pinned-item-repo muted">{r.repo_id}</div>
                <DownloadProgressBar compact pct={dlPct} meta={dlMeta} />
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
