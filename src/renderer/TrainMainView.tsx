import type { Dispatch, ReactElement, SetStateAction } from 'react'
import { useMemo, useState } from 'react'
import type {
  DomainModelVersion,
  DomainProfile,
  EvidenceCard,
  KbSource,
  PromptDomainRow,
  TrainStartValidationResult,
  TrainJob,
  WikiSourceKind,
  WikiTopic
} from '@shared/types'
import { fileNameFromPath } from './downloadProgressUi'
import {
  WIKI_KIND_LABELS,
  WIKI_KIND_ORDER,
  groupWikiTopicsByKind,
  wikiKindFromUri
} from '@shared/wikiSourceGroups'

export type TrainMainViewProps = {
  trainJobs: TrainJob[]
  trainKbSources: KbSource[]
  wikiTopics: WikiTopic[]
  promptDomains: PromptDomainRow[]
  ragGroundingEnabled: boolean
  /** Local `.gguf` files under the models directory (same scan as Run); used for base-model dropdown. */
  trainGgufModelPaths: string[]
  comparePathsCaseInsensitive: boolean
  onOpenChatForAugment: () => void
  onOpenWiki: () => void
  onOpenPromptDomainSettings: () => void
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
  domainProfiles: DomainProfile[]
  selectedDomainId: string
  setSelectedDomainId: (v: string) => void
  onCreateDomainProfile: (name: string, terms: string[]) => Promise<void>
  reviewQueue: EvidenceCard[]
  onReviewSetStatus: (cardId: string, status: 'pending' | 'approved' | 'rejected') => Promise<void>
  onManifestPreview: (args: { baseModelPath: string; datasetPath: string; domainId?: string; sourceIds?: string[] }) => Promise<void>
  onValidateStart: (args: { baseModelPath: string }) => Promise<TrainStartValidationResult>
  manifestPreviewMarkdown: string | null
  domainModelVersions: DomainModelVersion[]
  setErr: (msg: string | null) => void
}

function topicsForPicker(wikiTopics: WikiTopic[], kbSources: KbSource[]): WikiTopic[] {
  if (wikiTopics.length > 0) return wikiTopics
  return kbSources.map((s) => ({
    id: s.id,
    title: s.title,
    chunkCount: 0,
    kind: wikiKindFromUri(s.uri)
  }))
}

const TRAIN_BASE_CUSTOM = '__train_base_custom__'

