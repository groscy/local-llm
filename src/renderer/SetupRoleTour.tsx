import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ColorSchemeId } from '@shared/colorScheme'
import { COLOR_SCHEME_IDS, COLOR_SCHEME_LABELS } from '@shared/colorScheme'
import type { UiRole } from '@shared/uiRole'
import {
  UI_ROLE_IDS,
  UI_ROLE_CARD_BLURBS,
  UI_ROLE_LABELS,
  roleLayout,
  layoutDefaultMainArea,
  type AppMainView,
  type ToolDrawerId
} from '@shared/uiRole'
import { applyColorSchemeToDocument } from './colorSchemeDom'

const LLAMA_CPP_RELEASES_URL = 'https://github.com/ggerganov/llama.cpp/releases'
const LLAMA_CPP_SERVER_DOC_URL =
  'https://github.com/ggerganov/llama.cpp/blob/master/tools/server/README.md'

const THEME_PREVIEW_SWATCHES: Record<
  ColorSchemeId,
  { bg: string; surface: string; accent: string; text: string }
> = {
  violet: { bg: '#101524', surface: '#2b3550', accent: '#8a7dff', text: '#e6ebff' },
  'dark-charcoal-teal': { bg: '#111720', surface: '#23303b', accent: '#2ec4b6', text: '#e5f4f2' },
  'black-oled-blue': { bg: '#06080c', surface: '#131b2c', accent: '#7fd4ff', text: '#e9f6ff' },
  'light-warm-slate': { bg: '#fffaf2', surface: '#e7e0d2', accent: '#4e6f96', text: '#2d3950' },
  'solarized-light': { bg: '#fdf6e3', surface: '#eee8d5', accent: '#268bd2', text: '#3f4f5a' },
  'solarized-dark': { bg: '#002b36', surface: '#073642', accent: '#b58900', text: '#c8d5d6' },
  'cvd-rg-blue-amber': { bg: '#0d111a', surface: '#243248', accent: '#f4b942', text: '#e7eefb' },
  'cvd-by-violet-amber': { bg: '#1a1830', surface: '#2f2b4d', accent: '#ffbf47', text: '#efe9ff' }
}

export type SetupTourRuntimePanelProps = {
  ollamaReachable: boolean | null
  ollamaBaseUrl: string
  onRefreshProbe: () => void
  onInstallOllama: () => void | Promise<void>
  installBusy: boolean
  installLog: readonly string[]
  installNote: string | null
  installNoteKind: 'success' | 'info' | 'error' | null
  llamaDetected: boolean
  llamaBinaryValid: boolean
  llamaValidateError: string | null
}

export type SetupTourFinishPayload = {
  uiRole: UiRole
  colorScheme: ColorSchemeId
  showOnStartup: boolean
  /** Open this drawer after closing (e.g. runtime). */
  openDrawer: ToolDrawerId | 'settings' | null
  /** Optional main view switch. */
  mainView?: AppMainView
}

type Step = 0 | 1 | 2 | 3 | 4
const SETUP_TOUR_TOTAL_STEPS = 5

function SetupTourStepLabel(props: { stepNumber: number; title: string }): ReactElement {
  return (
    <p className="setup-tour-step-label">
      <span className="setup-tour-step-label-n">{props.stepNumber}</span>
      <span className="setup-tour-step-label-of"> / {SETUP_TOUR_TOTAL_STEPS}</span>
      <span className="setup-tour-step-label-title">{props.title}</span>
    </p>
  )
}

