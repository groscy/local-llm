import type { ReactElement } from 'react'

type PinnedWidgetsSide = 'left' | 'right' | 'top' | 'bottom'
type PinnedWidgetKind = 'metrics' | 'downloads' | 'activity' | 'issues'

function IconDockLeft(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="4" height="12" rx="1.2" />
      <rect x="7" y="2" width="7" height="12" rx="1.2" className="dock-icon-muted" />
    </svg>
  )
}
function IconDockRight(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="10" y="2" width="4" height="12" rx="1.2" />
      <rect x="2" y="2" width="7" height="12" rx="1.2" className="dock-icon-muted" />
    </svg>
  )
}
function IconDockTop(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="4" rx="1.2" />
      <rect x="2" y="7" width="12" height="7" rx="1.2" className="dock-icon-muted" />
    </svg>
  )
}
function IconDockBottom(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="10" width="12" height="4" rx="1.2" />
      <rect x="2" y="2" width="12" height="7" rx="1.2" className="dock-icon-muted" />
    </svg>
  )
}

export function PinnedWidgetsRailHeader(props: {
  collapsed: boolean
  expandChevronClass: string
  collapseChevronClass: string
  pinnedWidgetsSide: PinnedWidgetsSide
  metricsPinned: boolean
  downloadsPinned: boolean
  activityPinned: boolean
  issuesPinned: boolean
  onToggleCollapsed: (collapsed: boolean) => void
  onTogglePin: (kind: PinnedWidgetKind, next: boolean) => void
  onSetSide: (side: PinnedWidgetsSide) => void
}): ReactElement {
  if (props.collapsed) {
    return (
      <div className="pinned-widgets-aside-collapsed">
        <button
          type="button"
          className="pinned-widgets-aside-expand-btn"
          title="Expand pinned widgets"
          aria-label="Expand pinned widgets"
          onClick={() => props.onToggleCollapsed(false)}
        >
          <i className={`fa-solid ${props.expandChevronClass} pinned-widgets-aside-expand-chevron`} aria-hidden />
          <span className="visually-hidden">Expand pinned widgets</span>
        </button>
      </div>
    )
  }

  return (
    <div className="pinned-widgets-aside-header">
      <div className="pinned-widgets-aside-header-row pinned-widgets-aside-header-row--title">
        <span className="pinned-widgets-aside-title">Pinned widgets</span>
        <button
          type="button"
          className="pinned-widgets-bar-collapse-btn"
          title="Collapse widget bar"
          aria-label="Collapse widget bar"
          onClick={() => props.onToggleCollapsed(true)}
        >
          <i className={`fa-solid ${props.collapseChevronClass}`} aria-hidden />
        </button>
      </div>
      <div className="pinned-widgets-aside-header-row pinned-widgets-aside-header-row--controls">
        <div className="pinned-widgets-pin-group" role="group" aria-label="Pin widgets to this panel">
          <button
            type="button"
            className={`pinned-widgets-pin ${props.metricsPinned ? 'active' : ''}`}
            title={props.metricsPinned ? 'Unpin metrics' : 'Pin live metrics here'}
            aria-label={props.metricsPinned ? 'Unpin metrics' : 'Pin live metrics to this panel'}
            aria-pressed={props.metricsPinned}
            onClick={() => props.onTogglePin('metrics', !props.metricsPinned)}
          >
            <span className="pinned-widgets-pin-icon" aria-hidden>
              <i className="fa-solid fa-chart-line" />
            </span>
          </button>
          <button
            type="button"
            className={`pinned-widgets-pin ${props.downloadsPinned ? 'active' : ''}`}
            title={props.downloadsPinned ? 'Unpin downloads' : 'Pin Hub download progress here'}
            aria-label={props.downloadsPinned ? 'Unpin downloads' : 'Pin download progress to this panel'}
            aria-pressed={props.downloadsPinned}
            onClick={() => props.onTogglePin('downloads', !props.downloadsPinned)}
          >
            <span className="pinned-widgets-pin-icon" aria-hidden>
              <i className="fa-solid fa-download" />
            </span>
          </button>
          <button
            type="button"
            className={`pinned-widgets-pin ${props.activityPinned ? 'active' : ''}`}
            title={props.activityPinned ? 'Unpin activity' : 'Pin model load and reply progress here'}
            aria-label={props.activityPinned ? 'Unpin activity' : 'Pin model load and reply progress to this panel'}
            aria-pressed={props.activityPinned}
            onClick={() => props.onTogglePin('activity', !props.activityPinned)}
          >
            <span className="pinned-widgets-pin-icon" aria-hidden>
              <i className="fa-solid fa-bolt" />
            </span>
          </button>
          <button
            type="button"
            className={`pinned-widgets-pin ${props.issuesPinned ? 'active' : ''}`}
            title={props.issuesPinned ? 'Unpin issues' : 'Pin blocking issues and warnings here'}
            aria-label={props.issuesPinned ? 'Unpin issues' : 'Pin blocking issues and warnings to this panel'}
            aria-pressed={props.issuesPinned}
            onClick={() => props.onTogglePin('issues', !props.issuesPinned)}
          >
            <span className="pinned-widgets-pin-icon" aria-hidden>
              <i className="fa-solid fa-triangle-exclamation" />
            </span>
          </button>
        </div>
        <div className="pinned-widgets-dock-symbols" role="group" aria-label="Widget bar position">
          {(
            [
              { side: 'left' as const, DockIcon: IconDockLeft, title: 'Dock bar on the left (beside nav)' },
              { side: 'right' as const, DockIcon: IconDockRight, title: 'Dock bar on the right (after main)' },
              { side: 'top' as const, DockIcon: IconDockTop, title: 'Dock bar on top (above main)' },
              { side: 'bottom' as const, DockIcon: IconDockBottom, title: 'Dock bar on the bottom (below main)' }
            ] as const
          ).map(({ side, DockIcon, title }) => (
            <button
              key={side}
              type="button"
              className={`pinned-widgets-dock-btn ${props.pinnedWidgetsSide === side ? 'pinned-widgets-dock-btn--active' : ''}`}
              title={title}
              aria-label={title}
              aria-pressed={props.pinnedWidgetsSide === side}
              onClick={() => props.onSetSide(side)}
            >
              <DockIcon />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
