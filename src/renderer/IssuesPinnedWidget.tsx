import type { ReactElement } from 'react'
import type { AppBlockingIssue } from '@shared/appBlockingIssues'

export function IssuesPinnedWidget(props: {
  issues: AppBlockingIssue[]
  onUnpin: () => void
  onOpenRun: () => void
}): ReactElement {
  const { issues, onUnpin, onOpenRun } = props
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <aside className="issues-pinned-widget" aria-label="Blocking issues and warnings">
      <div className="issues-pinned-widget-header">
        <span className="issues-pinned-widget-title">Issues</span>
        {issues.length > 0 ? (
          <span className="issues-pinned-widget-count" aria-live="polite">
            {errors.length > 0 ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : null}
            {errors.length > 0 && warnings.length > 0 ? ' · ' : null}
            {warnings.length > 0 ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : null}
          </span>
        ) : (
          <span className="issues-pinned-widget-count issues-pinned-widget-count--ok">All clear</span>
        )}
        <div className="issues-pinned-widget-actions">
          <button type="button" className="issues-pinned-widget-link" onClick={onOpenRun}>
            Open Run
          </button>
          <button type="button" className="issues-pinned-widget-unpin" onClick={onUnpin} title="Unpin widget">
            Unpin
          </button>
        </div>
      </div>
      {issues.length === 0 ? (
        <p className="issues-pinned-widget-empty muted">No warnings or errors are blocking the app right now.</p>
      ) : (
        <ul className="issues-pinned-list" role="list">
          {issues.map((it) => (
            <li
              key={it.id}
              className={`issues-pinned-item issues-pinned-item--${it.severity}`}
              role="listitem"
            >
              <span className="issues-pinned-item-badge" aria-hidden>
                <i
                  className={`fa-solid ${it.severity === 'error' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}`}
                />
              </span>
              <span className="issues-pinned-item-message">{it.message}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