export function SetupRoleTour(props: {
  open: boolean
  initialRole: UiRole
  initialColorScheme: ColorSchemeId
  initialShowOnStartup: boolean
  runtime: SetupTourRuntimePanelProps
  onComplete: (p: SetupTourFinishPayload) => void | Promise<void>
}): ReactElement | null {
  const [step, setStep] = useState<Step>(0)
  const [draftRole, setDraftRole] = useState<UiRole>(props.initialRole)
  const [draftColorScheme, setDraftColorScheme] = useState<ColorSchemeId>(props.initialColorScheme)
  const [draftShowOnStartup, setDraftShowOnStartup] = useState<boolean>(props.initialShowOnStartup)
  const installLogRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!props.open) return
    setStep(0)
    setDraftRole(props.initialRole)
    setDraftColorScheme(props.initialColorScheme)
    setDraftShowOnStartup(props.initialShowOnStartup)
    applyColorSchemeToDocument(props.initialColorScheme)
  }, [props.open, props.initialRole, props.initialColorScheme, props.initialShowOnStartup])

  useEffect(() => {
    if (!props.open || step !== 1) return
    applyColorSchemeToDocument(draftColorScheme)
  }, [props.open, step, draftColorScheme])

  useEffect(() => {
    if (props.runtime.installLog.length === 0 || !installLogRef.current) return
    const el = installLogRef.current
    el.scrollTop = el.scrollHeight
  }, [props.runtime.installLog])

  const resetLocal = useCallback(() => {
    setStep(0)
    setDraftRole(props.initialRole)
    setDraftColorScheme(props.initialColorScheme)
    setDraftShowOnStartup(props.initialShowOnStartup)
    applyColorSchemeToDocument(props.initialColorScheme)
  }, [props.initialRole, props.initialColorScheme, props.initialShowOnStartup])

  const finish = useCallback(
    async (opts: { openDrawer: ToolDrawerId | 'settings' | null; mainView?: AppMainView }) => {
      applyColorSchemeToDocument(draftColorScheme)
      await props.onComplete({
        uiRole: draftRole,
        colorScheme: draftColorScheme,
        showOnStartup: draftShowOnStartup,
        openDrawer: opts.openDrawer,
        mainView: opts.mainView
      })
      resetLocal()
    },
    [draftColorScheme, draftRole, draftShowOnStartup, props, resetLocal]
  )

  const goBack = useCallback(() => {
    setStep((s) => {
      if (s === 1) {
        applyColorSchemeToDocument(props.initialColorScheme)
        return 0
      }
      if (s <= 0) return 0
      return (s - 1) as Step
    })
  }, [props.initialColorScheme])

  if (!props.open) return null

  const rt = props.runtime
  const layout = roleLayout(draftRole)
  const primaryMainView = layoutDefaultMainArea(layout)
  const primaryNeedsRuntimeDrawer = primaryMainView === 'chat'

  return (
    <div className="modal-overlay welcome-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="setup-tour-title">
      <div className="modal-box modal-box--welcome modal-box--setup-tour" onClick={(e) => e.stopPropagation()}>
        {step === 0 && (
          <>
            <SetupTourStepLabel stepNumber={1} title="Workspace role" />
            <h2 id="setup-tour-title" className="modal-title">
              How will you use this app?
            </h2>
            <p id="setup-tour-role-desc" className="modal-text welcome-modal-lead">
              <strong className="setup-tour-role-lead-strong">Tap one card</strong> to choose your role. This shapes task
              navigation, workspace defaults, and which settings are surfaced first. You can switch anytime under{' '}
              <strong>Settings -&gt; General</strong>.
            </p>
            <div
              className="setup-tour-role-grid"
              role="radiogroup"
              aria-labelledby="setup-tour-title"
              aria-describedby="setup-tour-role-desc"
            >
              {UI_ROLE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={draftRole === id}
                  className={`setup-tour-role-card${draftRole === id ? ' setup-tour-role-card--selected' : ''}`}
                  onClick={() => setDraftRole(id)}
                >
                  {draftRole === id ? (
                    <span className="setup-tour-role-card-badge" aria-hidden="true">
                      <i className="fa-solid fa-check setup-tour-role-card-badge-icon" />
                      Selected
                    </span>
                  ) : null}
                  <span className="setup-tour-role-card-title">
                    {draftRole === id ? (
                      <i className="fa-solid fa-circle-check setup-tour-role-card-title-check" aria-hidden="true" />
                    ) : (
                      <span className="setup-tour-role-card-title-radio" aria-hidden="true" />
                    )}
                    {UI_ROLE_LABELS[id]}
                  </span>
                  <span className="setup-tour-role-card-blurb muted">{UI_ROLE_CARD_BLURBS[id]}</span>
                </button>
              ))}
            </div>
            <p className="setup-tour-role-summary" role="status" aria-live="polite">
              Your choice: <strong>{UI_ROLE_LABELS[draftRole]}</strong>
            </p>
            <p className="setup-tour-role-next-hint muted">Next you will pick a color theme.</p>
            <div className="modal-actions welcome-modal-actions">
              <button type="button" className="btn-primary" onClick={() => setStep(1)}>
                Continue to theme
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <SetupTourStepLabel stepNumber={2} title="Color theme" />
            <h2 className="modal-title">Choose a color theme</h2>
            <p className="modal-text welcome-modal-lead">
              The preview updates as you click. You can refine appearance later under Settings -&gt; Appearance.
            </p>
            <div className="setup-tour-theme-list" role="radiogroup" aria-label="Color themes">
              {COLOR_SCHEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={draftColorScheme === id}
                  className={`setup-tour-theme-card${draftColorScheme === id ? ' setup-tour-theme-card--selected' : ''}`}
                  onClick={() => setDraftColorScheme(id)}
                >
                  {(() => {
                    const preview = THEME_PREVIEW_SWATCHES[id]
                    return (
                  <span className="setup-tour-theme-preview" aria-hidden="true">
                    <span className="setup-tour-theme-preview-ui" style={{ background: preview.bg }}>
                      <span className="setup-tour-theme-preview-ui-sidebar" style={{ background: preview.surface }} />
                      <span className="setup-tour-theme-preview-ui-main">
                        <span className="setup-tour-theme-preview-ui-header" style={{ background: preview.surface }}>
                          <span
                            className="setup-tour-theme-preview-ui-dot"
                            style={{ background: preview.accent }}
                          />
                          <span
                            className="setup-tour-theme-preview-ui-line"
                            style={{ background: preview.text }}
                          />
                        </span>
                        <span className="setup-tour-theme-preview-ui-cards">
                          <span
                            className="setup-tour-theme-preview-ui-card"
                            style={{ background: preview.surface }}
                          />
                          <span
                            className="setup-tour-theme-preview-ui-card setup-tour-theme-preview-ui-card--accent"
                            style={{ background: preview.accent }}
                          />
                        </span>
                      </span>
                    </span>
                  </span>
                    )
                  })()}
                  <span className="setup-tour-theme-card-label">{COLOR_SCHEME_LABELS[id]}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions welcome-modal-actions setup-tour-actions-split">
              <button type="button" className="btn-secondary" onClick={goBack}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <SetupTourStepLabel stepNumber={3} title="Runtime setup" />
            <h2 className="modal-title">Runtime environments</h2>
            <p className="modal-text welcome-modal-lead">
              This app talks to a local model through <span className="setup-tour-em">Ollama</span> (easiest) or a{' '}
              <span className="setup-tour-em">llama-server</span> binary. Install what you need now, or continue and open Run
              from the sidebar when you are ready. This is step 1 of the presentation flow.
            </p>
            <div className="setup-tour-runtime-scroll">
              <div className="runtime-ollama-probe" role="status">
                <div className="runtime-ollama-probe-row">
                  <span className="runtime-ollama-probe-label">Ollama reachable</span>
                  {rt.ollamaReachable == null ? (
                    <span className="muted runtime-ollama-probe-pending">Checking…</span>
                  ) : (
                    <>
                      <span
                        className={`runtime-ollama-probe-mark ${rt.ollamaReachable ? 'runtime-ollama-probe-mark--ok' : 'runtime-ollama-probe-mark--bad'}`}
                        aria-label={rt.ollamaReachable ? 'Ollama reachable' : 'Ollama not reachable'}
                        title={
                          rt.ollamaReachable ? 'Daemon responds at configured URL' : 'No Ollama API at configured URL'
                        }
                      >
                        {rt.ollamaReachable ? '✓' : '✗'}
                      </span>
                      <code className="inline-code runtime-ollama-probe-url">{rt.ollamaBaseUrl}</code>
                    </>
                  )}
                </div>
                <div className="setup-tour-runtime-toolbar">
                  <button type="button" className="btn-ghost-sm" onClick={() => rt.onRefreshProbe()}>
                    Refresh check
                  </button>
                </div>
                {rt.ollamaReachable === false ? (
                  <div className="runtime-ollama-install">
                    <p className="muted runtime-ollama-install-disclosure">
                      Ollama is third-party software from{' '}
                      <button type="button" className="btn-link-inline" onClick={() => void window.api.openExternalUrl('https://ollama.com/')}>
                        ollama.com
                      </button>
                      . Install Ollama downloads the official script from ollama.com and runs it (PowerShell on Windows,{' '}
                      <code className="inline-code">install.sh</code> on macOS and Linux). This app stays pointed at{' '}
                      <code className="inline-code">{rt.ollamaBaseUrl}</code>.
                    </p>
                    <div className="runtime-ollama-install-actions">
                      <button type="button" className="btn-primary" disabled={rt.installBusy} onClick={() => void rt.onInstallOllama()}>
                        {rt.installBusy ? 'Installing…' : 'Install Ollama'}
                      </button>
                    </div>
                    {(rt.installBusy || rt.installLog.length > 0) && (
                      <div className="runtime-ollama-install-progress" aria-live="polite" aria-label="Installation progress">
                        <div className="runtime-ollama-install-progress-head">
                          {rt.installBusy ? 'Installation progress' : 'Last install output'}
                        </div>
                        <pre ref={installLogRef} className="runtime-ollama-install-log" tabIndex={0}>
                          {rt.installLog.length === 0 ? (rt.installBusy ? 'Starting…' : '') : rt.installLog.join('\n')}
                        </pre>
                      </div>
                    )}
                    {rt.installNote ? (
                      <p
                        className={`runtime-ollama-install-note${
                          rt.installNoteKind === 'error'
                            ? ' runtime-ollama-install-note--error'
                            : rt.installNoteKind === 'success'
                              ? ' runtime-ollama-install-note--success'
                              : rt.installNoteKind === 'info'
                                ? ' runtime-ollama-install-note--info'
                                : ''
                        }`}
                        role="status"
                      >
                        {rt.installNote}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {rt.llamaDetected && !rt.llamaBinaryValid && rt.llamaValidateError ? (
                <div className="runtime-llama-setup-banner runtime-llama-setup-banner--error" role="alert">
                  <p className="runtime-llama-setup-banner-title">llama-server binary is not usable</p>
                  <p className="muted" style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>
                    {rt.llamaValidateError}
                  </p>
                </div>
              ) : null}

              <details className="setup-tour-runtime-advanced">
                <summary>Advanced: llama.cpp (llama-server)</summary>
                <p className="muted setup-tour-runtime-llama-lead">
                  Download a release build, add <code className="inline-code">llama-server</code> to your PATH, or set the full path under Run -&gt; Binary (or Settings -&gt; AI engine).
                </p>
                <div className="runtime-llama-setup-actions">
                  <button type="button" className="btn-primary" onClick={() => void window.api.openExternalUrl(LLAMA_CPP_RELEASES_URL)}>
                    Open llama.cpp releases
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void window.api.openExternalUrl(LLAMA_CPP_SERVER_DOC_URL)}>
                    Server docs
                  </button>
                </div>
              </details>

              {rt.ollamaReachable ? (
                <p className="muted setup-tour-runtime-foot">Ollama is responding. Next step: open Knowledge after setup to continue the presentation flow.</p>
              ) : null}
            </div>
            <div className="modal-actions welcome-modal-actions setup-tour-actions-split">
              <button type="button" className="btn-secondary" onClick={goBack}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={() => setStep(3)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <SetupTourStepLabel stepNumber={4} title="Role quick tip" />
            <h2 className="modal-title">Quick tip</h2>
            <p className="modal-text welcome-modal-lead">
              <span className="setup-tour-em">{UI_ROLE_LABELS[draftRole]} workspace:</span> {layout.tourTip}
            </p>
            <div className="modal-actions welcome-modal-actions setup-tour-actions-split">
              <button type="button" className="btn-secondary" onClick={goBack}>
                Back
              </button>
              <div className="setup-tour-actions-cluster">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void finish({ openDrawer: primaryNeedsRuntimeDrawer ? 'runtime' : null, mainView: primaryMainView })}
                >
                  {layout.tourCtaPrimaryLabel}
                </button>
                {layout.tourCtaSecondaryLabel ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      layout.tourSecondaryBehavior === 'open_runtime_finish'
                        ? void finish({ openDrawer: 'runtime' })
                        : layout.tourSecondaryBehavior === 'open_settings_finish'
                          ? void finish({ openDrawer: 'settings', mainView: primaryMainView })
                          : setStep(4)
                    }
                  >
                    {layout.tourCtaSecondaryLabel}
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setStep(4)}>
                    Next
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <SetupTourStepLabel stepNumber={5} title="First-run checklist" />
            <h2 className="modal-title">{layout.tourChecklist.title}</h2>
            <ol className="welcome-modal-steps">
              <li>
                <span className="setup-tour-em">{layout.tourChecklist.steps[0]}</span>
              </li>
              <li>
                <span className="setup-tour-em">{layout.tourChecklist.steps[1]}</span>
              </li>
              <li>
                <span className="setup-tour-em">{layout.tourChecklist.steps[2]}</span>
              </li>
            </ol>
            <p className="welcome-modal-foot muted">
              {layout.tourChecklist.footnote}
            </p>
            <label className="setup-tour-startup-toggle">
              <input
                type="checkbox"
                checked={draftShowOnStartup}
                onChange={(e) => setDraftShowOnStartup(e.target.checked)}
              />
              <span>Show setup tour on startup when onboarding updates are available</span>
            </label>
            <div className="modal-actions welcome-modal-actions setup-tour-actions-split">
              <button type="button" className="btn-secondary" onClick={goBack}>
                Back
              </button>
              <div className="setup-tour-actions-cluster">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    void finish({
                      openDrawer: layout.tourChecklist.primaryAction.openDrawer,
                      mainView: layout.tourChecklist.primaryAction.mainView
                    })
                  }
                >
                  {layout.tourChecklist.primaryAction.label}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    void finish({
                      openDrawer: layout.tourChecklist.secondaryAction.openDrawer,
                      mainView: layout.tourChecklist.secondaryAction.mainView
                    })
                  }
                >
                  {layout.tourChecklist.secondaryAction.label}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
