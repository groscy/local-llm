import type { ReactElement } from 'react'
import type { AppMainView, RoleTaskNavItem, ToolDrawerId } from '@shared/uiRole'
import { featureMaturityByView } from '@shared/workflowModel'
import { FEATURE_ROUTE_REGISTRY } from './featureRouteRegistry'

export function TaskNavMain(props: {
  visibleRoleTasks: readonly RoleTaskNavItem[]
  mainView: AppMainView
  wikiSubview: 'article' | 'knowledgeGraph'
  drawer: ToolDrawerId | 'settings' | null
  devShellChrome: boolean
  onOpenRoleTask: (task: RoleTaskNavItem) => void
  onOpenDevHub: () => void
}): ReactElement {
  return (
    <nav className="nav-main">
      {props.visibleRoleTasks.map((task) => {
        const routeMeta = task.mainView ? FEATURE_ROUTE_REGISTRY[task.mainView] : null
        const maturity = task.mainView ? featureMaturityByView(task.mainView) : null
        const maturitySuffix = maturity?.maturity === 'preview' ? ' (Preview)' : ''
        const active =
          (task.mainView === 'knowledgeGraph'
            ? (props.mainView === 'wiki' && props.wikiSubview === 'knowledgeGraph') || props.mainView === 'knowledgeGraph'
            : task.mainView === 'wiki'
              ? props.mainView === 'wiki' && props.wikiSubview === 'article'
              : task.mainView != null && props.mainView === task.mainView) ||
          (task.drawer != null && props.drawer === task.drawer) ||
          (task.drawer === 'settings' && props.drawer === 'settings')
        return (
          <button
            key={task.id}
            type="button"
            className={`nav-btn ${active ? 'active' : ''}`}
            onClick={() => props.onOpenRoleTask(task)}
            title={`${routeMeta?.title ?? task.label}${maturitySuffix} - ${task.hint}`}
            aria-label={`${routeMeta?.title ?? task.label}${maturitySuffix}: ${task.hint}`}
          >
            <i className={`fa-solid ${task.icon}`} aria-hidden />
            <span className="nav-btn-label">{task.label}</span>
          </button>
        )
      })}
      {props.devShellChrome && !props.visibleRoleTasks.some((task) => task.mainView === 'electronDev') ? (
        <button
          type="button"
          className={`nav-btn ${props.mainView === 'electronDev' ? 'active' : ''}`}
          onClick={props.onOpenDevHub}
          title="Developer hub - bridge, shortcuts, setup tour"
          aria-label="Develop: open Developer hub for bridge, shortcuts, and setup tour"
        >
          <i className="fa-solid fa-code" aria-hidden />
          <span className="nav-btn-label">Develop</span>
        </button>
      ) : null}
    </nav>
  )
}
