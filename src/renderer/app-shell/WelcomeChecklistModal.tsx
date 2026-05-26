import type { ReactElement } from 'react'

export function WelcomeChecklistModal(props: {
  roleLabel: string
  steps: readonly [string, string, string]
  footnote: string
  primaryLabel: string
  secondaryLabel: string
  onPrimary: () => void
  onSecondary: () => void
  onReady: () => void
}): ReactElement {
  return (
    <div
      className="modal-overlay welcome-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
    >
      <div className="modal-box modal-box--welcome" onClick={(e) => e.stopPropagation()}>
        <h2 id="welcome-modal-title" className="modal-title">
          Welcome to Local LLM Desktop
        </h2>
        <p className="modal-text welcome-modal-lead">
          This workspace is tuned for <strong>{props.roleLabel}</strong>. Follow this short checklist to get to your first
          role-specific outcome quickly.
        </p>
        <ol className="welcome-modal-steps">
          <li>
            <strong>{props.steps[0]}</strong>
          </li>
          <li>
            <strong>{props.steps[1]}</strong>
          </li>
          <li>
            <strong>{props.steps[2]}</strong>
          </li>
        </ol>
        <p className="welcome-modal-foot">{props.footnote}</p>
        <div className="modal-actions welcome-modal-actions">
          <button type="button" className="btn-primary" onClick={props.onPrimary}>
            {props.primaryLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={props.onSecondary}>
            {props.secondaryLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={props.onReady}>
            I&apos;m ready
          </button>
        </div>
      </div>
    </div>
  )
}
