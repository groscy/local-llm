import { useCallback, useState, type ReactElement } from 'react'
import { IdeDeveloperJourneyView, type IdeDeveloperJourneyViewProps } from './IdeDeveloperJourneyView'

export type ElectronDevDashboardProps = IdeDeveloperJourneyViewProps & {
  userDataPath: string | null
  logsPath: string | null
  onOpenTrain: () => void
  onOpenSettingsGeneral: () => void
  /** Toggle IDE HTTP bridge (127.0.0.1); persisted like Settings → Integrations. */
  onBridgeListenChange: (enabled: boolean) => void
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
    ...journey
  } = props

  return (
    <div className="electron-dev-dashboard">
      <header className="electron-dev-hero">
        <div className="electron-dev-hero-text">
          <h1 className="electron-dev-hero-title">Developer hub</h1>
          <p className="electron-dev-hero-sub muted">
            Bridge status, shortcuts, and paths. Full checklist lives below—collapsed by default.
          </p>
        </div>
        <div className="electron-dev-hero-aside">
          <div className={`electron-dev-hero-status${bridgeEnabled ? ' electron-dev-hero-status--on' : ''}`}>
            <span className="electron-dev-hero-status-dot" aria-hidden />
            <span>{bridgeEnabled ? 'Bridge on' : 'Bridge off'}</span>
            <span className="electron-dev-hero-status-meta">
              <code className="inline-code">{bridgePort}</code>
              <span className="electron-dev-hero-status-sep">·</span>
              {tokenConfigured ? 'Token set' : 'No token'}
            </span>
          </div>
          <div className="electron-dev-hero-actions">
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
      </header>

      <div className="electron-dev-grid">
        <section className="electron-dev-panel" aria-label="Quick actions">
          <h2 className="electron-dev-panel-title">Open</h2>
          <div className="electron-dev-tiles">
            <button type="button" className="electron-dev-tile" onClick={() => journey.onOpenWiki()}>
              <i className="fa-solid fa-book electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Wiki</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => journey.onOpenModels()}>
              <i className="fa-solid fa-box electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Models</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => journey.onOpenRun()}>
              <i className="fa-solid fa-microchip electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Run</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => onOpenTrain()}>
              <i className="fa-solid fa-flask electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Train</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => journey.onOpenMetrics()}>
              <i className="fa-solid fa-chart-line electron-dev-tile-icon" aria-hidden />
              <span className="electron-dev-tile-label">Stats</span>
            </button>
            <button type="button" className="electron-dev-tile" onClick={() => journey.onOpenIntegrations()}>
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

      <details className="electron-dev-journey-details">
        <summary className="electron-dev-journey-summary">IntelliJ journey, API notes, and bridge tests</summary>
        <div className="electron-dev-journey-body">
          <IdeDeveloperJourneyView
            {...journey}
            bridgeEnabled={bridgeEnabled}
            bridgePort={bridgePort}
            tokenConfigured={tokenConfigured}
            showOpenChatShortcut={false}
          />
        </div>
      </details>
    </div>
  )
}
