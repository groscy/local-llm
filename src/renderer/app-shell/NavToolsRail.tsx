import type { ReactElement } from 'react'
import type { ToolDrawerId } from '@shared/uiRole'

export function NavToolsRail(props: {
  visibleToolDrawers: readonly ToolDrawerId[]
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
  const { IconBox, IconCpu, IconFlask, IconActivity, IconGear } = props
  return (
    <nav className="nav-tools" aria-label="Tools">
      {props.visibleToolDrawers.map((id: ToolDrawerId) => {
        if (id === 'hf') {
          return (
            <button
              key={id}
              type="button"
              className="nav-btn"
              onClick={props.onOpenHf}
              title="Browse and download models"
              aria-label="Models: browse and download models"
            >
              <IconBox />
              <span className="nav-btn-label">Models</span>
            </button>
          )
        }
        if (id === 'runtime') {
          return (
            <button
              key={id}
              type="button"
              className="nav-btn"
              onClick={props.onOpenRuntime}
              title="Run - turn your AI model on or off"
              aria-label="Run: turn your AI model on or off"
            >
              <IconCpu />
              <span className="nav-btn-label">Run</span>
            </button>
          )
        }
        if (id === 'train') {
          return (
            <button
              key={id}
              type="button"
              className="nav-btn"
              onClick={props.onOpenTrain}
              title="Train"
              aria-label="Train: open model tuning and training"
            >
              <IconFlask />
              <span className="nav-btn-label">Train</span>
            </button>
          )
        }
        return (
          <button
            key={id}
            type="button"
            className="nav-btn"
            onClick={props.onOpenMetrics}
            title="Metrics"
            aria-label="Metrics: open runtime and system metrics"
          >
            <IconActivity />
            <span className="nav-btn-label">Metrics</span>
          </button>
        )
      })}
      <button
        type="button"
        className="nav-btn"
        onClick={props.onOpenSettings}
        title="Settings"
        aria-label="Settings: open workspace preferences"
      >
        <IconGear />
        <span className="nav-btn-label">Settings</span>
      </button>
    </nav>
  )
}
