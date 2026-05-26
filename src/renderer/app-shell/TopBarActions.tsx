import type { ReactElement } from 'react'

export function TopBarActions(props: {
  mainView: string
  mobileConvOpen: boolean
  mobileKbOpen: boolean
  runtimeOn: boolean
  nextBestActionLabel: string
  nextBestActionTitle: string
  setMobileConvOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  setMobileKbOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  openRuntimeDrawer: () => void
  onPrimaryAction: () => void
}): ReactElement {
  return (
    <div className="top-bar-actions">
      {props.mainView === 'chat' && (
        <>
          <button
            type="button"
            className="top-bar-mobile-toggle top-bar-mobile-toggle--conv"
            aria-expanded={props.mobileConvOpen}
            onClick={() => {
              props.setMobileKbOpen(false)
              props.setMobileConvOpen((o) => !o)
            }}
          >
            Chats
          </button>
          <button
            type="button"
            className="top-bar-mobile-toggle top-bar-mobile-toggle--kb"
            aria-expanded={props.mobileKbOpen}
            onClick={() => {
              props.setMobileConvOpen(false)
              props.setMobileKbOpen((o) => !o)
            }}
          >
            Knowledge
          </button>
        </>
      )}
      <div
        className="runtime-pill"
        title={props.runtimeOn ? 'AI is on — click for details' : 'AI is off — click for help starting a model'}
        aria-label={props.runtimeOn ? 'AI model is running. Open Run for details.' : 'AI model is off. Open Run to start.'}
        onClick={props.openRuntimeDrawer}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.openRuntimeDrawer()
          }
        }}
      >
        <span className={`runtime-pill-dot ${props.runtimeOn ? 'on' : ''}`} aria-hidden />
      </div>
      <button
        type="button"
        className="btn-secondary workspace-next-action-btn"
        title={props.nextBestActionTitle}
        onClick={props.onPrimaryAction}
      >
        <i className="fa-solid fa-bolt" aria-hidden />
        {props.nextBestActionLabel}
      </button>
    </div>
  )
}
