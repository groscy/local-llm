import { useCallback, useEffect, useState } from 'react'
import type {
  CodebaseFormalBundle,
  CodebaseRecord,
  FormalToolProfile,
  FormalVerificationProgressPayload,
  FormalVerificationRun
} from '@shared/codebaseRegistry'

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

export function CodebaseFormalSettingsSection(): React.ReactElement {
  const [bundle, setBundle] = useState<CodebaseFormalBundle | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [manualLabel, setManualLabel] = useState('')
  const [profileLabel, setProfileLabel] = useState('Formal tool')
  const [profileCmd, setProfileCmd] = useState('echo "Replace with your verifier; {{root}} is the codebase directory."')
  const [profileSpawn, setProfileSpawn] = useState<'shell' | 'exec'>(() =>
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'shell' : 'exec'
  )
  const [profileTimeout, setProfileTimeout] = useState(String(300_000))
  const [runCodebaseId, setRunCodebaseId] = useState('')
  const [runProfileId, setRunProfileId] = useState('')
  const [runBusy, setRunBusy] = useState(false)
  const [liveRun, setLiveRun] = useState<FormalVerificationRun | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [interpretGlobal, setInterpretGlobal] = useState(false)
  const [interpretIncludeKb, setInterpretIncludeKb] = useState(false)
  const [profileInterpretLlm, setProfileInterpretLlm] = useState(false)

  useEffect(() => {
    void window.api.getConfig().then((c) => {
      setInterpretGlobal(c.formalVerificationInterpretWithLlm === true)
      setInterpretIncludeKb(c.formalVerificationInterpretIncludeKb === true)
    })
  }, [])

  const refresh = useCallback(async () => {
    setLoadErr(null)
    try {
      const b = await window.api.codebaseFormalGet()
      setBundle(b)
      setRunCodebaseId((prev) => prev || b.codebases[0]?.id || '')
      setRunProfileId((prev) => prev || b.formalToolProfiles[0]?.id || '')
    } catch (e) {
      setLoadErr(String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const off = window.api.onCodebaseFormalVerificationProgress((p: FormalVerificationProgressPayload) => {
      if (p.phase === 'started' || p.phase === 'finished') {
        if (p.run) setLiveRun(p.run)
        if (p.phase === 'finished') {
          setRunBusy(false)
          void window.api.codebaseFormalGet().then(setBundle).catch(() => {})
        }
      }
    })
    return off
  }, [])

  const pickAndAdd = useCallback(async () => {
    setActionMsg(null)
    const root = await window.api.codebaseFormalPickRoot()
    if (!root) return
    const r = await window.api.codebaseFormalAdd({
      rootPath: root,
      displayName: manualLabel.trim() || undefined
    })
    if (!r.ok) {
      setActionMsg(r.error)
      return
    }
    setManualLabel('')
    await refresh()
  }, [manualLabel, refresh])

  const removeCodebase = useCallback(
    async (id: string, label: string) => {
      const ok = await window.api.confirmDestructive({
        message: `Remove codebase “${label}” from this list?`,
        detail: 'Formal verification history for this codebase will be removed.',
        confirmLabel: 'Remove'
      })
      if (!ok) return
      const r = await window.api.codebaseFormalRemove(id)
      setActionMsg(r.ok ? null : r.error)
      await refresh()
    },
    [refresh]
  )

  const toggleDisabled = useCallback(
    async (c: CodebaseRecord) => {
      const r = await window.api.codebaseFormalUpdate({ id: c.id, disabled: !c.disabled })
      setActionMsg(r.ok ? null : r.error)
      await refresh()
    },
    [refresh]
  )

  const addProfile = useCallback(async () => {
    setActionMsg(null)
    const timeoutMs = Math.min(
      3_600_000,
      Math.max(1000, parseInt(profileTimeout.trim(), 10) || 300_000)
    )
    const r = await window.api.codebaseFormalProfileAdd({
      label: profileLabel.trim() || 'Profile',
      commandTemplate: profileCmd,
      spawnMode: profileSpawn,
      timeoutMs,
      ...(profileInterpretLlm ? { interpretWithLlm: true } : {})
    })
    if (!r.ok) {
      setActionMsg(r.error)
      return
    }
    setRunProfileId(r.profile.id)
    await refresh()
  }, [profileCmd, profileInterpretLlm, profileLabel, profileSpawn, profileTimeout, refresh])

  const removeProfile = useCallback(
    async (id: string) => {
      const r = await window.api.codebaseFormalProfileRemove(id)
      setActionMsg(r.ok ? null : r.error)
      await refresh()
    },
    [refresh]
  )

  const startRun = useCallback(async () => {
    setActionMsg(null)
    if (!runCodebaseId || !runProfileId) {
      setActionMsg('Select a codebase and a formal tool profile.')
      return
    }
    setRunBusy(true)
    setLiveRun(null)
    const r = await window.api.codebaseFormalRunStart({ codebaseId: runCodebaseId, profileId: runProfileId })
    if (!r.ok) {
      setRunBusy(false)
      setActionMsg(r.error)
    }
  }, [runCodebaseId, runProfileId])

  const exportRun = useCallback(async (runId: string) => {
    const r = await window.api.codebaseFormalRunExportJson(runId)
    if (!r.ok) {
      setActionMsg(r.error)
      return
    }
    try {
      await navigator.clipboard.writeText(r.json)
      setActionMsg('Run export copied to clipboard (JSON).')
    } catch {
      setActionMsg('Could not copy to clipboard (browser permission). Retry or copy the JSON from another machine export tool.')
    }
  }, [])

  if (loadErr) {
    return (
      <div className="drawer-section">
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
      <div className="drawer-section">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  const runs = [...bundle.formalVerificationRuns].sort((a, b) => b.startedAt - a.startedAt)

  return (
    <div className="drawer-section">
      <h3 className="settings-section-title">
        <i className="fa-solid fa-folder-tree" aria-hidden />
        Codebases and formal verification
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Register implementation roots you assess in this workspace. Use the sidebar <strong>Codebases</strong> view for a full-screen landscape of every tree
        and its validation history. Paths detected from the IntelliJ plugin appear here automatically when the plugin sends{' '}
        <code className="inline-code">projectBasePath</code>. Formal verification runs <strong>your</strong> installed tools (model checkers, Dafny, test of a
        proof script, etc.): the app records exit codes and logs as <strong>bounded</strong>, tool-backed evidence — not a universal mathematical correctness
        proof for arbitrary programs.
      </p>
      {actionMsg ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {actionMsg}
        </p>
      ) : null}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <h4 className="settings-section-title" style={{ fontSize: '0.95rem', marginTop: 0 }}>
          Local model interpretation (advisory)
        </h4>
        <p className="muted" style={{ marginTop: 0 }}>
          After each formal run completes, optionally ask the loaded local model to summarize logs. This does <strong>not</strong> replace the external tool
          verdict. Enable the model under <strong>Run</strong> first.
        </p>
        <label className="metrics-widget-check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={interpretGlobal}
            onChange={(e) => {
              const v = e.target.checked
              setInterpretGlobal(v)
              void window.api.setConfig({ formalVerificationInterpretWithLlm: v })
            }}
          />
          <span>Auto-interpret new runs (workspace default)</span>
        </label>
        <label className="metrics-widget-check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={interpretIncludeKb}
            onChange={(e) => {
              const v = e.target.checked
              setInterpretIncludeKb(v)
              void window.api.setConfig({ formalVerificationInterpretIncludeKb: v })
            }}
          />
          <span>When auto-interpreting, include KB snippets and a bounded repo scan in the prompt (opt-in)</span>
        </label>
      </div>

      <h4 className="settings-section-title" style={{ fontSize: '0.95rem', marginTop: 16 }}>
        Registered codebases
      </h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input
          className="input"
          style={{ minWidth: 200, maxWidth: 280 }}
          placeholder="Optional display name"
          value={manualLabel}
          onChange={(e) => setManualLabel(e.target.value)}
        />
        <button type="button" className="btn-secondary settings-btn-icon" onClick={() => void pickAndAdd()}>
          <i className="fa-solid fa-folder-plus" aria-hidden />
          Add folder…
        </button>
        <button type="button" className="btn-secondary settings-btn-icon" onClick={() => void refresh()}>
          <i className="fa-solid fa-rotate" aria-hidden />
          Refresh
        </button>
      </div>
      {bundle.codebases.length === 0 ? (
        <p className="muted" style={{ marginTop: 10 }}>
          No codebases yet. Add a folder or open a project in IntelliJ with the bridge enabled.
        </p>
      ) : (
        <table className="settings-table" style={{ marginTop: 12, width: '100%', fontSize: '0.9rem' }}>
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">Origin</th>
              <th scope="col">Last seen</th>
              <th scope="col"> </th>
            </tr>
          </thead>
          <tbody>
            {bundle.codebases.map((c) => (
              <tr key={c.id}>
                <td>
                  <code className="inline-code" style={{ wordBreak: 'break-all' }}>
                    {c.rootPath}
                  </code>
                  {c.displayName ? (
                    <div className="muted" style={{ marginTop: 4 }}>
                      {c.displayName}
                      {c.disabled ? ' · disabled' : ''}
                    </div>
                  ) : null}
                </td>
                <td>{originLabel(c.origin)}</td>
                <td>{new Date(c.lastSeenAt).toLocaleString()}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    className="btn-secondary settings-btn-icon"
                    title="Reveal in file manager"
                    onClick={() => void window.api.openPathInExplorer(c.rootPath)}
                  >
                    <i className="fa-solid fa-folder-open" aria-hidden />
                  </button>{' '}
                  <button
                    type="button"
                    className="btn-secondary settings-btn-icon"
                    onClick={() => void toggleDisabled(c)}
                  >
                    {c.disabled ? 'Enable' : 'Disable'}
                  </button>{' '}
                  <button
                    type="button"
                    className="btn-secondary settings-btn-icon"
                    onClick={() => void removeCodebase(c.id, c.displayName || c.rootPath)}
                  >
                    <i className="fa-solid fa-trash" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="settings-section-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>
        Formal tool profiles
      </h4>
      <p className="muted" style={{ marginTop: 0 }}>
        Examples (you must install the tool and adapt paths): TLA+ <code className="inline-code">tlc -workers auto Model.tla</code>, Dafny{' '}
        <code className="inline-code">dafny verify MyFile.dfy</code>. Use <code className="inline-code">{'{{root}}'}</code> for the codebase directory.
      </p>
      <label style={{ display: 'block', marginTop: 8 }}>
        <span className="muted" style={{ display: 'block', marginBottom: 4 }}>
          Label
        </span>
        <input className="input" style={{ width: '100%', maxWidth: 360 }} value={profileLabel} onChange={(e) => setProfileLabel(e.target.value)} />
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>
        <span className="muted" style={{ display: 'block', marginBottom: 4 }}>
          Command template
        </span>
        <textarea
          className="input"
          rows={3}
          style={{ width: '100%', maxWidth: 560, fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem' }}
          value={profileCmd}
          onChange={(e) => setProfileCmd(e.target.value)}
        />
      </label>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 8, alignItems: 'center' }}>
        <label>
          <span className="muted" style={{ marginRight: 8 }}>
            Spawn
          </span>
          <select className="input" value={profileSpawn} onChange={(e) => setProfileSpawn(e.target.value as 'shell' | 'exec')}>
            <option value="shell">Shell (cmd / sh -c)</option>
            <option value="exec">Argv (Unix only; Windows uses shell)</option>
          </select>
        </label>
        <label>
          <span className="muted" style={{ marginRight: 8 }}>
            Timeout ms
          </span>
          <input
            className="input"
            style={{ width: 120 }}
            inputMode="numeric"
            value={profileTimeout}
            onChange={(e) => setProfileTimeout(e.target.value)}
          />
        </label>
        <label className="metrics-widget-check" style={{ alignSelf: 'center' }}>
          <input type="checkbox" checked={profileInterpretLlm} onChange={(e) => setProfileInterpretLlm(e.target.checked)} />
          <span>Always interpret for this profile</span>
        </label>
        <button type="button" className="btn-primary settings-btn-icon" onClick={() => void addProfile()}>
          <i className="fa-solid fa-plus" aria-hidden />
          Save profile
        </button>
      </div>
      {bundle.formalToolProfiles.length > 0 ? (
        <ul className="muted" style={{ marginTop: 10, paddingLeft: 18 }}>
          {bundle.formalToolProfiles.map((p: FormalToolProfile) => (
            <li key={p.id} style={{ marginBottom: 10 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{p.label}</strong>
              <span style={{ marginLeft: 8 }}>{p.spawnMode}</span>
              <select
                className="input"
                style={{ marginLeft: 8, maxWidth: 220, fontSize: '0.85rem' }}
                value={p.interpretWithLlm === true ? 'on' : p.interpretWithLlm === false ? 'off' : 'inherit'}
                onChange={(e) => {
                  const interpretWithLlm = e.target.value as 'inherit' | 'on' | 'off'
                  void window.api.codebaseFormalProfileUpdate({ id: p.id, interpretWithLlm }).then((r) => {
                    if (!r.ok) setActionMsg(r.error)
                    else void refresh()
                  })
                }}
              >
                <option value="inherit">LLM: workspace default</option>
                <option value="on">LLM: always</option>
                <option value="off">LLM: never</option>
              </select>
              <button
                type="button"
                className="btn-secondary settings-btn-icon"
                style={{ marginLeft: 8 }}
                onClick={() => void removeProfile(p.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <h4 className="settings-section-title" style={{ fontSize: '0.95rem', marginTop: 20 }}>
        Run formal verification
      </h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select className="input" value={runCodebaseId} onChange={(e) => setRunCodebaseId(e.target.value)}>
          <option value="">Codebase…</option>
          {bundle.codebases
            .filter((c) => !c.disabled)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName || c.rootPath}
              </option>
            ))}
        </select>
        <select className="input" value={runProfileId} onChange={(e) => setRunProfileId(e.target.value)}>
          <option value="">Profile…</option>
          {bundle.formalToolProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary settings-btn-icon" disabled={runBusy} onClick={() => void startRun()}>
          <i className="fa-solid fa-play" aria-hidden />
          {runBusy ? 'Running…' : 'Start run'}
        </button>
      </div>

      {liveRun ? (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 6px' }}>
            <strong>{statusLabel(liveRun.status)}</strong>
            {liveRun.exitCode != null ? (
              <span className="muted" style={{ marginLeft: 8 }}>
                exit {liveRun.exitCode}
              </span>
            ) : null}
          </p>
          <p className="muted" style={{ margin: '0 0 4px', fontSize: '0.85rem', wordBreak: 'break-all' }}>
            <code className="inline-code">{liveRun.commandResolved}</code>
          </p>
          {liveRun.stdout ? (
            <pre className="code-block" style={{ maxHeight: 160, overflow: 'auto', fontSize: '0.8rem' }}>
              {liveRun.stdout}
            </pre>
          ) : null}
          {liveRun.stderr ? (
            <pre className="code-block" style={{ maxHeight: 120, overflow: 'auto', fontSize: '0.8rem' }}>
              {liveRun.stderr}
            </pre>
          ) : null}
          {liveRun.llmAdvisoryError ? (
            <p className="runtime-status-error" style={{ marginTop: 8 }} role="alert">
              Model interpretation: {liveRun.llmAdvisoryError}
            </p>
          ) : null}
          {liveRun.llmAdvisory ? (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.82rem' }}>
                {liveRun.llmAdvisory.disclaimer}
              </p>
              <pre className="code-block" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>
                {liveRun.llmAdvisory.text}
              </pre>
            </div>
          ) : null}
          {liveRun.status !== 'running' ? (
            <button type="button" className="btn-secondary settings-btn-icon" style={{ marginTop: 8 }} onClick={() => void exportRun(liveRun.id)}>
              <i className="fa-solid fa-copy" aria-hidden />
              Copy run JSON
            </button>
          ) : null}
        </div>
      ) : null}

      <h4 className="settings-section-title" style={{ fontSize: '0.95rem', marginTop: 18 }}>
        Recent runs
      </h4>
      {runs.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          No runs yet.
        </p>
      ) : (
        <ul className="settings-plugin-report-list muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {runs.slice(0, 12).map((r) => (
            <li key={r.id} style={{ marginBottom: 8 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{statusLabel(r.status)}</strong>
              <span style={{ marginLeft: 8 }}>{new Date(r.startedAt).toLocaleString()}</span>
              <button type="button" className="btn-secondary settings-btn-icon" style={{ marginLeft: 8 }} onClick={() => void exportRun(r.id)}>
                JSON
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
