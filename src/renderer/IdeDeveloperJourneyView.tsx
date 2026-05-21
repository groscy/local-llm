import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { IdeJourneyChecklist, IntegrationBridgeSelfTestResult } from '@shared/ideJourney'
import type { ClaudeMemoryCaptureStats, PluginIntegrationReport } from '@shared/types'
import { IDE_SETUP_BRIDGE_RAG_NOTE, IDE_SETUP_OTHER_EDITORS } from '@shared/ideSetupQuickReference'

const USER_GUIDE_IDE_ANCHOR =
  'https://github.com/localllm/local-llm-desktop/blob/main/docs/USER-GUIDE.md#developer-journey-intellij'
const INTEGRATION_DOC =
  'https://github.com/localllm/local-llm-desktop/blob/main/docs/intellij-integration.md'

function pluginReportKindLabel(kind: PluginIntegrationReport['kind']): string {
  switch (kind) {
    case 'chat_completed':
      return 'IDE chat'
    case 'chat_failed':
      return 'IDE chat failed'
    case 'apply_completed':
      return 'IDE apply'
    case 'apply_failed':
      return 'IDE apply failed'
    case 'apply_cancelled':
      return 'IDE apply cancelled'
    case 'send_cancelled':
      return 'IDE send cancelled'
    default:
      return kind
  }
}

function formatReportMeta(meta: PluginIntegrationReport['meta']): string {
  if (!meta || Object.keys(meta).length === 0) return ''
  try {
    return JSON.stringify(meta).slice(0, 140) + (JSON.stringify(meta).length > 140 ? '…' : '')
  } catch {
    return ''
  }
}

export type IdeDeveloperJourneyViewProps = {
  checklist: IdeJourneyChecklist
  onChecklistChange: (patch: Partial<IdeJourneyChecklist>) => void
  ideJourneyAutoChecklist: boolean
  onIdeJourneyAutoChecklistChange: (value: boolean) => void
  pluginReports: PluginIntegrationReport[]
  runtimeRunning: boolean
  runtimeKind: string
  bridgeEnabled: boolean
  bridgePort: number
  tokenConfigured: boolean
  onOpenIntegrations: () => void
  onOpenRun: () => void
  onOpenModels: () => void
  onOpenChat: () => void
  onOpenMetrics: () => void
  onPinActivity: () => void
  onOpenWiki: () => void
  onRefreshRuntime: () => void
  /** When false, hides the “Open Chat” shortcut (e.g. Software developer hub). Default true. */
  showOpenChatShortcut?: boolean
}

