import { useCallback, useState, type ReactElement } from 'react'
import type { UiRole } from '@shared/uiRole'
import {
  UI_ROLE_IDS,
  UI_ROLE_CARD_BLURBS,
  UI_ROLE_LABELS,
  roleLayout,
  type MainShellView
} from '@shared/uiRole'

export type SetupTourFinishPayload = {
  uiRole: UiRole
  /** Open this drawer after closing (e.g. runtime). */
  openDrawer: 'runtime' | 'hf' | null
  /** Optional main view switch. */
  mainView?: MainShellView
}

type Step = 0 | 1 | 2

export function SetupRoleTour(props: {
  open: boolean
  initialRole: UiRole
  onComplete: (p: SetupTourFinishPayload) => void | Promise<void>
}): ReactElement | null {
  const [step, setStep] = useState<Step>(0)
  const [draftRole, setDraftRole] = useState<UiRole>(props.initialRole)

  const resetLocal = useCallback(() => {
    setStep(0)
    setDraftRole(props.initialRole)
  }, [props.initialRole])

  const finish = useCallback(
    async (opts: { openDrawer: 'runtime' | 'hf' | null; mainView?: MainShellView }) => {
      await props.onComplete({
        uiRole: draftRole,
        openDrawer: opts.openDrawer,
        mainView: opts.mainView
      })
      resetLocal()
    },
    [draftRole, props, resetLocal]
  )

  if (!props.open) return null

  const layout = roleLayout(draftRole)
  const primaryOpensWiki =
    layout.defaultMainView === 'wiki' && layout.tourCtaPrimaryLabel.toLowerCase().includes('wiki')

  return (
    <div className="modal-overlay welcome-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-tour-title">
      <div className="modal-box modal-box--welcome modal-box--setup-tour" onClick={(e) => e.stopPropagation()}>
        {step === 0 && (
          <>
            <h2 id="setup-tour-title" className="modal-title">
              How will you use this app?
            </h2>
            <p className="modal-text welcome-modal-lead">Pick a role. You can change this anytime in Settings → General.</p>
            <div className="setup-tour-role-grid" role="list">
              {UI_ROLE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="listitem"
                  className={`setup-tour-role-card${draftRole === id ? ' setup-tour-role-card--selected' : ''}`}
                  onClick={() => setDraftRole(id)}
                >
                  <span className="setup-tour-role-card-title">{UI_ROLE_LABELS[id]}</span>
                  <span className="setup-tour-role-card-blurb muted">{UI_ROLE_CARD_BLURBS[id]}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions welcome-modal-actions">
              <button type="button" className="btn-primary" onClick={() => setStep(1)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="modal-title">Quick tip</h2>
            <p className="modal-text welcome-modal-lead">
              <strong>{UI_ROLE_LABELS[draftRole]}:</strong> {layout.tourTip}
            </p>
            <div className="modal-actions welcome-modal-actions">
              {primaryOpensWiki ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void finish({ openDrawer: null, mainView: 'wiki' })}
                >
                  {layout.tourCtaPrimaryLabel}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void finish({ openDrawer: 'runtime', mainView: 'chat' })}
                >
                  {layout.tourCtaPrimaryLabel}
                </button>
              )}
              {layout.tourCtaSecondaryLabel ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    layout.tourSecondaryBehavior === 'open_runtime_finish'
                      ? void finish({ openDrawer: 'runtime' })
                      : setStep(2)
                  }
                >
                  {layout.tourCtaSecondaryLabel}
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                  Next
                </button>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="modal-title">Start your model</h2>
            <ol className="welcome-modal-steps">
              <li>
                <strong>Open Run</strong> in the sidebar if you need Ollama or llama.cpp paths.
              </li>
              <li>
                <strong>Pick a model</strong> in the top bar, press <strong>play</strong>, and wait for the green dot.
              </li>
              <li>
                <strong>New chat</strong>, type a message, and send.
              </li>
            </ol>
            <p className="welcome-modal-foot muted">
              Reopen tips from Settings → General. Change role there anytime.
            </p>
            <div className="modal-actions welcome-modal-actions">
              <button type="button" className="btn-primary" onClick={() => void finish({ openDrawer: 'runtime' })}>
                Open Run &amp; finish
              </button>
              <button type="button" className="btn-secondary" onClick={() => void finish({ openDrawer: null })}>
                I&apos;m ready
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
