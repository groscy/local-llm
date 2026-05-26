import type { ReactElement } from 'react'
import type { WorkflowStageId } from '@shared/workflowModel'
import { WorkflowStageStrip } from './WorkflowStageStrip'

export function TopBarWorkflowSummary(props: {
  title: string
  subtitle?: string
  workspaceStatus: { state: string; hint: string }
  activeWorkflowStage: WorkflowStageId
  onStageClick?: (stage: WorkflowStageId) => void
}): ReactElement {
  return (
    <div className="top-bar-leading">
      <div className="top-bar-title">{props.title}</div>
      {props.subtitle ? <div className="top-bar-sub">{props.subtitle}</div> : null}
      <div className="workspace-status-row" role="status" aria-live="polite">
        <span className={`workspace-status-chip workspace-status-chip--${props.workspaceStatus.state.toLowerCase().replace(' ', '-')}`}>
          {props.workspaceStatus.state}
        </span>
        <span className="workspace-status-hint">{props.workspaceStatus.hint}</span>
      </div>
      <WorkflowStageStrip activeStage={props.activeWorkflowStage} onStageClick={props.onStageClick} />
    </div>
  )
}
