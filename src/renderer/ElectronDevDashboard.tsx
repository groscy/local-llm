import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { ClaudeMemoryCaptureStats } from '@shared/types'
import type { IdeDeveloperJourneyViewProps } from './IdeDeveloperJourneyView'

export type ElectronDevDashboardProps = IdeDeveloperJourneyViewProps & {
  appPath: string | null
  userDataPath: string | null
  logsPath: string | null
  onOpenTrain: () => void
  onOpenSettingsGeneral: () => void
  onStartClaudeBridge: () => Promise<{ ok: boolean; detail?: string; command?: string; error?: string }>
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
  const [memoryStats, setMemoryStats] = useState<ClaudeMemoryCaptureStats | null>(null)
  const [bridgeLaunchBusy, setBridgeLaunchBusy] = useState(false)
  const [bridgeLaunchNote, setBridgeLaunchNote] = useState<string | null>(null)
  const [setupCopyNote, setSetupCopyNote] = useState<string | null>(null)

  const openDir = useCallback(async (label: string, path: string | null) => {
    setPathNote(null)
    if (!path?.trim()) {
      setPathNote(`${label} path is not available yet.`)
      return
    }
    const r = await window.api.openPathInExplorer(path.trim())
    if (!r.ok) setPathNote(r.error ?? `Could not open ${label}`)
  }, [])

  const copyText = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setSetupCopyNote(`${label} copied.`)
      window.setTimeout(() => setSetupCopyNote(null), 1800)
    } catch {
      setSetupCopyNote(`Could not copy ${label.toLowerCase()}.`)
      window.setTimeout(() => setSetupCopyNote(null), 2200)
    }
  }, [])

  const {
    appPath,
    userDataPath,
    logsPath,
    onOpenTrain,
    onOpenSettingsGeneral,
    onStartClaudeBridge,
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

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const stats = await window.api.claudeMemoryStatus()
        if (!cancelled) setMemoryStats(stats)
      } catch {
        if (!cancelled) setMemoryStats(null)
      }
    }
    void load()
    const id = window.setInterval(() => void load(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const lastClaudeSeenAt = memoryStats?.lastIngestAt ?? null
  const claudeIngestAgeMs = lastClaudeSeenAt ? Date.now() - lastClaudeSeenAt : Number.POSITIVE_INFINITY
  const claudeBridgeActive = bridgeEnabled && Number.isFinite(claudeIngestAgeMs) && claudeIngestAgeMs < 5 * 60 * 1000
  const claudeBridgeSeenBefore = Boolean((memoryStats?.events ?? 0) > 0 || (memoryStats?.sessions ?? 0) > 0)
  const claudeBridgeOn = bridgeEnabled && (claudeBridgeActive || claudeBridgeSeenBefore)
  const claudeBridgeLabel = !bridgeEnabled
    ? 'Claude bridge waiting'
    : claudeBridgeActive
      ? 'Claude bridge active'
      : claudeBridgeSeenBefore
        ? 'Claude bridge idle'
        : 'Claude bridge awaiting first session'
  const claudeBridgeMeta = memoryStats
    ? `${memoryStats.events} events · ${memoryStats.sessions} sessions`
    : 'Status unavailable'
  const connectionNodes: Array<{ id: string; label: string; detail: string; state: 'ok' | 'warn' | 'neutral' }> = [
    {
      id: 'claude-client',
      label: 'Claude client',
      detail: lastClaudeSeenAt
        ? `Last ingest ${new Date(lastClaudeSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'No direct Claude ingest yet',
      state: lastClaudeSeenAt ? 'ok' : 'warn'
    },
    {
      id: 'bridge',
      label: 'Bridge',
      detail: bridgeEnabled ? `127.0.0.1:${bridgePort}` : 'Disabled',
      state: bridgeEnabled ? 'ok' : 'warn'
    },
    {
      id: 'runtime',
      label: 'Runtime',
      detail: runtimeRunning ? `Running (${runtimeKind || '?'})` : 'Stopped',
      state: runtimeRunning ? 'ok' : 'warn'
    },
    {
      id: 'memory',
      label: 'Memory store',
      detail: memoryStats ? `${memoryStats.events} events · ${memoryStats.sessions} sessions` : 'Unavailable',
      state: memoryStats && memoryStats.events > 0 ? 'ok' : memoryStats ? 'neutral' : 'warn'
    }
  ]
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`
  const mcpScriptPath = `${(appPath ?? '.').replace(/\//g, '\\')}\\scripts\\claude-bridge-mcp.ps1`
  const mcpServerCommand = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${mcpScriptPath}" -Url ${bridgeUrl}${tokenConfigured ? ' -Token YOUR_TOKEN' : ''}`
  const claudeMcpAddCommand = `claude mcp add --transport stdio my-bridge -- ${mcpServerCommand}`

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
          <div className={`electron-dev-hero-status${claudeBridgeOn ? ' electron-dev-hero-status--on' : ''}`}>
            <span className="electron-dev-hero-status-dot" aria-hidden />
            <span>{claudeBridgeLabel}</span>
            <span className="electron-dev-hero-status-meta">{claudeBridgeMeta}</span>
          </div>
          <div className="electron-dev-hero-actions electron-dev-live-status-actions">
            {bridgeEnabled ? (
              <button
                type="button"
                className="btn-primary electron-dev-live-status-icon-btn electron-dev-bridge-stop is-active"
                onClick={() => onBridgeListenChange(false)}
                title="HTTP bridge active (click to stop)"
                aria-label="HTTP bridge active, click to stop"
              >
                <i className="fa-solid fa-plug-circle-check" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary electron-dev-live-status-icon-btn is-inactive"
                onClick={() => onBridgeListenChange(true)}
                title="HTTP bridge inactive (click to start)"
                aria-label="HTTP bridge inactive, click to start"
              >
                <i className="fa-solid fa-plug-circle-xmark" aria-hidden />
              </button>
            )}
            <button
              type="button"
              className={`btn-secondary electron-dev-live-status-icon-btn ${
                claudeBridgeActive ? 'is-active' : 'is-inactive'
              }`}
              disabled={bridgeLaunchBusy || claudeBridgeActive}
              onClick={() => {
                setBridgeLaunchBusy(true)
                setBridgeLaunchNote(null)
                void onStartClaudeBridge()
                  .then((res) => {
                    if (res.ok) {
                      setBridgeLaunchNote(res.detail ?? 'Claude MCP bridge configured.')
                    } else {
                      setBridgeLaunchNote(res.error ?? 'Could not configure Claude MCP bridge')
                    }
                  })
                  .catch((error) => {
                    setBridgeLaunchNote(error instanceof Error ? error.message : String(error))
                  })
                  .finally(() => setBridgeLaunchBusy(false))
              }}
              title={
                bridgeLaunchBusy
                  ? 'Configuring Claude MCP bridge'
                  : claudeBridgeActive
                    ? 'Claude bridge active'
                    : 'Claude bridge inactive (click to configure)'
              }
              aria-label={
                bridgeLaunchBusy
                  ? 'Configuring Claude MCP bridge'
                  : claudeBridgeActive
                    ? 'Claude bridge active'
                    : 'Claude bridge inactive, click to configure'
              }
            >
              <i
                className={`fa-solid ${
                  bridgeLaunchBusy ? 'fa-spinner fa-spin' : claudeBridgeActive ? 'fa-circle-check' : 'fa-rocket'
                }`}
                aria-hidden
              />
            </button>
          </div>
        </div>
        {bridgeLaunchNote ? <p className="muted" style={{ margin: '8px 0 0' }}>{bridgeLaunchNote}</p> : null}
        <div className="electron-dev-connection-map" role="region" aria-label="Connection state map">
          <div className="electron-dev-connection-head">
            <strong>Connection state</strong>
            <span className="muted">
              {bridgeEnabled && runtimeRunning ? 'Bridge path active' : 'One or more segments are offline'}
            </span>
          </div>
          <div className="electron-dev-connection-line">
            {connectionNodes.map((node, idx) => (
              <div
                key={node.id}
                className={`electron-dev-connection-node state-${node.state}${idx < connectionNodes.length - 1 ? ' has-link' : ''}`}
              >
                <div className="node-dot" aria-hidden />
                <div className="node-label">{node.label}</div>
                <div className="node-detail muted">{node.detail}</div>
              </div>
            ))}
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

        <section className="electron-dev-panel electron-dev-panel--claude-setup" aria-label="Claude Code setup">
          <h2 className="electron-dev-panel-title">Claude Code setup</h2>
          <ol className="electron-dev-setup-steps">
            <li>Start the app bridge (plug icon above) and keep this app running.</li>
            <li>Add the MCP bridge once from a terminal in this repository:</li>
          </ol>
          <div className="electron-dev-setup-snippet">
            <div className="electron-dev-setup-snippet-head">
              <span>Claude MCP add command</span>
              <button
                type="button"
                className="btn-ghost-sm"
                onClick={() => void copyText('Claude MCP add command', claudeMcpAddCommand)}
              >
                Copy
              </button>
            </div>
            <pre className="electron-dev-setup-pre">{claudeMcpAddCommand}</pre>
          </div>
          <p className="muted electron-dev-setup-tip">
            {tokenConfigured
              ? 'Replace YOUR_TOKEN with the token from Integrations settings.'
              : 'Token is optional unless you enabled one in Integrations.'}
          </p>
          <ol className="electron-dev-setup-steps" start={3}>
            <li>Restart Claude Code, then confirm the server:</li>
          </ol>
          <div className="electron-dev-setup-snippet">
            <div className="electron-dev-setup-snippet-head">
              <span>Verify MCP server</span>
              <button type="button" className="btn-ghost-sm" onClick={() => void copyText('Verify command', 'claude mcp list')}>
                Copy
              </button>
            </div>
            <pre className="electron-dev-setup-pre">claude mcp list</pre>
          </div>
          {setupCopyNote ? <p className="muted electron-dev-setup-tip">{setupCopyNote}</p> : null}
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
