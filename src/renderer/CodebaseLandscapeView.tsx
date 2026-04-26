import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type {
  CodebaseFormalBundle,
  CodebaseRecord,
  FormalVerificationProgressPayload,
  FormalVerificationRun
} from '@shared/codebaseRegistry'
import type { CodebaseWikiAnalysisProgress } from '@shared/types'

function originLabel(o: CodebaseRecord['origin']): string {
  return o === 'manual' ? 'Manual' : 'IntelliJ'
}

function statusLabel(s: FormalVerificationRun['status']): string {
  switch (s) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'timeout':
      return 'Timed out'
    default:
      return s
  }
}

function statusClass(s: FormalVerificationRun['status']): string {
  if (s === 'succeeded') return 'codebase-landscape-run-status--ok'
  if (s === 'running' || s === 'queued') return 'codebase-landscape-run-status--pending'
  return 'codebase-landscape-run-status--bad'
}

export type CodebaseLandscapeViewProps = {
  onOpenIntegrations: () => void
  onEnrichmentComplete?: () => void
}

export function CodebaseLandscapeView(props: CodebaseLandscapeViewProps): ReactElement {
  const [bundle, setBundle] = useState<CodebaseFormalBundle | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [interpretBusyRunId, setInterpretBusyRunId] = useState<string | null>(null)
  const [manualInterpretIncludeContext, setManualInterpretIncludeContext] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [analyzeBusyCodebaseId, setAnalyzeBusyCodebaseId] = useState<string | null>(null)
  const [analysisProgressMsg, setAnalysisProgressMsg] = useState<string | null>(null)
  const [analysisProgressLog, setAnalysisProgressLog] = useState<
    Array<{ phase: string; message: string; at: number }>
  >([])
  const onEnrichmentComplete = props.onEnrichmentComplete

  const refresh = useCallback(async () => {
    setLoadErr(null)
    setRefreshing(true)
    try {
      const b = await window.api.codebaseFormalGet()
      setBundle(b)
    } catch (e) {
      setLoadErr(String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.api.onCodebaseFormalVerificationProgress((p: FormalVerificationProgressPayload) => {
      if (p.phase === 'finished' || (p.phase === 'started' && p.run)) {
        void window.api.codebaseFormalGet().then(setBundle).catch(() => {})
      }
    })
    return off
  }, [])

  useEffect(() => {
    const off = window.api.onCodebaseWikiAnalysisProgress((p: CodebaseWikiAnalysisProgress) => {
      setAnalysisProgressMsg(p.message)
      setAnalysisProgressLog((prev) => [...prev, { phase: p.phase, message: p.message, at: Date.now() }].slice(-14))
      if (p.phase === 'done' || p.phase === 'error') {
        setAnalyzeBusyCodebaseId(null)
      }
    })
    return off
  }, [])

  const profileLabel = useCallback(
    (profileId: string) => bundle?.formalToolProfiles.find((x) => x.id === profileId)?.label ?? profileId.slice(0, 8),
    [bundle]
  )

  const runsByCodebase = useMemo(() => {
    const m = new Map<string, FormalVerificationRun[]>()
    for (const r of bundle?.formalVerificationRuns ?? []) {
      const list = m.get(r.codebaseId) ?? []
      list.push(r)
      m.set(r.codebaseId, list)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => b.startedAt - a.startedAt)
    }
    return m
  }, [bundle])

  const sortedCodebases = useMemo(() => {
    const list = [...(bundle?.codebases ?? [])]
    list.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return list
  }, [bundle])

  const addFolder = useCallback(async () => {
    setToast(null)
    const root = await window.api.codebaseFormalPickRoot()
    if (!root) return
    const r = await window.api.codebaseFormalAdd({ rootPath: root })
    if (!r.ok) {
      setToast(r.error)
      return
    }
    setToast('Codebase added.')
    await refresh()
  }, [refresh])

  const addByGit = useCallback(async () => {
    const url = gitUrl.trim()
    if (!url) {
      setToast('Enter a git URL first.')
      return
    }
    const r = await window.api.codebaseFormalAddGit({ gitUrl: url })
    if (!r.ok) {
      setToast(r.error)
      return
    }
    setGitUrl('')
    setToast('Repository cloned and added.')
    await refresh()
  }, [gitUrl, refresh])

  const analyzeCodebase = useCallback(
    async (codebaseId: string) => {
      setAnalyzeBusyCodebaseId(codebaseId)
      setAnalysisProgressMsg('Starting scan…')
      setAnalysisProgressLog([{ phase: 'start', message: 'Scan requested from codebase landscape.', at: Date.now() }])
      const r = await window.api.codebaseWikiAnalyze({ codebaseId })
      if (!r.ok) {
        setToast(r.error)
        setAnalyzeBusyCodebaseId(null)
        return
      }
      setToast('Codebase analysis saved to wiki and graph.')
      onEnrichmentComplete?.()
      await refresh()
    },
    [onEnrichmentComplete, refresh]
  )

  const interpretRun = useCallback(
    async (runId: string) => {
      setToast(null)
      setInterpretBusyRunId(runId)
      try {
        const r = await window.api.codebaseFormalInterpretRun({
          runId,
          includeContext: manualInterpretIncludeContext
        })
        if (!r.ok) {
          setToast(r.error)
          return
        }
        setToast('Model summary attached to this run (advisory).')
        setBundle(await window.api.codebaseFormalGet())
      } finally {
        setInterpretBusyRunId(null)
      }
    },
    [manualInterpretIncludeContext]
  )

  const exportRunJson = useCallback(async (runId: string) => {
    setToast(null)
    const r = await window.api.codebaseFormalRunExportJson(runId)
    if (!r.ok) {
      setToast(r.error)
      return
    }
    try {
      await navigator.clipboard.writeText(r.json)
      setToast('Run JSON copied to clipboard.')
    } catch {
      setToast('Could not copy to clipboard.')
    }
  }, [])

  if (loadErr) {
    return (
      <div className="codebase-landscape-view">
        <p className="runtime-status-error" role="alert">
          {loadErr}
        </p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="codebase-landscape-view">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="codebase-landscape-view">
      <header className="codebase-landscape-header">
        <div>
          <h1 className="codebase-landscape-title">Codebase landscape</h1>
          <p className="muted codebase-landscape-lead">
            Registered roots from manual picks and the IntelliJ bridge, with formal verification runs grouped under each tree.
            Configure tool profiles and start runs under Settings → Integrations. Expand a finished run to summarize logs with the local model — advisory only;
            it does not replace the external tool verdict.
          </p>
        </div>
        <div className="codebase-landscape-toolbar row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn-secondary settings-btn-icon"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <i className="fa-solid fa-rotate" aria-hidden />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="btn-secondary settings-btn-icon" onClick={() => void addFolder()}>
            <i className="fa-solid fa-folder-plus" aria-hidden />
            Add folder…
          </button>
          <input
            className="input"
            style={{ minWidth: 260, maxWidth: 420 }}
            placeholder="Git URL (https://... or git@...)"
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
          />
          <button type="button" className="btn-secondary settings-btn-icon" onClick={() => void addByGit()}>
            <i className="fa-brands fa-git-alt" aria-hidden />
            Clone and add
          </button>
          <button type="button" className="btn-primary settings-btn-icon" onClick={() => props.onOpenIntegrations()}>
            <i className="fa-solid fa-sliders" aria-hidden />
            Integration settings…
          </button>
        </div>
      </header>

      {toast ? (
        <p className="muted" style={{ marginTop: 0 }}>
          {toast}
        </p>
      ) : null}
      {analysisProgressMsg ? (
        <p className="muted" style={{ marginTop: 0 }}>
          {analysisProgressMsg}
        </p>
      ) : null}
      {analysisProgressLog.length > 0 ? (
        <details style={{ marginTop: 0 }}>
          <summary className="muted">Analysis progress details</summary>
          <ul className="muted" style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, fontSize: '0.9rem' }}>
            {analysisProgressLog.map((x, i) => (
              <li key={`${x.at}-${i}`}>
                [{x.phase}] {x.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sortedCodebases.length === 0 ? (
        <section className="drawer-section codebase-landscape-empty">
          <p className="muted" style={{ marginTop: 0 }}>
            No codebases in this workspace yet. Use <strong>Add folder…</strong>, or open a project in IntelliJ with the
            desktop HTTP bridge enabled so paths are reported automatically.
          </p>
        </section>
      ) : (
        <div className="codebase-landscape-grid">
          {sortedCodebases.map((c) => {
            const runs = runsByCodebase.get(c.id) ?? []
            return (
              <article key={c.id} className={`codebase-landscape-card${c.disabled ? ' codebase-landscape-card--disabled' : ''}`}>
                <div className="codebase-landscape-card-head">
                  <div>
                    <h2 className="codebase-landscape-card-title">{c.displayName || c.rootPath}</h2>
                    <p className="muted codebase-landscape-card-meta">
                      <span className="codebase-landscape-pill">{originLabel(c.origin)}</span>
                      {c.disabled ? <span className="codebase-landscape-pill">Disabled</span> : null}
                      <span className="codebase-landscape-pill">Last seen {new Date(c.lastSeenAt).toLocaleString()}</span>
                    </p>
                    <code className="inline-code codebase-landscape-path">{c.rootPath}</code>
                    {c.linkedIdeProjectName && c.displayName ? (
                      <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.9rem' }}>
                        IDE project: {c.linkedIdeProjectName}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary settings-btn-icon"
                    title="Reveal in file manager"
                    onClick={() => void window.api.openPathInExplorer(c.rootPath)}
                  >
                    <i className="fa-solid fa-folder-open" aria-hidden />
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn-secondary settings-btn-icon"
                    disabled={analyzeBusyCodebaseId === c.id}
                    onClick={() => void analyzeCodebase(c.id)}
                  >
                    <i className="fa-solid fa-diagram-project" aria-hidden />
                    {analyzeBusyCodebaseId === c.id ? 'Scanning…' : 'Scan+wiki'}
                  </button>
                </div>

                <section className="codebase-landscape-runs" aria-labelledby={`runs-${c.id}`}>
                  <h3 id={`runs-${c.id}`} className="codebase-landscape-runs-heading">
                    Formal verification runs ({runs.length})
                  </h3>
                  {runs.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      No runs recorded for this codebase yet.
                    </p>
                  ) : (
                    <ul className="codebase-landscape-run-list">
                      {runs.map((r) => {
                        const open = expandedRunId === r.id
                        return (
                          <li key={r.id} className="codebase-landscape-run-item">
                            <button
                              type="button"
                              className="codebase-landscape-run-summary"
                              onClick={() => setExpandedRunId(open ? null : r.id)}
                              aria-expanded={open}
                            >
                              <span className={`codebase-landscape-run-status ${statusClass(r.status)}`}>
                                {statusLabel(r.status)}
                              </span>
                              <span className="codebase-landscape-run-date">{new Date(r.startedAt).toLocaleString()}</span>
                              <span className="muted codebase-landscape-run-profile">{profileLabel(r.profileId)}</span>
                              {r.exitCode != null ? (
                                <span className="muted codebase-landscape-run-exit">exit {r.exitCode}</span>
                              ) : null}
                              <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} aria-hidden style={{ marginLeft: 'auto', opacity: 0.5 }} />
                            </button>
                            {open ? (
                              <div className="codebase-landscape-run-detail">
                                <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                                  <code className="inline-code">{r.commandResolved}</code>
                                </p>
                                {r.stdout ? (
                                  <pre className="code-block codebase-landscape-log" tabIndex={0}>
                                    {r.stdout}
                                  </pre>
                                ) : null}
                                {r.stderr ? (
                                  <pre className="code-block codebase-landscape-log codebase-landscape-log--err" tabIndex={0}>
                                    {r.stderr}
                                  </pre>
                                ) : null}
                                {r.llmAdvisoryError ? (
                                  <p className="runtime-status-error" style={{ marginTop: 8 }} role="alert">
                                    Model interpretation: {r.llmAdvisoryError}
                                  </p>
                                ) : null}
                                {r.llmAdvisory ? (
                                  <div style={{ marginTop: 10 }}>
                                    <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.82rem' }}>
                                      {r.llmAdvisory.disclaimer}
                                    </p>
                                    <pre
                                      className="code-block codebase-landscape-log"
                                      style={{ whiteSpace: 'pre-wrap' }}
                                      tabIndex={0}
                                    >
                                      {r.llmAdvisory.text}
                                    </pre>
                                  </div>
                                ) : null}
                                {r.status !== 'running' ? (
                                  <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
                                    <label className="metrics-widget-check" style={{ margin: 0 }}>
                                      <input
                                        type="checkbox"
                                        checked={manualInterpretIncludeContext}
                                        onChange={(e) => setManualInterpretIncludeContext(e.target.checked)}
                                      />
                                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                                        Include KB + bounded repo scan in prompt
                                      </span>
                                    </label>
                                    <button
                                      type="button"
                                      className="btn-secondary settings-btn-icon"
                                      disabled={interpretBusyRunId === r.id}
                                      onClick={() => void interpretRun(r.id)}
                                    >
                                      <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                                      {interpretBusyRunId === r.id ? 'Summarizing…' : 'Summarize with local model'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary settings-btn-icon"
                                      onClick={() => void exportRunJson(r.id)}
                                    >
                                      <i className="fa-solid fa-copy" aria-hidden />
                                      Copy run JSON
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
