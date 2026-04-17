import { useEffect, useMemo, useState, type ClipboardEvent, type ReactElement } from 'react'
import type { DownloadRow, HardwareSummary, HfModelDetail, HfModelSummary, RuntimeLoadProgress } from '@shared/types'
import { evaluateModelForHardware } from '@shared/modelHardwareFit'
import { DownloadProgressBar, formatBytes } from '../downloadProgressUi'

const HF_BROWSER_STORE_PAGE = 18
const HF_BROWSER_INSTALLED_PAGE = 12

export type HfHubSubview = 'store' | 'installed'
export type HfLibraryMode = 'recommended' | 'search'
export type HfModelSortKey = 'downloads' | 'likes' | 'size'

export type HfCardDownloadState = {
  jobId: string
  progress: number
  bytesReceived: number
  bytesTotal: number
  status: string
  displayName?: string
}

function huggingFaceModelUrl(repoId: string): string {
  return `https://huggingface.co/${repoId.split('/').map(encodeURIComponent).join('/')}`
}

function normSiblingPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

function hfSummaryFormatLabel(m: HfModelSummary): string {
  const tags = m.tags ?? []
  if (tags.some((t) => t.toLowerCase() === 'gguf')) return 'GGUF'
  if (tags.some((t) => t.toLowerCase() === 'safetensors')) return 'Safetensors'
  if (/gguf/i.test(m.id)) return 'GGUF'
  if (tags.length > 0) return tags.slice(0, 4).join(', ')
  if (m.pipeline_tag?.trim()) return m.pipeline_tag.trim()
  return '—'
}

function hfSummarySizeDisplay(m: HfModelSummary): string {
  const b = m.totalSizeBytes
  return b != null && b > 0 ? `~${formatBytes(b)}` : '—'
}

function hfInstalledSizeDisplay(m: HfModelSummary, localDownloads: readonly DownloadRow[]): string {
  const rows = localDownloads.filter((r) => r.repo_id === m.id && r.status === 'complete')
  const sum = rows.reduce((acc, r) => acc + (Number(r.bytes_total) || 0), 0)
  if (sum > 0) return formatBytes(sum)
  return hfSummarySizeDisplay(m)
}

function hfHardwareFitTooltipLines(ev: ReturnType<typeof evaluateModelForHardware>): string {
  return `${ev.headline}\n\n${ev.notes.join('\n')}`
}

function hfCardProgressPct(job: HfCardDownloadState): number | null {
  if (job.bytesTotal > 0 || job.bytesReceived > 0 || job.progress > 0) {
    return Math.max(0, Math.min(100, job.progress))
  }
  return null
}

function HardwareFitIcon(props: { model: HfModelSummary; hw: HardwareSummary | null }): ReactElement {
  const { model: m, hw } = props
  if (!hw) {
    return (
      <span
        className="hf-model-table-fit-icon hf-model-table-fit-icon--pending"
        title="Hardware summary not loaded yet"
        onClick={(e) => e.stopPropagation()}
      >
        <i className="fa-solid fa-minus" aria-hidden />
      </span>
    )
  }
  const ev = evaluateModelForHardware(m.totalSizeBytes, hw)
  const { verdict } = ev
  const title = hfHardwareFitTooltipLines(ev)
  const iconClass =
    verdict === 'good'
      ? 'hf-model-table-fit-icon hf-model-table-fit-icon--good'
      : verdict === 'marginal'
        ? 'hf-model-table-fit-icon hf-model-table-fit-icon--marginal'
        : verdict === 'poor'
          ? 'hf-model-table-fit-icon hf-model-table-fit-icon--poor'
          : 'hf-model-table-fit-icon hf-model-table-fit-icon--unknown'
  const iconName = verdict === 'unknown' ? 'fa-circle-question' : 'fa-circle-check'
  return (
    <span className={iconClass} title={title} onClick={(e) => e.stopPropagation()}>
      <i className={`fa-solid ${iconName}`} aria-hidden />
    </span>
  )
}

const README_PREVIEW_CHARS = 2800

