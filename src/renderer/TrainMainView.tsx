import type { Dispatch, ReactElement, SetStateAction } from 'react'
import type { KbSource, TrainJob } from '@shared/types'

export type TrainMainViewProps = {
  trainJobs: TrainJob[]
  trainKbSources: KbSource[]
  trainKbSelected: Record<string, boolean>
  setTrainKbSelected: Dispatch<SetStateAction<Record<string, boolean>>>
  trainBase: string
  setTrainBase: (v: string) => void
  trainDisplayName: string
  setTrainDisplayName: (v: string) => void
  trainDataset: string
  setTrainDataset: (v: string) => void
  trainStartBusy: boolean
  setTrainStartBusy: (v: boolean) => void
  setTrainJobs: (jobs: TrainJob[]) => void
  setErr: (msg: string | null) => void
}

export function TrainMainView(props: TrainMainViewProps): ReactElement {
  const {
    trainJobs,
    trainKbSources,
    trainKbSelected,
    setTrainKbSelected,
    trainBase,
    setTrainBase,
    trainDisplayName,
    setTrainDisplayName,
    trainDataset,
    setTrainDataset,
    trainStartBusy,
    setTrainStartBusy,
    setTrainJobs,
    setErr
  } = props

  return (
    <div className="train-main-view">
      <p className="muted train-main-view-lead">
        Build a <strong>specialized local model</strong> by fine-tuning from a base GGUF (or HF folder path your Python stack
        accepts) on text exported from your <strong>knowledge base</strong>. The app writes <code className="inline-code">Alpaca-style</code>{' '}
        JSONL (instruction / output per chunk) into the job folder, runs <code className="inline-code">training/train_lora.py</code>, then
        copies any <code className="inline-code">merged.gguf</code> (or largest <code className="inline-code">.gguf</code>) into{' '}
        <code className="inline-code">models/finetunes/</code> so it appears in Run’s file picker.
      </p>
      <div className="drawer-section">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-database" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Knowledge for training
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Tick sources to include all their chunks. Or leave sources empty and set an explicit JSONL path below (advanced).
        </p>
        <div
          className="train-kb-picker"
          style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}
        >
          {trainKbSources.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No knowledge sources yet — add documents or save a chat to the wiki from the Knowledge panel.
            </p>
          ) : (
            trainKbSources.map((s) => (
              <label
                key={s.id}
                className="metrics-widget-check"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}
              >
                <input
                  type="checkbox"
                  checked={!!trainKbSelected[s.id]}
                  onChange={(e) => setTrainKbSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                />
                <span style={{ minWidth: 0 }}>{s.title}</span>
              </label>
            ))
          )}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary btn-ghost-sm"
            onClick={() => {
              const next: Record<string, boolean> = {}
              for (const s of trainKbSources) next[s.id] = true
              setTrainKbSelected(next)
            }}
          >
            Select all
          </button>
          <button type="button" className="btn-secondary btn-ghost-sm" onClick={() => setTrainKbSelected({})}>
            Clear
          </button>
        </div>
      </div>
      <div className="drawer-section">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-sliders" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Base model &amp; label
        </h3>
        <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
          Base weights path (local <code className="inline-code">.gguf</code> or path your trainer expects)
        </label>
        <input
          className="input"
          placeholder="C:\\…\\models\\Llama-3.2-3B-Instruct-Q4_K_M.gguf"
          value={trainBase}
          onChange={(e) => setTrainBase(e.target.value)}
          style={{ width: '100%', marginBottom: 12 }}
        />
        <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
          Name for the specialized model (used in <code className="inline-code">finetunes/*.gguf</code>)
        </label>
        <input
          className="input"
          placeholder="e.g. wiki-support-bot"
          value={trainDisplayName}
          onChange={(e) => setTrainDisplayName(e.target.value)}
          style={{ width: '100%', marginBottom: 12 }}
        />
        <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
          Optional: dataset JSONL path on disk (skips knowledge checkboxes when filled)
        </label>
        <input
          className="input"
          placeholder="Leave empty to use selected knowledge sources"
          value={trainDataset}
          onChange={(e) => setTrainDataset(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={trainStartBusy || !trainBase.trim()}
        onClick={async () => {
          const kbIds = Object.entries(trainKbSelected)
            .filter(([, on]) => on)
            .map(([id]) => id)
          const manualDs = trainDataset.trim()
          if (!manualDs && kbIds.length === 0) {
            setErr('Select knowledge sources or enter a dataset JSONL path.')
            return
          }
          setTrainStartBusy(true)
          setErr(null)
          try {
            await window.api.trainStart({
              baseModelPath: trainBase.trim(),
              ...(manualDs ? { datasetPath: manualDs } : { kbSourceIds: kbIds }),
              displayName: trainDisplayName.trim() || undefined
            })
            setTrainJobs((await window.api.trainListJobs()) as TrainJob[])
          } catch (e) {
            setErr(String(e))
          } finally {
            setTrainStartBusy(false)
          }
        }}
      >
        {trainStartBusy ? 'Starting…' : 'Start fine-tune job'}
      </button>
      <div className="drawer-section" style={{ marginTop: 16 }}>
        <h3 className="settings-section-title">
          <i className="fa-solid fa-list" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Jobs
        </h3>
        {trainJobs.length === 0 ? (
          <p className="muted">No jobs yet.</p>
        ) : (
          <ul className="train-job-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {trainJobs.map((j) => (
              <li
                key={j.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8
                }}
              >
                <div style={{ fontWeight: 600 }}>{j.displayName ?? j.id.slice(0, 8)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Status: <strong>{j.status}</strong>
                  {j.artifactPath ? (
                    <>
                      {' · '}
                      <code className="inline-code" style={{ wordBreak: 'break-all' }}>
                        {j.artifactPath}
                      </code>
                    </>
                  ) : null}
                </div>
                {j.message ? (
                  <pre className="code-block" style={{ marginTop: 8, fontSize: 11, maxHeight: 100, overflow: 'auto' }}>
                    {j.message}
                  </pre>
                ) : null}
                {(j.status === 'complete' || j.status === 'error') && (
                  <button
                    type="button"
                    className="btn-secondary btn-ghost-sm"
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      try {
                        await window.api.trainRescanArtifact(j.id)
                        setTrainJobs((await window.api.trainListJobs()) as TrainJob[])
                      } catch (e) {
                        setErr(String(e))
                      }
                    }}
                  >
                    Rescan output for GGUF → models/finetunes
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