function trainPathsEqual(a: string, b: string, ci: boolean): boolean {
  const na = a.trim().replace(/\\/g, '/')
  const nb = b.trim().replace(/\\/g, '/')
  return ci ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

function trainJobKbSummary(ids: string[] | undefined, kbSources: KbSource[]): string | null {
  if (!ids || ids.length === 0) return null
  const counts: Partial<Record<WikiSourceKind, number>> = {}
  for (const id of ids) {
    const src = kbSources.find((s) => s.id === id)
    const kind = src ? wikiKindFromUri(src.uri) : 'other'
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  const parts = WIKI_KIND_ORDER.map((k) => (counts[k] ? `${counts[k]} ${WIKI_KIND_LABELS[k]}` : null)).filter(Boolean)
  return `${ids.length} source${ids.length === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(', ')}` : ''}`
}

export function TrainMainView(props: TrainMainViewProps): ReactElement {
  const {
    trainJobs,
    trainKbSources,
    wikiTopics,
    promptDomains,
    ragGroundingEnabled,
    trainGgufModelPaths,
    comparePathsCaseInsensitive,
    onOpenChatForAugment,
    onOpenWiki,
    onOpenPromptDomainSettings,
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
    domainProfiles,
    selectedDomainId,
    setSelectedDomainId,
    onCreateDomainProfile,
    reviewQueue,
    onReviewSetStatus,
    onManifestPreview,
    onValidateStart,
    manifestPreviewMarkdown,
    domainModelVersions,
    setErr
  } = props

  const [kbFilter, setKbFilter] = useState('')

  const pickerTopics = useMemo(() => topicsForPicker(wikiTopics, trainKbSources), [wikiTopics, trainKbSources])

  const filteredTopics = useMemo(() => {
    const q = kbFilter.trim().toLowerCase()
    if (!q) return pickerTopics
    return pickerTopics.filter((t) => t.title.toLowerCase().includes(q))
  }, [pickerTopics, kbFilter])

  const byKind = useMemo(() => groupWikiTopicsByKind(filteredTopics), [filteredTopics])

  const selectedChunkEstimate = useMemo(() => {
    let n = 0
    for (const t of pickerTopics) {
      if (trainKbSelected[t.id]) n += t.chunkCount
    }
    return n
  }, [pickerTopics, trainKbSelected])

  const sortedPromptDomains = useMemo(
    () => [...promptDomains].sort((a, b) => b.messageCount - a.messageCount),
    [promptDomains]
  )
  const promptDomainsPreview = sortedPromptDomains.slice(0, 12)
  const approvedCount = useMemo(() => reviewQueue.filter((c) => c.status === 'approved').length, [reviewQueue])
  const pendingCount = useMemo(() => reviewQueue.filter((c) => c.status === 'pending').length, [reviewQueue])

  const trainBaseSelectValue = useMemo(() => {
    const t = trainBase.trim()
    if (!t) return TRAIN_BASE_CUSTOM
    const hit = trainGgufModelPaths.find((p) => trainPathsEqual(p, t, comparePathsCaseInsensitive))
    return hit ?? TRAIN_BASE_CUSTOM
  }, [trainBase, trainGgufModelPaths, comparePathsCaseInsensitive])

  const setGroupSelection = (kind: (typeof WIKI_KIND_ORDER)[number], on: boolean) => {
    const list = byKind.get(kind) ?? []
    setTrainKbSelected((prev) => {
      const next = { ...prev }
      for (const t of list) next[t.id] = on
      return next
    })
  }

  return (
    <div className="train-main-view">
      <p className="muted train-main-view-lead">
        Narrator flow: <strong>review evidence</strong>, then <strong>select knowledge + base model</strong>, then{' '}
        <strong>start a fine-tune job</strong>. You can also augment at inference with retrieval and prompt-domain context
        without changing the checkpoint.
      </p>
      <div className="drawer-section train-workflow-strip">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-compass-drafting" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Training workflow
        </h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="muted">Collecting: automatic local evidence</span>
          <span className="muted">Organizing: {reviewQueue.length} evidence cards</span>
          <span className="muted">Review: {pendingCount} pending</span>
          <span className="muted">Ready to train: {approvedCount} approved</span>
        </div>
        <label className="muted train-field-label" htmlFor="train-domain-select">
          Domain profile (scopes data collection and model versions)
        </label>
        <select
          id="train-domain-select"
          className="input"
          value={selectedDomainId}
          onChange={(e) => setSelectedDomainId(e.target.value)}
        >
          <option value="">Global (all domains)</option>
          {domainProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary btn-ghost-sm"
            onClick={() => {
              const seed = sortedPromptDomains[0]
              if (!seed) {
                setErr('No prompt domains yet. Send a few chats first.')
                return
              }
              const terms = seed.keywords?.slice(0, 10) ?? []
              void onCreateDomainProfile(seed.title, terms)
            }}
          >
            Create profile from top prompt domain
          </button>
        </div>
      </div>

      <div className="drawer-section train-review-section">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-list-check" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          What was learned (review queue)
        </h3>
        {reviewQueue.length === 0 ? (
          <p className="muted">No evidence cards yet. Generate a chat or IDE event first, then return here to approve data.</p>
        ) : (
          <div className="train-review-list">
            {reviewQueue.slice(0, 14).map((card) => (
              <div key={card.id} className="train-review-row">
                <div style={{ fontWeight: 600 }}>{card.summary}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {card.status} · {Math.round(card.confidence * 100)}% confidence · {card.provenance}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn-secondary btn-ghost-sm"
                    onClick={() => void onReviewSetStatus(card.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-ghost-sm"
                    onClick={() => void onReviewSetStatus(card.id, 'rejected')}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-ghost-sm"
                    onClick={() => void onReviewSetStatus(card.id, 'pending')}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="drawer-section train-knowledge-section">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-layer-group" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Knowledge domains for training
        </h3>
        <p className="muted train-knowledge-lead">
          Sources are grouped by how they entered the library. Tick items to include all chunks in the export, or leave
          sources empty and set an explicit JSONL path in the fine-tune card below.
        </p>
        <label className="muted train-field-label" htmlFor="train-kb-filter">
          Filter by title
        </label>
        <input
          id="train-kb-filter"
          className="input train-kb-filter"
          placeholder="Search…"
          value={kbFilter}
          onChange={(e) => setKbFilter(e.target.value)}
        />
        {selectedChunkEstimate > 0 && (
          <p className="muted train-chunk-estimate">
            Selected: ~<strong>{selectedChunkEstimate}</strong> JSONL record{selectedChunkEstimate === 1 ? '' : 's'}{' '}
            (one per chunk).
          </p>
        )}
        <div className="train-knowledge-groups">
          {pickerTopics.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No knowledge sources yet — add documents or save a chat to the wiki from the Knowledge panel.
            </p>
          ) : (
            WIKI_KIND_ORDER.map((kind) => {
              const list = byKind.get(kind) ?? []
              if (list.length === 0) return null
              const chunkSum = list.reduce((acc, t) => acc + t.chunkCount, 0)
              return (
                <details key={kind} className="train-knowledge-details" open>
                  <summary className="train-knowledge-summary">
                    <span className="train-knowledge-summary-label">{WIKI_KIND_LABELS[kind]}</span>
                    <span className="muted train-knowledge-summary-meta">
                      {list.length} source{list.length === 1 ? '' : 's'}
                      {chunkSum > 0 ? ` · ${chunkSum} chunks` : ''}
                    </span>
                  </summary>
                  <div className="train-knowledge-summary-actions">
                    <button type="button" className="btn-secondary btn-ghost-sm" onClick={() => setGroupSelection(kind, true)}>
                      Select group
                    </button>
                    <button type="button" className="btn-secondary btn-ghost-sm" onClick={() => setGroupSelection(kind, false)}>
                      Clear group
                    </button>
                  </div>
                  <div className="train-kb-picker">
                    {list.map((t) => (
                      <label key={t.id} className="metrics-widget-check train-kb-row">
                        <input
                          type="checkbox"
                          checked={!!trainKbSelected[t.id]}
                          onChange={(e) =>
                            setTrainKbSelected((prev) => ({ ...prev, [t.id]: e.target.checked }))
                          }
                        />
                        <span className="train-kb-row-title">{t.title}</span>
                        {t.chunkCount > 0 ? (
                          <span className="muted train-kb-row-chunks">{t.chunkCount} chunks</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </details>
              )
            })
          )}
        </div>
        <div className="row train-knowledge-global-actions" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary btn-ghost-sm"
            onClick={() => {
              const next: Record<string, boolean> = {}
              for (const t of pickerTopics) next[t.id] = true
              setTrainKbSelected(next)
            }}
          >
            Select all
          </button>
          <button type="button" className="btn-secondary btn-ghost-sm" onClick={() => setTrainKbSelected({})}>
            Clear all
          </button>
        </div>
      </div>

      <div className="train-mode-cards" role="list">
        <section className="train-mode-card train-mode-card--lora" aria-labelledby="train-card-lora-title">
          <h3 id="train-card-lora-title" className="train-mode-card-title">
            <i className="fa-solid fa-fire-flame-curved" aria-hidden style={{ marginRight: 8, opacity: 0.8 }} />
            Fine-tune (LoRA → GGUF)
          </h3>
          <p className="muted train-mode-card-lead">
            Export <code className="inline-code">Alpaca-style</code> JSONL (each line: <code className="inline-code">instruction</code> is a{' '}
            <code className="inline-code">&lt;kb-chunk …/&gt;</code> tag with human-readable <code className="inline-code">context</code>,{' '}
            <code className="inline-code">rationale</code>, and <code className="inline-code">provenance</code>; <code className="inline-code">output</code> stays raw chunk text) from the knowledge domains above, run the bundled{' '}
            <code className="inline-code">Axolotl</code> backend, then copy{' '}
            <code className="inline-code">merged.gguf</code> (or largest <code className="inline-code">.gguf</code>) into{' '}
            <code className="inline-code">models/finetunes/</code> for Run&apos;s file picker.
          </p>
          <label className="muted train-field-label" htmlFor="train-base-model-select">
            Base model (<code className="inline-code">.gguf</code> from your models folder)
          </label>
          <select
            id="train-base-model-select"
            className="input train-base-model-select"
            aria-label="Choose a local GGUF base model"
            value={trainBaseSelectValue}
            onChange={(e) => {
              const v = e.target.value
              if (v === TRAIN_BASE_CUSTOM) {
                const cur = trainBase.trim()
                const wasListed =
                  cur.length > 0 &&
                  trainGgufModelPaths.some((p) => trainPathsEqual(p, cur, comparePathsCaseInsensitive))
                if (wasListed) setTrainBase('')
                return
              }
              setTrainBase(v)
            }}
          >
            <option value={TRAIN_BASE_CUSTOM}>
              {trainGgufModelPaths.length === 0 ? 'No .gguf files found — use path below' : 'Custom path…'}
            </option>
            {trainGgufModelPaths.map((p) => (
              <option key={p} value={p}>
                {fileNameFromPath(p)}
              </option>
            ))}
          </select>
          <label className="muted train-field-label" htmlFor="train-base-model-path">
            Base weights path (full path if not in the list, or another format your trainer accepts)
          </label>
          <input
            id="train-base-model-path"
            className="input"
            placeholder="C:\\…\\models\\Llama-3.2-3B-Instruct-Q4_K_M.gguf"
            value={trainBase}
            onChange={(e) => setTrainBase(e.target.value)}
          />
          <label className="muted train-field-label">Name for the specialized model (used in finetunes/*.gguf)</label>
          <input
            className="input"
            placeholder="e.g. wiki-support-bot"
            value={trainDisplayName}
            onChange={(e) => setTrainDisplayName(e.target.value)}
          />
          <label className="muted train-field-label">
            Optional: dataset JSONL path on disk (skips knowledge checkboxes when filled)
          </label>
          <input
            className="input"
            placeholder="Leave empty to use selected knowledge sources"
            value={trainDataset}
            onChange={(e) => setTrainDataset(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary train-lora-start"
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
                const preflight = await onValidateStart({ baseModelPath: trainBase.trim() })
                if (!preflight.supported) {
                  setErr(preflight.details ? `${preflight.reason} ${preflight.details}` : preflight.reason)
                  return
                }
                await onManifestPreview({
                  baseModelPath: trainBase.trim(),
                  datasetPath: manualDs || '(generated from selected knowledge sources)',
                  domainId: selectedDomainId || undefined,
                  sourceIds: manualDs ? undefined : kbIds
                })
                await window.api.trainStart({
                  baseModelPath: trainBase.trim(),
                  ...(manualDs ? { datasetPath: manualDs } : { kbSourceIds: kbIds }),
                  displayName: trainDisplayName.trim() || undefined,
                  domainId: selectedDomainId || undefined
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
          {manifestPreviewMarkdown ? (
            <details className="train-manifest-preview" style={{ marginTop: 10 }}>
              <summary>Manifest preview (human-readable)</summary>
              <pre className="code-block" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
                {manifestPreviewMarkdown}
              </pre>
            </details>
          ) : null}
        </section>

        <section className="train-mode-card train-mode-card--rag" aria-labelledby="train-card-rag-title">
          <h3 id="train-card-rag-title" className="train-mode-card-title">
            <i className="fa-solid fa-magnifying-glass" aria-hidden style={{ marginRight: 8, opacity: 0.8 }} />
            Retrieval augmentation
          </h3>
          <p className="muted train-mode-card-lead">
            Search the knowledge base from chat and inject relevant excerpts into the prompt. Best when facts change often
            or you want traceability to sources.
          </p>
          <p className="muted train-mode-card-meta">
            Citation-style grounding in chat:{' '}
            <strong>{ragGroundingEnabled ? 'on' : 'off'}</strong> (toggle in Settings → Chat &amp; knowledge).
          </p>
          <div className="train-mode-card-actions">
            <button type="button" className="btn-primary btn-sm" onClick={() => onOpenChatForAugment()}>
              Open chat with KB panel
            </button>
            <button type="button" className="btn-secondary btn-ghost-sm" onClick={() => onOpenWiki()}>
              Browse wiki / library
            </button>
          </div>
        </section>

        <section className="train-mode-card train-mode-card--domains" aria-labelledby="train-card-pd-title">
          <h3 id="train-card-pd-title" className="train-mode-card-title">
            <i className="fa-solid fa-tags" aria-hidden style={{ marginRight: 8, opacity: 0.8 }} />
            Prompt-domain augmentation
          </h3>
          <p className="muted train-mode-card-lead">
            Topic clusters inferred from your <strong>user prompts</strong> (not the same buckets as document types
            above). Optional per-domain system text applies when domain-enhanced prompts are enabled; edit it in{' '}
            <strong>Settings → Chat &amp; knowledge</strong>.
          </p>
          {promptDomainsPreview.length === 0 ? (
            <p className="muted train-mode-card-meta">No domains yet — send chat messages to populate clusters.</p>
          ) : (
            <ul className="train-prompt-domain-preview">
              {promptDomainsPreview.map((d) => (
                <li key={d.id}>
                  <span className="train-prompt-domain-name">{d.title}</span>
                  <span className="muted"> · {d.messageCount} prompts</span>
                </li>
              ))}
            </ul>
          )}
          <div className="train-mode-card-actions">
            <button type="button" className="btn-secondary" onClick={() => onOpenPromptDomainSettings()}>
              Edit domain context
            </button>
            <button type="button" className="btn-secondary btn-ghost-sm" onClick={() => onOpenWiki()}>
              Browse wiki / library
            </button>
          </div>
        </section>
      </div>

      <div className="drawer-section train-jobs-section">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-list" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Jobs
        </h3>
        {trainJobs.length === 0 ? (
          <p className="muted">No jobs yet. Start one fine-tune job here to show the training lifecycle.</p>
        ) : (
          <ul className="train-job-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {trainJobs.map((j) => {
              const kbHint = trainJobKbSummary(j.kbSourceIds, trainKbSources)
              return (
                <li key={j.id} className="train-job-item">
                  <div style={{ fontWeight: 600 }}>{j.displayName ?? j.id.slice(0, 8)}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Status: <strong>{j.status}</strong>
                    {kbHint ? (
                      <>
                        {' · '}
                        <span>{kbHint}</span>
                      </>
                    ) : null}
                    {j.artifactPath ? (
                      <>
                        {' · '}
                        <code className="inline-code" style={{ wordBreak: 'break-all' }}>
                          {j.artifactPath}
                        </code>
                      </>
                    ) : null}
                    {j.qualitySummary ? (
                      <>
                        {' · '}
                        <span>{j.qualitySummary}</span>
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
              )
            })}
          </ul>
        )}
      </div>
      <div className="drawer-section train-domain-models-section">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-timeline" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
          Domain model quality loop
        </h3>
        {domainModelVersions.length === 0 ? (
          <p className="muted">No domain model versions yet. They appear after completed jobs are assessed.</p>
        ) : (
          <ul className="train-job-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {domainModelVersions.slice(0, 8).map((v) => (
              <li key={v.id} className="train-job-item">
                <div style={{ fontWeight: 600 }}>{v.trainJobId.slice(0, 8)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {v.regressionRisk} regression risk · {v.qualitySummary}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