export type HfModelBrowserDrawerProps = {
  hfQuery: string
  setHfQuery: (v: string) => void
  onHfQueryPaste: (e: ClipboardEvent<HTMLInputElement>) => void
  onHfSearch: () => void
  hfSearchLoading: boolean
  hfLibraryMode: HfLibraryMode
  backToRecommendations: () => void
  hfHubSubview: HfHubSubview
  setHfHubSubview: (v: HfHubSubview) => void
  hfListLoading: boolean
  hfListModelsLength: number
  hfDisplayModelsLength: number
  hfHubAvailableModelsSorted: HfModelSummary[]
  hfHubInstalledModelsSorted: HfModelSummary[]
  hfAvailableListPage: number
  setHfAvailableListPage: (n: number) => void
  hfInstalledListPage: number
  setHfInstalledListPage: (n: number) => void
  browseStoreEmptyAllInstalled: boolean
  selectedModel: string | null
  onActivateModel: (m: HfModelSummary) => void
  detail: HfModelDetail | null
  hardwareSummary: HardwareSummary | null
  localDownloads: readonly DownloadRow[]
  hfDownloadJobs: Record<string, HfCardDownloadState>
  quickDownloadRepo: string | null
  hfOllamaPullBusy: boolean
  hfOllamaPullRepoId: string | null
  hfOllamaPullProgress: RuntimeLoadProgress | null
  onInstall: (repoId: string, primaryFilename?: string) => void
  onCancelJob: (jobId: string) => void
  onDeleteInstalled: (m: HfModelSummary) => void
  hfHubDeleteRepoBusy: string | null
  hfFilterMinLikes: string
  setHfFilterMinLikes: (v: string) => void
  hfFilterMinDownloads: string
  setHfFilterMinDownloads: (v: string) => void
  hfFilterMaxSizeGb: string
  setHfFilterMaxSizeGb: (v: string) => void
  hfSortBy: HfModelSortKey
  setHfSortBy: (v: HfModelSortKey) => void
  hfSortDir: 'asc' | 'desc'
  setHfSortDir: (v: 'asc' | 'desc') => void
}

