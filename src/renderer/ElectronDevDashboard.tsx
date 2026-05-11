import { useCallback, useState, type ReactElement } from 'react'
import type { IdeDeveloperJourneyViewProps } from './IdeDeveloperJourneyView'

export type ElectronDevDashboardProps = IdeDeveloperJourneyViewProps & {
  userDataPath: string | null
  logsPath: string | null
  onOpenTrain: () => void
  onOpenSettingsGeneral: () => void
  /** Toggle IDE HTTP bridge (127.0.0.1); persisted like Settings → Integrations. */
  onBridgeListenChange: (enabled: boolean) => void
  idePromptMonitor: {
    modelState: 'idle' | 'processing'
    requestId: string | null
    source: string | null
    startedAt: number | null
    promptPreview: string
    generatedResponse: string
    actions: string[]
    error: string | null
    updatedAt: number | null
  }
}

export function ElectronDevDashboard(props: ElectronDevDashboardProps): ReactElement {
  const [pathNote, setPathNote] = useState<string | null>(null)

  const openDir = useCallback(async (label: string, path: string | null) => {
    setPathNote(null)
    if (!path?.trim()) {
      setPathNote(`${label} path is not available yet.`)
      return
    }
    const r = await window.api.openPathInExplorer(path.trim())
    if (!r.ok) setPathNote(r.error ?? `Could not open ${label}`)
  }, [])

  const {
    userDataPath,
    logsPath,
    onOpenTrain,
    onOpenSettingsGeneral,
    onBridgeListenChange,
    bridgeEnabled,
    bridgePort,
    tokenConfigured,
    runtimeRunning,
    runtimeKind,
    onOpenWiki,
    onOpenModels,
    onOpenRun,
    onOpenMetrics,
    onOpenIntegrations,
    idePromptMonitor
  } = props

  return (
    <div className="electron-dev-dashboard">
      <header className="electron-dev-hero">
        <div className="electron-dev-hero-text">
          <h1 className="electron-dev-hero-title">Developer hub</h1>
          <p className="electron-dev-hero-sub muted">
            Bridge status, runtime health, shortcuts, and local paths in one place.
          </p>
        </div>
      </header>

      <section className="electron-dev-live-status" aria-label="Live status">
        <div className="electron-dev-live-status-head">
          <h2 className="electron-dev-live-status-title">Live status</h2>
          <p className="electron-dev-live-status-sub muted">Current bridge and runtime state updates live as this view refreshes.</p>
        </div>
        <div className="electron-dev-live-status-body">
          <div className={`electron-dev-hero-status${bridgeEnabled ? ' electron-dev-hero-status--on' : ''}`}>
            <span className="electron-dev-hero-status-dot" aria-hidden />
            <span>{bridgeEnabled ? 'Bridge on' : 'Bridge off'}</span>
            <span className="electron-dev-hero-status-meta">
              <code className="inline-code">{bridgePort}</code>
              <span className="electron-dev-hero-status-sep">·</span>
              {tokenConfigured ? 'Token set' : 'No token'}
            </span>
          </div>
          <div className={`electron-dev-hero-status${runtimeRunning ? ' electron-dev-hero-status--on' : ''}`}>
            <span className="electron-dev-hero-status-dot" aria-hidden />
            <span>{runtimeRunning ? 'Runtime on' : 'Runtime off'}</span>
            <span className="electron-dev-hero-status-meta">
              {runtimeKind || 'unknown'}
            </span>
          </div>
          <div className="electron-dev-hero-actions electron-dev-live-status-actions">
            {bridgeEnabled ? (
              <button
                type="button"
                className="btn-secondary electron-dev-bridge-stop"
                onClick={() => onBridgeListenChange(false)}
              >
                Stop bridge
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => onBridgeListenChange(true)}>
                Start bridge
              </button>
            )}
          </div>
        </div>
        <div className="electron-dev-model-monitor" role="region" aria-label="IDE prompt monitor">
          <div className="electron-dev-model-monitor-head">
            <strong>Model state</strong>
            <span
              className={`electron-dev-model-monitor-badge ${
                idePromptMonitor.modelState === 'processing' ? 'is-processing' : 'is-idle'
              }`}
            >
              {idePromptMonitor.modelState === 'processing' ? 'Processing prompt' : 'Idle'}
            </span>
            {idePromptMonitor.source ? <span className="muted">Source: {idePromptMonitor.source}</span> : null}
          </div>
          {idePromptMonitor.promptPreview ? (
            <p className="electron-dev-model-monitor-prompt">
              <span className="muted">Prompt:</span> {idePromptMonitor.promptPreview}
            </p>
          ) : null}
          {idePromptMonitor.error ? (
            <p className="electron-dev-model-monitor-error">{idePromptMonitor.error}</p>
          ) : (
            <pre className="electron-dev-model-monitor-response">
              {idePromptMonitor.generatedResponse.trim() || 'No generated response yet.'}
            </pre>
          )}
          <div className="electron-dev-model-monitor-actions">
            <div className="muted">IDE plugin actions</div>
            {idePromptMonitor.actions.length === 0 ? (
              <div className="muted">No actions reported yet.</div>
            ) : (
              <ul>
                {idePromptMonitor.actions.map((line, idx) => (
                  <li key={`${idx}-${line.slice(0, 32)}`}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className="electron-dev-grid">
        <section className="electron-dev-panel" aria-label="Quick actions">
          <h2 className="electron-dev-panel-title">Open</h2>
          <div className="electron-dev-tiles">
            <button type="button" className="electron-dev-tile" onClick={() => onOpenWiki()}>
              <i className="fa-solid fa-book electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Wiki</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenModels()}>
              <i className="fa-solid fa-box electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Models</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenRun()}>
              <i className="fa-solid fa-microchip electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Run</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenTrain()}>
              <i className="fa-solid fa-flask electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Train</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenMetrics()}>
              <i className="fa-solid fa-chart-line electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Metrics</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenIntegrations()}>
              <i className="fa-solid fa-plug electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Integrations</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenSettingsGeneral()}>
              <i className="fa-solid fa-gear electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Settings</span>
            </button>
          </div>
        </section>

        <section className="electron-dev-panel electron-dev-panel--paths" aria-label="Disk paths">
          <h2 className="electron-dev-panel-title">Paths</h2>
          <div className="electron-dev-path-links">
            <button type="button" className="electron-dev-path-link" onClick={() => void openDir('User data', userDataPath)}>
              User data
            </button>
            <button type="button" className="electron-dev-path-link" onClick={() => void openDir('Logs', logsPath)}>
              Logs
            </button>
          </div>
          {pathNote ? <p className="electron-dev-path-note">{pathNote}</p> : null}
        </section>
      </div>
    </div>
  )
}
