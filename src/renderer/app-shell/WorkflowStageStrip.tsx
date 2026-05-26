import type { ReactElement } from 'react'
import { CANONICAL_WORKFLOW_STAGES, type WorkflowStageId } from '@shared/workflowModel'

export function WorkflowStageStrip(props: {
  activeStage: WorkflowStageId
  onStageClick?: (stage: WorkflowStageId) => void
}): ReactElement {
  return (
    <div className="workflow-stage-strip" role="group" aria-label="Workflow stages">
      {CANONICAL_WORKFLOW_STAGES.map((stage) => (
        <div
          key={stage.id}
          className={`workflow-stage-pill ${stage.id === props.activeStage ? 'workflow-stage-pill--active' : ''}`}
          title={stage.guidance}
          aria-current={stage.id === props.activeStage ? 'step' : undefined}
          role={props.onStageClick ? 'button' : undefined}
          tabIndex={props.onStageClick ? 0 : undefined}
          onClick={props.onStageClick ? () => props.onStageClick!(stage.id) : undefined}
          onKeyDown={
            props.onStageClick
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    props.onStageClick!(stage.id)
                  }
                }
              : undefined
          }
        >
          <i className={`fa-solid ${stage.icon}`} aria-hidden />
          <span>{stage.label}</span>
        </div>
      ))}
    </div>
  )
}