export function HfModelBrowserDrawer(props: HfModelBrowserDrawerProps): ReactElement {
  const {
    hfQuery,
    setHfQuery,
    onHfQueryPaste,
    onHfSearch,
    hfSearchLoading,
    hfLibraryMode,
    backToRecommendations,
    hfHubSubview,
    setHfHubSubview,
    hfListLoading,
    hfListModelsLength,
    hfDisplayModelsLength,
    hfHubAvailableModelsSorted,
    hfHubInstalledModelsSorted,
    hfAvailableListPage,
    setHfAvailableListPage,
    hfInstalledListPage,
    setHfInstalledListPage,
    browseStoreEmptyAllInstalled,
    selectedModel,
    onActivateModel,
    detail,
    hardwareSummary,
    localDownloads,
    hfDownloadJobs,
    quickDownloadRepo,
    hfOllamaPullBusy,
    hfOllamaPullRepoId,
    hfOllamaPullProgress,
    onInstall,
    onCancelJob,
    onDeleteInstalled,
    hfHubDeleteRepoBusy,
    hfFilterMinLikes,
    setHfFilterMinLikes,
    hfFilterMinDownloads,
    setHfFilterMinDownloads,
    hfFilterMaxSizeGb,
    setHfFilterMaxSizeGb,
    hfSortBy,
    setHfSortBy,
    hfSortDir,
    setHfSortDir
  } = props

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [readmeExpanded, setReadmeExpanded] = useState(false)

  useEffect(() => {
    setReadmeExpanded(false)
  }, [selectedModel])

  const inspectorRepoId = selectedModel

  const weightSiblings = useMemo(() => {
    if (!detail?.siblings?.length || detail.id !== inspectorRepoId) return []
    const rows = detail.siblings
      .filter((s) => {
        const n = normSiblingPath(s.path)
        return /\.gguf$/i.test(n) || /\.safetensors?$/i.test(n)
      })
      .slice()
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    return rows
  }, [detail, inspectorRepoId])

  const readmePreview = useMemo(() => {
    const raw = detail?.readme?.trim()
    if (!raw) return null
    if (readmeExpanded || raw.length <= README_PREVIEW_CHARS) return raw
    return `${raw.slice(0, README_PREVIEW_CHARS)}…`
  }, [detail?.readme, readmeExpanded])

  const storePageSize = HF_BROWSER_STORE_PAGE
  const installedPageSize = HF_BROWSER_INSTALLED_PAGE

  const storeTotalPages = Math.max(1, Math.ceil(hfHubAvailableModelsSorted.length / storePageSize))
  const storePageSafe = Math.min(Math.max(1, hfAvailableListPage), storeTotalPages)
  const storeStart = (storePageSafe - 1) * storePageSize
  const storeSlice = hfHubAvailableModelsSorted.slice(storeStart, storeStart + storePageSize)

  const instTotalPages = Math.max(1, Math.ceil(hfHubInstalledModelsSorted.length / installedPageSize))
  const instPageSafe = Math.min(Math.max(1, hfInstalledListPage), instTotalPages)
  const instStart = (instPageSafe - 1) * installedPageSize
  const instSlice = hfHubInstalledModelsSorted.slice(instStart, instStart + installedPageSize)

  const clearFilters = (): void => {
    setHfFilterMinLikes('')
    setHfFilterMinDownloads('')
    setHfFilterMaxSizeGb('')
  }

  const renderStoreCard = (m: HfModelSummary): ReactElement => {
    const hfJob = hfDownloadJobs[m.id]
    const hfPct = hfJob ? hfCardProgressPct(hfJob) : null
    const hfMeta = hfJob
      ? hfPct != null
        ? hfJob.bytesTotal > 0
          ? `${hfJob.progress}% · ${formatBytes(hfJob.bytesReceived)} / ${formatBytes(hfJob.bytesTotal)}`
          : `${hfJob.progress}%`
        : 'Starting…'
      : undefined
    const ollamaPullHere = hfOllamaPullBusy && hfOllamaPullRepoId === m.id
    const oPullPct =
      ollamaPullHere && hfOllamaPullProgress?.percent != null ? hfOllamaPullProgress.percent : null
    const oPullMeta =
      ollamaPullHere && hfOllamaPullProgress?.message
        ? hfOllamaPullProgress.percent != null
          ? `${hfOllamaPullProgress.percent}% · ${hfOllamaPullProgress.message}`
          : hfOllamaPullProgress.message
        : ollamaPullHere
          ? 'Pulling…'
          : undefined
    const rowInstallBusy = !!hfJob || quickDownloadRepo === m.id || ollamaPullHere
    const showProgress = ollamaPullHere || !!hfJob
    const downloadButtonLabel = ((): string => {
      if (ollamaPullHere) return 'Pulling…'
      if (hfJob) return 'Downloading…'
      if (quickDownloadRepo === m.id) return 'Working…'
      return 'Download'
    })()

    return (
      <div
        key={m.id}
        className={`hf-browser-card${selectedModel === m.id ? ' hf-browser-card--selected' : ''}`}
      >
        <button
          type="button"
          className="hf-browser-card-main"
          onClick={() => onActivateModel(m)}
          title={m.description?.trim() || m.id}
        >
          <div className="hf-browser-card-title">{m.id}</div>
          {m.description?.trim() ? <p className="hf-browser-card-desc">{m.description.trim()}</p> : null}
          {m.ollamaLibraryName ? (
            <div className="muted hf-model-table-ollama-tag" style={{ marginTop: 8 }}>
              <code className="inline-code">{m.ollamaLibraryName}</code>
            </div>
          ) : null}
          <div className="hf-browser-card-meta-row">
            <span>{hfSummarySizeDisplay(m)}</span>
            <span>{hfSummaryFormatLabel(m)}</span>
            <span>{(m.likes ?? 0).toLocaleString()} likes</span>
            <span className="hf-browser-card-fit">
              <HardwareFitIcon model={m} hw={hardwareSummary} />
            </span>
          </div>
        </button>
        {showProgress ? (
          <div className="hf-browser-card-progress">
            {ollamaPullHere ? (
              <DownloadProgressBar compact pct={oPullPct} meta={oPullMeta} />
            ) : hfJob ? (
              <>
                {hfJob.displayName ? (
                  <div className="muted hf-model-table-dl-label" style={{ marginBottom: 6, fontSize: 12 }}>
                    {hfJob.displayName}
                  </div>
                ) : null}
                <DownloadProgressBar compact pct={hfPct} meta={hfMeta} />
                <div className="hf-model-card-progress-actions">
                  <button
                    type="button"
                    className="btn-ghost-sm hf-model-table-cancel-dl"
                    onClick={() => void onCancelJob(hfJob.jobId)}
                  >
                    Cancel download
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="hf-browser-card-footer">
          <button
            type="button"
            className="btn-secondary hf-model-table-action-btn"
            disabled={rowInstallBusy}
            title="Download weight files for local inference, or pull via Ollama when mapped."
            onClick={(e) => {
              e.stopPropagation()
              void onInstall(m.id)
            }}
          >
            {downloadButtonLabel}
          </button>
        </div>
      </div>
    )
  }

  const renderInspector = (): ReactElement => {
    if (!inspectorRepoId) {
      return <p className="hf-browser-inspector-empty">Select a model to see details and weight files.</p>
    }

    const detailReady = detail?.id === inspectorRepoId
    const desc =
      detailReady && detail.description?.trim()
        ? detail.description.trim()
        : !detailReady
          ? null
          : null

    const shortDescFromList = !detailReady
      ? hfHubAvailableModelsSorted.find((x) => x.id === inspectorRepoId)?.description?.trim() ??
        hfHubInstalledModelsSorted.find((x) => x.id === inspectorRepoId)?.description?.trim() ??
        null
      : null

    return (
      <div className="hf-browser-inspector-inner">
        <h3 className="hf-browser-inspector-title">{inspectorRepoId}</h3>
        <div className="hf-browser-inspector-chips">
          {detailReady && detail.pipeline_tag?.trim() ? (
            <span className="hf-browser-chip">{detail.pipeline_tag.trim()}</span>
          ) : null}
          {detailReady && detail.license?.trim() ? (
            <span className="hf-browser-chip">{detail.license.trim()}</span>
          ) : null}
          {detailReady && (detail.tags?.length ?? 0) > 0
            ? (detail.tags ?? []).slice(0, 8).map((t) => (
                <span key={t} className="hf-browser-chip">
                  {t}
                </span>
              ))
            : null}
        </div>

        {!detailReady ? (
          <p className="muted" style={{ margin: '0 0 12px' }}>
            {shortDescFromList ? (
              <span className="hf-browser-inspector-desc">{shortDescFromList}</span>
            ) : (
              'Loading model details…'
            )}
          </p>
        ) : desc ? (
          <p className="hf-browser-inspector-desc">{desc}</p>
        ) : null}

        {readmePreview ? (
          <>
            <h4 className="hf-browser-weights-title" style={{ marginTop: 4 }}>
              Readme
            </h4>
            <p
              className={`hf-browser-inspector-desc${!readmeExpanded && (detail?.readme?.length ?? 0) > README_PREVIEW_CHARS ? ' hf-browser-inspector-desc--clamped' : ''}`}
            >
              {readmePreview}
            </p>
            {(detail?.readme?.length ?? 0) > README_PREVIEW_CHARS ? (
              <button type="button" className="btn-ghost-sm" onClick={() => setReadmeExpanded((v) => !v)}>
                {readmeExpanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </>
        ) : null}

        <a
          href={huggingFaceModelUrl(inspectorRepoId)}
          target="_blank"
          rel="noopener noreferrer"
          className="hf-browser-inspector-link"
        >
          View on Hugging Face
        </a>

        {weightSiblings.length > 0 ? (
          <>
            <h4 className="hf-browser-weights-title">Weight files</h4>
            <ul className="hf-browser-weights" aria-label="Downloadable weight files">
              {weightSiblings.map((s) => (
                <li key={s.path} className="hf-browser-weight-row">
                  <span className="hf-browser-weight-path">{s.path}</span>
                  <span className="hf-browser-weight-size">
                    {s.size != null && s.size > 0 ? formatBytes(s.size) : '—'}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary hf-model-table-action-btn"
                    disabled={
                      !!hfDownloadJobs[inspectorRepoId] ||
                      quickDownloadRepo === inspectorRepoId ||
                      (hfOllamaPullBusy && hfOllamaPullRepoId === inspectorRepoId)
                    }
                    onClick={() => void onInstall(inspectorRepoId, s.path)}
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : detailReady && detail.ollamaLibraryName?.trim() ? (
          <div style={{ marginTop: 8 }}>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
              No standalone weight file listed. This repo maps to the Ollama library tag below.
            </p>
            <code className="inline-code">{detail.ollamaLibraryName.trim()}</code>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn-primary hf-model-table-action-btn"
                disabled={
                  hfOllamaPullBusy ||
                  !!hfDownloadJobs[inspectorRepoId] ||
                  quickDownloadRepo === inspectorRepoId
                }
                onClick={() => void onInstall(inspectorRepoId)}
              >
                {hfOllamaPullBusy && hfOllamaPullRepoId === inspectorRepoId ? 'Pulling…' : 'Pull with Ollama'}
              </button>
            </div>
          </div>
        ) : detailReady ? (
          <p className="muted" style={{ fontSize: 13 }}>
            No .gguf or .safetensors files found in the file list for this revision.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="hf-browser-shell">
      <nav className="hf-browser-rail" aria-label="Model library">
        <button
          type="button"
          className={`hf-browser-rail-btn${hfHubSubview === 'store' ? ' hf-browser-rail-btn--active' : ''}`}
          onClick={() => setHfHubSubview('store')}
        >
          <span className="hf-browser-rail-icon" aria-hidden>
            <i className="fa-solid fa-compass" />
          </span>
          Discover
        </button>
        <button
          type="button"
          className={`hf-browser-rail-btn${hfHubSubview === 'installed' ? ' hf-browser-rail-btn--active' : ''}`}
          onClick={() => setHfHubSubview('installed')}
        >
          <span className="hf-browser-rail-icon" aria-hidden>
            <i className="fa-solid fa-hard-drive" />
          </span>
          On this device
        </button>
      </nav>

      <div className="hf-browser-catalog">
        <div className="hf-browser-catalog-head">
          <div className="hf-browser-search-row">
            <input
              className="input"
              value={hfQuery}
              onChange={(e) => setHfQuery(e.target.value)}
              onPaste={onHfQueryPaste}
              onKeyDown={(e) => e.key === 'Enter' && onHfSearch()}
              placeholder="Search or paste a Hugging Face model URL…"
              aria-label="Search models on Hugging Face"
            />
            <button type="button" className="btn-primary" onClick={onHfSearch} disabled={hfSearchLoading}>
              {hfSearchLoading ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div className="hf-browser-toolbar">
            <h3 className="hf-browser-toolbar-title">
              {hfLibraryMode === 'search' ? 'Search results' : 'Recommended for you'}
            </h3>
            {hfLibraryMode === 'search' ? (
              <button type="button" className="btn-ghost-sm hf-library-back-btn" onClick={backToRecommendations}>
                ← Recommended
              </button>
            ) : null}
            {hfHubSubview === 'store' ? (
              <button
                type="button"
                className="btn-ghost-sm hf-browser-filters-toggle"
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
              >
                {filtersOpen ? 'Hide filters' : 'Filters & sort'}
              </button>
            ) : null}
          </div>

          {hfHubSubview === 'store' && filtersOpen ? (
            <div className="hf-library-filters" style={{ marginBottom: 12 }}>
              <div className="hf-library-filters-grid">
                <label className="hf-library-filter-field">
                  <span className="hf-library-filter-label">Min likes</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={hfFilterMinLikes}
                    onChange={(e) => setHfFilterMinLikes(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="hf-library-filter-field">
                  <span className="hf-library-filter-label">Min downloads</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={hfFilterMinDownloads}
                    onChange={(e) => setHfFilterMinDownloads(e.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="hf-library-filter-field">
                  <span className="hf-library-filter-label">Max size (GB)</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={hfFilterMaxSizeGb}
                    onChange={(e) => setHfFilterMaxSizeGb(e.target.value)}
                    placeholder="Any"
                  />
                </label>
                <div className="hf-library-filter-field">
                  <span className="hf-library-filter-label">Sort list by</span>
                  <select
                    className="select"
                    value={hfSortBy}
                    onChange={(e) => setHfSortBy(e.target.value as HfModelSortKey)}
                  >
                    <option value="downloads">Downloads</option>
                    <option value="likes">Likes</option>
                    <option value="size">Size</option>
                  </select>
                </div>
                <div className="hf-library-filter-field">
                  <span className="hf-library-filter-label">Direction</span>
                  <select
                    className="select"
                    value={hfSortDir}
                    onChange={(e) => setHfSortDir(e.target.value as 'asc' | 'desc')}
                  >
                    <option value="desc">High → low</option>
                    <option value="asc">Low → high</option>
                  </select>
                </div>
                <div className="hf-library-filter-actions">
                  <button type="button" className="btn-secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="hf-browser-catalog-scroll">
          {hfHubSubview !== 'store' ? (
            <p className="muted hf-hub-installed-view-hint" style={{ margin: '0 0 12px' }}>
              Models from this list that are already on your device. Use <strong>Discover</strong> to find more.
            </p>
          ) : null}

          {hfListLoading ? (
            <div className="hf-library-loading">
              {hfLibraryMode === 'search' ? 'Searching…' : 'Loading…'}
            </div>
          ) : null}

          {!hfListLoading && hfListModelsLength === 0 && hfLibraryMode === 'recommended' ? (
            <p className="muted">No picks loaded. Try a search above.</p>
          ) : null}
          {!hfListLoading && hfListModelsLength === 0 && hfLibraryMode === 'search' ? (
            <p className="muted">No models matched. Try different words.</p>
          ) : null}
          {!hfListLoading && hfListModelsLength > 0 && hfDisplayModelsLength === 0 ? (
            <p className="muted">No models match the current filters.</p>
          ) : null}

          {!hfListLoading && hfDisplayModelsLength > 0 && hfHubSubview === 'store' ? (
            browseStoreEmptyAllInstalled ? (
              <p className="muted hf-library-column-empty">
                All of these are already on your device — open <strong>On this device</strong>.
              </p>
            ) : (
              <>
                <div className="hf-browser-grid" aria-label="Models you can add">
                  {storeSlice.map((m) => renderStoreCard(m))}
                </div>
                {hfHubAvailableModelsSorted.length > 0 ? (
                  <div className="hf-browser-pagination" role="navigation" aria-label="Pagination, store">
                    <button
                      type="button"
                      className="btn-secondary hf-model-table-page-btn"
                      disabled={storePageSafe <= 1}
                      onClick={() => setHfAvailableListPage(storePageSafe - 1)}
                    >
                      Previous
                    </button>
                    <span className="hf-browser-pagination-meta">
                      Page {storePageSafe} of {storeTotalPages} ·{' '}
                      {hfHubAvailableModelsSorted.length === 0
                        ? 0
                        : `${storeStart + 1}–${storeStart + storeSlice.length}`}{' '}
                      of {hfHubAvailableModelsSorted.length}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary hf-model-table-page-btn"
                      disabled={storePageSafe >= storeTotalPages}
                      onClick={() => setHfAvailableListPage(storePageSafe + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            )
          ) : null}

          {!hfListLoading && hfDisplayModelsLength > 0 && hfHubSubview === 'installed' ? (
            hfHubInstalledModelsSorted.length === 0 ? (
              <p className="muted hf-library-column-empty">
                Nothing from this browse list is saved yet. Pick a model and press Download.
              </p>
            ) : (
              <>
                <div className="hf-browser-installed-list" aria-label="Already on this device">
                  {instSlice.map((m) => (
                      <div
                        key={m.id}
                        className={`hf-browser-installed-row${selectedModel === m.id ? ' hf-browser-installed-row--selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => onActivateModel(m)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onActivateModel(m)
                          }
                        }}
                      >
                        <div className="hf-browser-installed-meta">
                          <div className="hf-browser-card-title">{m.id}</div>
                          {m.ollamaLibraryName ? (
                            <div className="muted hf-model-table-ollama-tag" style={{ marginTop: 4 }}>
                              <code className="inline-code">{m.ollamaLibraryName}</code>
                            </div>
                          ) : null}
                          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                            {hfInstalledSizeDisplay(m, localDownloads)}
                          </div>
                        </div>
                        <div className="hf-browser-installed-actions">
                          <button
                            type="button"
                            className="btn-danger hf-model-table-delete"
                            disabled={hfHubDeleteRepoBusy !== null}
                            onClick={(e) => {
                              e.stopPropagation()
                              void onDeleteInstalled(m)
                            }}
                          >
                            {hfHubDeleteRepoBusy === m.id ? 'Removing…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                  ))}
                </div>
                {hfHubInstalledModelsSorted.length > 0 ? (
                  <div className="hf-browser-pagination" role="navigation" aria-label="Pagination, installed">
                    <button
                      type="button"
                      className="btn-secondary hf-model-table-page-btn"
                      disabled={instPageSafe <= 1}
                      onClick={() => setHfInstalledListPage(instPageSafe - 1)}
                    >
                      Previous
                    </button>
                    <span className="hf-browser-pagination-meta">
                      Page {instPageSafe} of {instTotalPages} ·{' '}
                      {hfHubInstalledModelsSorted.length === 0
                        ? 0
                        : `${instStart + 1}–${instStart + instSlice.length}`}{' '}
                      of {hfHubInstalledModelsSorted.length}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary hf-model-table-page-btn"
                      disabled={instPageSafe >= instTotalPages}
                      onClick={() => setHfInstalledListPage(instPageSafe + 1)}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            )
          ) : null}
        </div>
      </div>

      <aside className="hf-browser-inspector" aria-label="Model details">
        {renderInspector()}
      </aside>
    </div>
  )
}
