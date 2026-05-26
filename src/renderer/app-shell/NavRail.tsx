import type { ReactElement } from 'react'
import type { AppMainView, RoleTaskNavItem, ToolDrawerId } from '@shared/uiRole'
import { NavToolsRail } from './NavToolsRail'
import { TaskNavMain } from './TaskNavMain'

export function NavRail(props: {
  visibleRoleTasks: readonly RoleTaskNavItem[]
  visibleToolDrawers: readonly ToolDrawerId[]
  mainView: AppMainView
  wikiSubview: 'article' | 'knowledgeGraph'
  drawer: ToolDrawerId | 'settings' | null
  devShellChrome: boolean
  onOpenRoleTask: (task: RoleTaskNavItem) => void
  onOpenDevHub: () => void
  onOpenHf: () => void
  onOpenRuntime: () => void
  onOpenTrain: () => void
  onOpenMetrics: () => void
  onOpenSettings: () => void
  IconBox: () => ReactElement
  IconCpu: () => ReactElement
  IconFlask: () => ReactElement
  IconActivity: () => ReactElement
  IconGear: () => ReactElement
}): ReactElement {
  return (
    <aside className="nav-rail nav-rail--icons-only" aria-label="Primary navigation">
      <div className="nav-brand" title="Local LLM Desktop - private chat on your computer">
        <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="" width={44} height={44} decoding="async" />
      </div>
      <TaskNavMain
        visibleRoleTasks={props.visibleRoleTasks}
        mainView={props.mainView}
        wikiSubview={props.wikiSubview}
        drawer={props.drawer}
        devShellChrome={props.devShellChrome}
        onOpenRoleTask={props.onOpenRoleTask}
        onOpenDevHub={props.onOpenDevHub}
      />
      <div className="nav-spacer" />
      <NavToolsRail
        visibleToolDrawers={props.visibleToolDrawers}
        onOpenHf={props.onOpenHf}
        onOpenRuntime={props.onOpenRuntime}
        onOpenTrain={props.onOpenTrain}
        onOpenMetrics={props.onOpenMetrics}
        onOpenSettings={props.onOpenSettings}
        IconBox={props.IconBox}
        IconCpu={props.IconCpu}
        IconFlask={props.IconFlask}
        IconActivity={props.IconActivity}
        IconGear={props.IconGear}
      />
    </aside>
  )
}