export function IdeDeveloperJourneyView({
  checklist,
  onChecklistChange,
  ideJourneyAutoChecklist,
  onIdeJourneyAutoChecklistChange,
  pluginReports,
  runtimeRunning,
  runtimeKind,
  bridgeEnabled,
  bridgePort,
  tokenConfigured,
  onOpenIntegrations,
  onOpenRun,
  onOpenModels,
  onOpenChat,
  onOpenMetrics,
  onPinActivity,
  onOpenWiki,
  onRefreshRuntime,
  showOpenChatShortcut = true
}: IdeDeveloperJourneyViewProps): ReactElement {
  const [bridgeTestBusy, setBridgeTestBusy] = useState(false)
  const [smokeBusy, setSmokeBusy] = useState(false)
  const [selfTestResult, setSelfTestResult] = useState<IntegrationBridgeSelfTestResult | null>(null)
  const [memoryStats, setMemoryStats] = useState<ClaudeMemoryCaptureStats | null>(null)
  const prevRuntimeRunning = useRef(runtimeRunning)
  const [showBackendHint, setShowBackendHint] = useState(false)

  useEffect(() => {
    void onRefreshRuntime()
    const id = window.setInterval(() => void onRefreshRuntime(), 5000)
    return () => window.clearInterval(id)
  }, [onRefreshRuntime])

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

  useEffect(() => {
    if (!prevRuntimeRunning.current && runtimeRunning) {
      setShowBackendHint(true)
    }
    prevRuntimeRunning.current = runtimeRunning
  }, [runtimeRunning])

  const runBridgeTest = useCallback(async (smokeChat: boolean) => {
    if (smokeChat) {
      setSmokeBusy(true)
    } else {
      setBridgeTestBusy(true)
    }
    setSelfTestResult(null)
    try {
      const r = await window.api.integrationBridgeSelfTest(smokeChat ? { smokeChat: true } : {})
      setSelfTestResult(r)
    } catch (e) {
      setSelfTestResult({
        ok: false,
        summary: e instanceof Error ? e.message : String(e),
        steps: [{ id: 'error', ok: false, detail: e instanceof Error ? e.message : String(e) }]
      })
    } finally {
      if (smokeChat) {
        setSmokeBusy(false)
      } else {
        setBridgeTestBusy(false)
      }
    }
  }, [])

  const copyBridgeBase = useCallback(() => {
    const url = `http://127.0.0.1:${bridgePort}`
    void navigator.clipboard.writeText(url).catch(() => null)
  }, [bridgePort])

  const copyText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => null)
  }, [])

  const bridgeUrl = `http://127.0.0.1:${bridgePort}`
  const curlHealth = `curl -sS "${bridgeUrl}/health"`
  const curlRuntime = tokenConfigured
    ? `curl -sS -H "Authorization: Bearer YOUR_TOKEN" "${bridgeUrl}/v1/runtime/status"`
    : `curl -sS "${bridgeUrl}/v1/runtime/status"`
  const curlChatExample = `curl -sS -X POST "${bridgeUrl}/v1/chat" \\
  -H "Content-Type: application/json" \\
${tokenConfigured ? `  -H "Authorization: Bearer YOUR_TOKEN" \\\n` : ''}  -d '{"messages":[{"role":"user","content":"Hello"}],"maxTokens":32}'`

  const recentReports = [...pluginReports].reverse().slice(0, 12)
  const hasChatCompleted = pluginReports.some((r) => r.kind === 'chat_completed')
  const lastPluginSeenAt = pluginReports.length > 0 ? pluginReports[pluginReports.length - 1]?.receivedAt : null
  const selfTestBridgeOk = selfTestResult?.steps.find((s) => s.id === 'health')?.ok ?? null

  const connectionNodes: Array<{ id: string; label: string; detail: string; state: 'ok' | 'warn' | 'neutral' }> = [
    {
      id: 'ide-plugin',
      label: 'IDE plugin',
      detail: lastPluginSeenAt
        ? `Last report ${new Date(lastPluginSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'No reports yet',
      state: lastPluginSeenAt ? 'ok' : 'warn'
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

  return (
    <div className="ide-journey ide-journey-layout">
      <nav className="ide-journey-toc" aria-label="IntelliJ plugin journey sections">
        <a href="#ide-journey-status">Status</a>
        <a href="#ide-journey-actions">Actions</a>
        <a href="#ide-journey-api">API</a>
        <a href="#ide-journey-activity">Activity</a>
        <a href="#ide-journey-checklist">Checklist</a>
        <a href="#ide-journey-flow">Flow</a>
        <a href="#ide-journey-troubleshoot">Help</a>
      </nav>

      <div className="ide-journey-columns">
        <div className="ide-journey-col ide-journey-col-main">
          <div className="ide-journey-hero" id="ide-journey-hero">
            <h2 className="ide-journey-title">IntelliJ plugin · bridge</h2>
            <p className="ide-journey-lead muted">
              Use IntelliJ with this app’s local model runtime. The plugin calls the desktop HTTP bridge on the loopback
              interface; knowledge-base RAG stays in Chat / Wiki unless you paste or attach context in the IDE.
            </p>
            <div className="ide-journey-hero-actions">
              <button type="button" className="btn-secondary" onClick={() => void window.api.openExternalUrl(USER_GUIDE_IDE_ANCHOR)}>
                User guide (GitHub)
              </button>
              <button type="button" className="btn-secondary" onClick={() => void window.api.openExternalUrl(INTEGRATION_DOC)}>
                HTTP API reference
              </button>
            </div>
          </div>

          {showBackendHint && !checklist.backendReady ? (
            <div className="ide-journey-hint" role="status">
              <span>Runtime looks up. Mark &quot;backend ready&quot; on your checklist?</span>
              <button type="button" className="btn-secondary btn-sm" onClick={() => onChecklistChange({ backendReady: true })}>
                Mark backend ready
              </button>
              <button type="button" className="btn-ghost-sm" onClick={() => setShowBackendHint(false)}>
                Dismiss
              </button>
            </div>
          ) : null}

          {hasChatCompleted && !checklist.firstIdeChat ? (
            <div className="ide-journey-hint ide-journey-hint--success" role="status">
              <span>We saw a successful IDE chat report. Update your checklist?</span>
              <button type="button" className="btn-secondary btn-sm" onClick={() => onChecklistChange({ firstIdeChat: true })}>
                Mark first IDE chat
              </button>
            </div>
          ) : null}

          <section className="ide-journey-card" id="ide-journey-status" aria-labelledby="ide-journey-status-heading">
            <h3 id="ide-journey-status-heading">Live status</h3>
            <ul className="ide-journey-status-list">
              <li className="ide-journey-status-item">
                <span className={`ide-journey-dot ${runtimeRunning ? 'on' : ''}`} aria-hidden />
                <div>
                  <div className="ide-journey-status-label">Model runtime</div>
                  <div className="muted">
                    {runtimeRunning ? `Running (${runtimeKind || '?'})` : 'Stopped — open Run and start a model'}
                  </div>
                </div>
              </li>
              <li className="ide-journey-status-item">
                <span className={`ide-journey-dot ${bridgeEnabled ? 'on' : ''}`} aria-hidden />
                <div>
                  <div className="ide-journey-status-label">HTTP bridge</div>
                  <div className="muted">
                    {bridgeEnabled ? `Listening on ${bridgeUrl}` : 'Disabled — enable under Integrations'}
                  </div>
                </div>
              </li>
              <li className="ide-journey-status-item">
                <span className="ide-journey-dot neutral" aria-hidden />
                <div>
                  <div className="ide-journey-status-label">Bearer token</div>
                  <div className="muted">{tokenConfigured ? 'Set (match IntelliJ plugin settings)' : 'None (optional)'}</div>
                </div>
              </li>
            </ul>
            <div className="ide-journey-connection-map" role="region" aria-label="Connection state map">
              <div className="ide-journey-connection-head">
                <strong>Connection state</strong>
                <span className="muted">
                  {selfTestBridgeOk == null
                    ? 'Run bridge test for transport diagnostics'
                    : selfTestBridgeOk
                      ? 'Bridge transport verified'
                      : 'Bridge transport failed'}
                </span>
              </div>
              <div className="ide-journey-connection-line">
                {connectionNodes.map((node, idx) => (
                  <div
                    key={node.id}
                    className={`ide-journey-connection-node state-${node.state}${idx < connectionNodes.length - 1 ? ' has-link' : ''}`}
                  >
                    <div className="node-dot" aria-hidden />
                    <div className="node-label">{node.label}</div>
                    <div className="node-detail muted">{node.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="ide-journey-card" id="ide-journey-actions" aria-labelledby="ide-journey-actions-heading">
            <h3 id="ide-journey-actions-heading">Shortcuts</h3>
            <div className="ide-journey-card-actions">
              <button type="button" className="btn-primary" onClick={onOpenRun}>
                Open Run
              </button>
              <button type="button" className="btn-secondary" onClick={onOpenIntegrations}>
                Open Integrations
              </button>
              <button type="button" className="btn-secondary" onClick={onOpenModels}>
                Open Models
              </button>
              {showOpenChatShortcut ? (
                <button type="button" className="btn-secondary" onClick={onOpenChat}>
                  Open Chat
                </button>
              ) : null}
              <button type="button" className="btn-secondary" onClick={onOpenMetrics}>
                Open Metrics
              </button>
              <button type="button" className="btn-secondary" onClick={copyBridgeBase} title="Copy loopback base URL">
                Copy bridge URL
              </button>
              <button type="button" className="btn-secondary" onClick={onPinActivity}>
                Pin Activity widget
              </button>
            </div>
            <div className="ide-journey-card-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn-primary" onClick={() => void runBridgeTest(false)} disabled={bridgeTestBusy}>
                {bridgeTestBusy ? 'Testing…' : 'Test bridge (health + runtime status)'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void runBridgeTest(true)}
                disabled={smokeBusy || !runtimeRunning}
                title={!runtimeRunning ? 'Start the model runtime first' : 'POST /v1/chat with maxTokens 1'}
              >
                {smokeBusy ? 'Smoke…' : 'Smoke test chat'}
              </button>
            </div>
            {selfTestResult ? (
              <div className="ide-journey-selftest" role="region" aria-label="Self test result">
                <p className={`ide-journey-selftest-summary ${selfTestResult.ok ? 'ok' : 'err'}`}>{selfTestResult.summary}</p>
                <ul className="ide-journey-selftest-steps">
                  {selfTestResult.steps.map((s) => (
                    <li key={s.id} className={s.ok ? 'ok' : 'fail'}>
                      <strong>{s.id}</strong> — {s.detail}
                    </li>
                  ))}
                </ul>
                {selfTestResult.smokeChat ? (
                  <p className={`ide-journey-smoke ${selfTestResult.smokeChat.ok ? 'ok' : 'err'}`}>
                    <strong>Smoke chat:</strong> {selfTestResult.smokeChat.detail}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="ide-journey-card" id="ide-journey-api" aria-labelledby="ide-journey-api-heading">
            <h3 id="ide-journey-api-heading">Copy for debugging</h3>
            <p className="muted ide-journey-check-hint">
              Replace <code className="inline-code">YOUR_TOKEN</code> with the token from Integrations when set.
            </p>
            <div className="ide-journey-snippet">
              <div className="ide-journey-snippet-head">
                <span>GET /health</span>
                <button type="button" className="btn-ghost-sm" onClick={() => copyText(curlHealth)}>
                  Copy
                </button>
              </div>
              <pre className="ide-journey-pre">{curlHealth}</pre>
            </div>
            <div className="ide-journey-snippet">
              <div className="ide-journey-snippet-head">
                <span>GET /v1/runtime/status</span>
                <button type="button" className="btn-ghost-sm" onClick={() => copyText(curlRuntime)}>
                  Copy
                </button>
              </div>
              <pre className="ide-journey-pre">{curlRuntime}</pre>
            </div>
            <div className="ide-journey-snippet">
              <div className="ide-journey-snippet-head">
                <span>POST /v1/chat (minimal)</span>
                <button type="button" className="btn-ghost-sm" onClick={() => copyText(curlChatExample)}>
                  Copy
                </button>
              </div>
              <pre className="ide-journey-pre">{curlChatExample}</pre>
            </div>
          </section>

          <section className="ide-journey-card" id="ide-journey-activity" aria-labelledby="ide-journey-activity-heading">
            <h3 id="ide-journey-activity-heading">Recent IDE plugin activity</h3>
            {recentReports.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No reports yet. Enable the bridge, use the IntelliJ tool window, and optionally pin Activity for a live feed.
              </p>
            ) : (
              <ul className="ide-journey-report-list">
                {recentReports.map((r, i) => (
                  <li key={`${r.receivedAt}-${i}`}>
                    <span className="ide-journey-report-kind">{pluginReportKindLabel(r.kind)}</span>
                    <span className="muted ide-journey-report-time">
                      {new Date(r.receivedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    {r.message ? <div className="ide-journey-report-msg">{r.message}</div> : null}
                    {formatReportMeta(r.meta) ? (
                      <div className="muted ide-journey-report-meta">{formatReportMeta(r.meta)}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="ide-journey-col ide-journey-col-side">
          <section className="ide-journey-card" id="ide-journey-checklist" aria-labelledby="ide-journey-check-heading">
            <h3 id="ide-journey-check-heading">Your checklist</h3>
            <p className="muted ide-journey-check-hint">Mark steps as you complete them (saved on this device).</p>
            <label className="ide-journey-check-row ide-journey-auto-row">
              <input
                type="checkbox"
                checked={ideJourneyAutoChecklist}
                onChange={(e) => onIdeJourneyAutoChecklistChange(e.target.checked)}
              />
              <span>
                <strong>Auto-mark</strong> “first IDE chat” when the app receives a successful <code className="inline-code">chat_completed</code> report
                from the plugin
              </span>
            </label>
            <ul className="ide-journey-checklist">
              {(
                [
                  ['backendReady', 'Ollama or llama.cpp is installed; I can start a model from Run'],
                  ['pluginInstalled', 'IntelliJ plugin installed from integrations/intellij-plugin (buildPlugin ZIP)'],
                  ['intellijConfigured', 'Plugin port (and token, if any) matches this app’s Integrations settings'],
                  ['firstIdeChat', 'Sent at least one prompt from the IDE tool window successfully']
                ] as const
              ).map(([key, label]) => (
                <li key={key}>
                  <label className="ide-journey-check-row">
                    <input
                      type="checkbox"
                      checked={checklist[key]}
                      onChange={(e) => onChecklistChange({ [key]: e.target.checked })}
                    />
                    <span>{label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <details className="ide-journey-details" id="ide-journey-flow">
            <summary>Flow and features</summary>
            <ol className="ide-journey-steps">
              <li>
                <strong>One-time</strong> — Install the sample plugin; set models folder and (optional) Hugging Face token in
                this app.
              </li>
              <li>
                <strong>Each session</strong> — Start the runtime here, enable the IDE bridge, match IntelliJ under{' '}
                <em>Settings → Tools → Local LLM Desktop</em>.
              </li>
              <li>
                <strong>Work</strong> — Local LLM tool window: optional <strong>codebase graph</strong> (Java PSI; Kotlin uses
                text heuristics for K2 compatibility). Large projects may be truncated.
              </li>
              <li>
                <strong>Inline completion</strong> — Gray suggestions use a small <code className="inline-code">maxTokens</code>{' '}
                budget per request.
              </li>
              <li>
                <strong>Patches</strong> — Model may emit <code className="inline-code">LOCAL_LLM_PATCH</code> or{' '}
                <code className="inline-code">LOCAL_LLM_FILE</code> blocks; you confirm before files are written.
              </li>
              <li>
                <strong>Clarify</strong> — Replies starting with <code className="inline-code">[CLARIFY]</code> open numbered
                follow-up dialogs in the plugin.
              </li>
              <li>
                <strong>Weights</strong> — <strong>llama-server</strong> needs <strong>GGUF</strong>; Safetensors may require
                conversion (Settings → AI engine). Use Run to pick the active model.
              </li>
              <li>
                <strong>Domain vocabulary</strong> — Plugin <em>Vocabulary…</em> for code terms; ingest glossaries into{' '}
                <button type="button" className="btn-link-inline" onClick={onOpenWiki}>
                  Knowledge wiki
                </button>{' '}
                and paste distilled notes into the IDE when needed.
              </li>
            </ol>
          </details>

          <details className="ide-journey-details" id="ide-journey-troubleshoot">
            <summary>If something fails</summary>
            <ul className="muted ide-journey-bullets">
              <li>
                <strong>503 / runtime not started</strong> — The bridge does not start the model; use Run first.
              </li>
              <li>
                <strong>401</strong> — Bearer token mismatch between this app and IntelliJ (or missing on client).
              </li>
              <li>
                <strong>Disconnected in the plugin</strong> — App closed, bridge off, or wrong port; use Test bridge above.
              </li>
              <li>
                <strong>Bridge OK, model not running</strong> — Matches plugin strip: start the runtime in this app.
              </li>
            </ul>
          </details>

          <details className="ide-journey-details">
            <summary>In-app reference (offline)</summary>
            <p className="muted ide-journey-inset">{IDE_SETUP_BRIDGE_RAG_NOTE}</p>
            <pre className="ide-journey-pre ide-journey-pre--tall">{IDE_SETUP_OTHER_EDITORS}</pre>
          </details>
        </div>
      </div>
    </div>
  )
}
