import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DownloadRow,
  HfModelDetail,
  HfModelSummary,
  MetricsSnapshot,
  RuntimeStatus
} from '@shared/types'
import { DownloadProgressBar, downloadRowProgressPct, fileNameFromPath, formatBytes } from './downloadProgressUi'
import { DownloadsPinnedWidget } from './DownloadsPinnedWidget'
import { MetricsTimeSeries } from './MetricsTimeSeries'
import { MetricsPinnedWidget } from './MetricsPinnedWidget'

const METRICS_REFRESH_PRESETS_MS = [
  1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 3_600_000
] as const

function clampMetricsRefreshMs(ms: number): number {
  return Math.min(3_600_000, Math.max(500, Math.floor(ms)))
}

function formatRefreshLabel(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

type MainView = 'chat' | 'wiki'
type ToolDrawer = 'hf' | 'runtime' | 'train' | 'metrics' | 'settings' | null
type HfLibraryMode = 'recommended' | 'search'

function runtimeKindLabel(kind: RuntimeStatus['kind']): string {
  if (kind === 'ollama') return 'Ollama'
  if (kind === 'llamacpp') return 'llama.cpp server'
  return 'None'
}

function downloadStatusClass(status: string): string {
  switch (status) {
    case 'complete':
      return 'runtime-download-status runtime-download-status--complete'
    case 'downloading':
    case 'pending':
      return 'runtime-download-status runtime-download-status--active'
    case 'error':
      return 'runtime-download-status runtime-download-status--error'
    case 'cancelled':
      return 'runtime-download-status runtime-download-status--cancelled'
    default:
      return 'runtime-download-status'
  }
}

type HfCardDownloadState = {
  jobId: string
  progress: number
  bytesReceived: number
  bytesTotal: number
  status: string
}

function parseHfDownloadStatus(raw: unknown): HfCardDownloadState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const num = (a: string, b: string): number => {
    const v = o[a]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const w = o[b]
    if (typeof w === 'number' && Number.isFinite(w)) return w
    return 0
  }
  const id = o.id != null ? String(o.id) : ''
  const status = String(o.status ?? '')
  if (!id || !status) return null
  let progress = typeof o.progress === 'number' && Number.isFinite(o.progress) ? o.progress : 0
  const bytesReceived = num('bytesReceived', 'bytes_received')
  const bytesTotal = num('bytesTotal', 'bytes_total')
  if (progress === 0 && bytesTotal > 0 && bytesReceived > 0) {
    progress = Math.min(99, Math.round((100 * bytesReceived) / bytesTotal))
  }
  return { jobId: id, progress, bytesReceived, bytesTotal, status }
}

function hfCardProgressPct(job: HfCardDownloadState): number | null {
  if (job.bytesTotal > 0 || job.bytesReceived > 0 || job.progress > 0) {
    return Math.max(0, Math.min(100, job.progress))
  }
  return null
}

function IconChat(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  )
}

function IconBook(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  )
}

function IconBox(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  )
}

function IconCpu(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  )
}

function IconFlask(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 3h6M10 3v6l-4 9a1 1 0 00.9 1.4h10.2a1 1 0 00.9-1.4l-4-9V3" />
    </svg>
  )
}

function IconActivity(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}

function IconGear(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function IconSend(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}

function IconPin(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 11a2 2 0 100-4 2 2 0 000 4z" />
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
    </svg>
  )
}

export default function App(): React.ReactElement {
  const [mainView, setMainView] = useState<MainView>('chat')
  const [drawer, setDrawer] = useState<ToolDrawer>(null)

  const [paths, setPaths] = useState<Awaited<ReturnType<typeof window.api.getPaths>> | null>(null)
  const [hfQuery, setHfQuery] = useState('llama gguf')
  const [hfResults, setHfResults] = useState<HfModelSummary[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [detail, setDetail] = useState<HfModelDetail | null>(null)
  const [downloadFile, setDownloadFile] = useState('')
  const [destDir, setDestDir] = useState('')
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [runtimeKind, setRuntimeKind] = useState<'llamacpp' | 'ollama'>('ollama')
  const [modelPath, setModelPath] = useState('llama3.2')
  const [llamaBin, setLlamaBin] = useState('')
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [localDownloads, setLocalDownloads] = useState<DownloadRow[]>([])

  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [draft, setDraft] = useState('')
  const [ragQuery, setRagQuery] = useState('')
  const [ragSnippets, setRagSnippets] = useState<string[]>([])
  const [ragLoading, setRagLoading] = useState(false)

  const [wikiTopics, setWikiTopics] = useState<{ id: string; title: string; chunkCount: number }[]>([])
  const [wikiBody, setWikiBody] = useState('')
  const [wikiTitle, setWikiTitle] = useState('')
  const [wikiSelectedId, setWikiSelectedId] = useState<string | null>(null)

  const [metricsBundle, setMetricsBundle] = useState<{
    snapshot: unknown
    history: MetricsSnapshot[]
  } | null>(null)
  const [recommendedModels, setRecommendedModels] = useState<HfModelSummary[]>([])
  const [recommendedLoading, setRecommendedLoading] = useState(false)
  const [hfLibraryMode, setHfLibraryMode] = useState<HfLibraryMode>('recommended')
  const [hfSearchLoading, setHfSearchLoading] = useState(false)
  const [quickDownloadRepo, setQuickDownloadRepo] = useState<string | null>(null)
  const [trainJobs, setTrainJobs] = useState<unknown[]>([])
  const [trainBase, setTrainBase] = useState('')
  const [trainDataset, setTrainDataset] = useState('')
  const [hfTokenInput, setHfTokenInput] = useState('')
  const [modelsInstallPathDraft, setModelsInstallPathDraft] = useState('')
  const [modelsDirSaveErr, setModelsDirSaveErr] = useState<string | null>(null)
  const [downloadCacheClearBusy, setDownloadCacheClearBusy] = useState(false)
  const [downloadCacheClearMessage, setDownloadCacheClearMessage] = useState<string | null>(null)
  const [hfDownloadJobs, setHfDownloadJobs] = useState<Record<string, HfCardDownloadState>>({})
  const hfDownloadJobsRef = useRef(hfDownloadJobs)
  hfDownloadJobsRef.current = hfDownloadJobs

  const [metricsPinned, setMetricsPinned] = useState(false)
  const [downloadsPinned, setDownloadsPinned] = useState(false)
  const [pinnedDownloadsSnapshot, setPinnedDownloadsSnapshot] = useState<DownloadRow[]>([])
  const [metricsRefreshMs, setMetricsRefreshMs] = useState(3000)
  const [metricsRefreshCustomMode, setMetricsRefreshCustomMode] = useState(false)
  const [metricsCustomSec, setMetricsCustomSec] = useState('')
  const [widgetSnap, setWidgetSnap] = useState<MetricsSnapshot | null>(null)
  const [widgetSeries, setWidgetSeries] = useState<MetricsSnapshot[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const refreshPaths = useCallback(async () => {
    const p = await window.api.getPaths()
    setPaths(p)
    setDestDir((d) => d || p.modelsDefault)
  }, [])

  const loadConversations = useCallback(async () => {
    const c = await window.api.conversationsList()
    setConversations(c as { id: string; title: string }[])
  }, [])

  const loadWiki = useCallback(async () => {
    const t = await window.api.kbWikiTopics()
    setWikiTopics(t as { id: string; title: string; chunkCount: number }[])
  }, [])

  const refreshRuntimeStatus = useCallback(async () => {
    const s = await window.api.runtimeStatus()
    setRuntimeStatus(s)
  }, [])

  const refreshRunDrawer = useCallback(async () => {
    const [s, downloads] = await Promise.all([window.api.runtimeStatus(), window.api.downloadsList()])
    setRuntimeStatus(s)
    setLocalDownloads(downloads)
  }, [])

  const cancelDownloadJob = useCallback(
    async (jobId: string) => {
      await window.api.hfCancelDownload(jobId)
      setHfDownloadJobs((prev) => {
        const next = { ...prev }
        let changed = false
        for (const [rid, st] of Object.entries(prev)) {
          if (st.jobId === jobId) {
            delete next[rid]
            changed = true
          }
        }
        return changed ? next : prev
      })
      void refreshRunDrawer()
      if (downloadsPinned) {
        try {
          setPinnedDownloadsSnapshot(await window.api.downloadsList())
        } catch {
          /* ignore */
        }
      }
    },
    [refreshRunDrawer, downloadsPinned]
  )

  const clearDownloadCacheFromSettings = useCallback(async () => {
    setDownloadCacheClearMessage(null)
    setErr(null)
    setDownloadCacheClearBusy(true)
    try {
      const r = await window.api.clearDownloadCache()
      setHfDownloadJobs({})
      setDownloadCacheClearMessage(
        `Cleared ${r.downloadsRemoved} download registry row${r.downloadsRemoved === 1 ? '' : 's'} and ${r.hfCacheRemoved} Hugging Face cache entr${r.hfCacheRemoved === 1 ? 'y' : 'ies'}. Files on disk were not deleted.`
      )
      void refreshRunDrawer()
      if (downloadsPinned) {
        try {
          setPinnedDownloadsSnapshot(await window.api.downloadsList())
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setDownloadCacheClearBusy(false)
    }
  }, [refreshRunDrawer, downloadsPinned])

  useEffect(() => {
    void refreshPaths()
    void window.api.runtimeInstallPath().then((c) => setLlamaBin(c.llamaBinary))
    void loadConversations()
    void loadWiki()
    void refreshRuntimeStatus()
    void window.api.getConfig().then((c: Record<string, unknown>) => {
      if (typeof c.metricsPinned === 'boolean') setMetricsPinned(c.metricsPinned)
      if (typeof c.downloadsPinned === 'boolean') setDownloadsPinned(c.downloadsPinned)
      if (typeof c.metricsRefreshMs === 'number') {
        const ms = clampMetricsRefreshMs(c.metricsRefreshMs)
        setMetricsRefreshMs(ms)
        setMetricsRefreshCustomMode(!(METRICS_REFRESH_PRESETS_MS as readonly number[]).includes(ms))
      }
    })
  }, [refreshPaths, loadConversations, loadWiki, refreshRuntimeStatus])

  useEffect(() => {
    if (drawer !== 'runtime') return
    void refreshRunDrawer()
    const id = window.setInterval(() => void refreshRunDrawer(), 1000)
    return () => window.clearInterval(id)
  }, [drawer, refreshRunDrawer])

  useEffect(() => {
    if (drawer !== 'settings' || !paths) return
    setModelsInstallPathDraft(paths.modelsDefault)
    setModelsDirSaveErr(null)
  }, [drawer, paths])

  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        const jobs = hfDownloadJobsRef.current
        const repoIds = Object.keys(jobs)
        if (repoIds.length === 0) return
        const next: Record<string, HfCardDownloadState> = { ...jobs }
        let changed = false
        for (const repoId of repoIds) {
          const cur = jobs[repoId]
          const raw = await window.api.hfDownloadStatus(cur.jobId)
          const st = parseHfDownloadStatus(raw)
          if (!st) {
            delete next[repoId]
            changed = true
            continue
          }
          if (st.status === 'complete' || st.status === 'error' || st.status === 'cancelled') {
            delete next[repoId]
            changed = true
            continue
          }
          if (
            cur.progress !== st.progress ||
            cur.bytesReceived !== st.bytesReceived ||
            cur.bytesTotal !== st.bytesTotal ||
            cur.status !== st.status
          ) {
            next[repoId] = {
              jobId: cur.jobId,
              progress: st.progress,
              bytesReceived: st.bytesReceived,
              bytesTotal: st.bytesTotal,
              status: st.status
            }
            changed = true
          }
        }
        if (changed) setHfDownloadJobs(next)
      })()
    }, 400)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, mainView])

  const refreshMetricsBundle = useCallback(async () => {
    const [snap, hist] = await Promise.all([
      window.api.metricsSnapshot({ persist: true }),
      window.api.metricsHistory(144)
    ])
    setMetricsBundle({
      snapshot: snap,
      history: (hist as MetricsSnapshot[]) ?? []
    })
  }, [])

  const saveMetricsWidgetConfig = useCallback(
    async (patch: { metricsPinned?: boolean; downloadsPinned?: boolean; metricsRefreshMs?: number }) => {
      const body: Record<string, unknown> = {}
      if (patch.metricsPinned !== undefined) body.metricsPinned = patch.metricsPinned
      if (patch.downloadsPinned !== undefined) body.downloadsPinned = patch.downloadsPinned
      if (patch.metricsRefreshMs !== undefined) body.metricsRefreshMs = clampMetricsRefreshMs(patch.metricsRefreshMs)
      await window.api.setConfig(body)
    },
    []
  )

  useEffect(() => {
    if (!metricsPinned) {
      setWidgetSeries([])
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const s = (await window.api.metricsSnapshot({ persist: false })) as MetricsSnapshot
        if (cancelled) return
        setWidgetSnap(s)
        setWidgetSeries((prev) => [...prev.slice(-47), s])
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = window.setInterval(tick, metricsRefreshMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [metricsPinned, metricsRefreshMs])

  useEffect(() => {
    if (!downloadsPinned) {
      setPinnedDownloadsSnapshot([])
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const rows = await window.api.downloadsList()
        if (cancelled) return
        setPinnedDownloadsSnapshot(rows)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [downloadsPinned])

  const metricsWidgetControls = (
    <div className="drawer-section">
      <h3>Pinned floating widgets</h3>
      <label className="metrics-widget-check">
        <input
          type="checkbox"
          checked={metricsPinned}
          onChange={(e) => {
            const v = e.target.checked
            setMetricsPinned(v)
            void saveMetricsWidgetConfig({ metricsPinned: v })
          }}
        />
        <span>Show floating live metrics (does not write to history each tick)</span>
      </label>
      <label className="metrics-widget-check" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={downloadsPinned}
          onChange={(e) => {
            const v = e.target.checked
            setDownloadsPinned(v)
            void saveMetricsWidgetConfig({ downloadsPinned: v })
          }}
        />
        <span>Show floating download progress (Hub jobs; pinned bottom-left)</span>
      </label>
      <p className="muted" style={{ margin: '10px 0 6px' }}>
        Widget refresh rate (500 ms – 1 hour). Full stats drawer still records samples when you open it or press Record.
      </p>
      <select
        className="select"
        value={metricsRefreshCustomMode ? 'custom' : String(metricsRefreshMs)}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'custom') {
            setMetricsRefreshCustomMode(true)
            return
          }
          setMetricsRefreshCustomMode(false)
          const ms = Number(v)
          setMetricsRefreshMs(ms)
          void saveMetricsWidgetConfig({ metricsRefreshMs: ms })
        }}
      >
        {METRICS_REFRESH_PRESETS_MS.map((ms) => (
          <option key={ms} value={String(ms)}>
            {formatRefreshLabel(ms)}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <label style={{ flex: 1, minWidth: 120 }}>
          <span className="muted" style={{ display: 'block', marginBottom: 4 }}>
            Custom interval (seconds)
          </span>
          <input
            className="input"
            type="number"
            min={0.5}
            max={3600}
            step={0.5}
            value={metricsCustomSec}
            onChange={(e) => setMetricsCustomSec(e.target.value)}
            placeholder={(metricsRefreshMs / 1000).toString()}
          />
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const n = parseFloat(metricsCustomSec)
            if (Number.isNaN(n) || n < 0.5) return
            const ms = clampMetricsRefreshMs(n * 1000)
            setMetricsRefreshMs(ms)
            setMetricsRefreshCustomMode(!(METRICS_REFRESH_PRESETS_MS as readonly number[]).includes(ms))
            setMetricsCustomSec('')
            void saveMetricsWidgetConfig({ metricsRefreshMs: ms })
          }}
        >
          Apply
        </button>
      </div>
    </div>
  )

  useEffect(() => {
    if (drawer === 'metrics') void refreshMetricsBundle()
    if (drawer === 'train') void window.api.trainListJobs().then(setTrainJobs)
    if (drawer === 'hf') {
      setHfLibraryMode('recommended')
      setHfResults([])
      setHfSearchLoading(false)
      setSelectedModel(null)
      setDetail(null)
      setRecommendedLoading(true)
      void window.api
        .hfRecommended(28)
        .then((r) => setRecommendedModels(r as HfModelSummary[]))
        .catch(() => setRecommendedModels([]))
        .finally(() => setRecommendedLoading(false))
    }
  }, [drawer, refreshMetricsBundle])

  const hfListModels = hfLibraryMode === 'search' ? hfResults : recommendedModels
  const hfListLoading = hfLibraryMode === 'search' ? hfSearchLoading : recommendedLoading

  function backToRecommendations(): void {
    setHfLibraryMode('recommended')
    setHfResults([])
    setHfSearchLoading(false)
    setSelectedModel(null)
    setDetail(null)
  }

  async function runHfSearch(): Promise<void> {
    setErr(null)
    setHfLibraryMode('search')
    setHfSearchLoading(true)
    setSelectedModel(null)
    setDetail(null)
    try {
      const r = await window.api.hfSearch(hfQuery, 40)
      setHfResults(r as HfModelSummary[])
    } catch (e) {
      setErr(String(e))
      setHfResults([])
    } finally {
      setHfSearchLoading(false)
    }
  }

  async function quickDownloadFromRepo(repoId: string): Promise<void> {
    setErr(null)
    setQuickDownloadRepo(repoId)
    try {
      const d = (await window.api.hfModelInfo(repoId)) as HfModelDetail
      const gguf = d.siblings?.find((s) => /\.gguf$/i.test(s.path))
      const file = gguf ?? d.siblings?.[0]
      if (!file) {
        setErr('No downloadable files found for this model.')
        return
      }
      const j = (await window.api.hfDownload({
        repoId,
        revision: 'main',
        filename: file.path,
        destDir
      })) as { id: string; progress?: number; bytesReceived?: number; bytesTotal?: number; status?: string }
      setLastJobId(j.id)
      setHfDownloadJobs((prev) => ({
        ...prev,
        [repoId]: {
          jobId: j.id,
          progress: typeof j.progress === 'number' ? j.progress : 0,
          bytesReceived: typeof j.bytesReceived === 'number' ? j.bytesReceived : 0,
          bytesTotal: typeof j.bytesTotal === 'number' ? j.bytesTotal : 0,
          status: typeof j.status === 'string' ? j.status : 'downloading'
        }
      }))
      void loadDetail(repoId)
    } catch (e) {
      setErr(String(e))
    } finally {
      setQuickDownloadRepo(null)
    }
  }

  async function loadDetail(id: string): Promise<void> {
    setSelectedModel(id)
    setErr(null)
    try {
      const d = await window.api.hfModelInfo(id)
      setDetail(d as HfModelDetail)
      const gguf = (d as HfModelDetail).siblings?.find((s) => s.path.endsWith('.gguf'))
      if (gguf) setDownloadFile(gguf.path)
    } catch (e) {
      setErr(String(e))
    }
  }

  async function startDownload(): Promise<void> {
    if (!selectedModel || !downloadFile || !destDir) return
    setErr(null)
    try {
      const j = (await window.api.hfDownload({
        repoId: selectedModel,
        revision: 'main',
        filename: downloadFile,
        destDir
      })) as { id: string; progress?: number; bytesReceived?: number; bytesTotal?: number; status?: string }
      setLastJobId(j.id)
      setHfDownloadJobs((prev) => ({
        ...prev,
        [selectedModel]: {
          jobId: j.id,
          progress: typeof j.progress === 'number' ? j.progress : 0,
          bytesReceived: typeof j.bytesReceived === 'number' ? j.bytesReceived : 0,
          bytesTotal: typeof j.bytesTotal === 'number' ? j.bytesTotal : 0,
          status: typeof j.status === 'string' ? j.status : 'downloading'
        }
      }))
    } catch (e) {
      setErr(String(e))
    }
  }

  async function startRuntime(): Promise<void> {
    setErr(null)
    try {
      const s = await window.api.runtimeStart({ kind: runtimeKind, modelPath })
      setRuntimeStatus(s)
      await window.api.setConfig({ llamaBinaryPath: llamaBin, runtimeKind })
    } catch (e) {
      setErr(String(e))
    }
  }

  async function stopRuntime(): Promise<void> {
    const s = await window.api.runtimeStop()
    setRuntimeStatus(s)
  }

  async function applyModelsInstallLocation(dir: string | null): Promise<void> {
    setModelsDirSaveErr(null)
    const oldDefault = paths?.modelsDefault
    const r = await window.api.setConfig({ modelsDir: dir })
    if (!r.ok) {
      setModelsDirSaveErr(r.error ?? 'Could not save')
      return
    }
    const p = await window.api.getPaths()
    setPaths(p)
    setModelsInstallPathDraft(p.modelsDefault)
    setDestDir((d) => (oldDefault && d === oldDefault ? p.modelsDefault : d))
  }

  async function saveModelsInstallLocation(): Promise<void> {
    const t = modelsInstallPathDraft.trim()
    await applyModelsInstallLocation(t ? t : null)
  }

  async function resetModelsInstallToDefault(): Promise<void> {
    await applyModelsInstallLocation(null)
  }

  async function pickModelsInstallFolder(): Promise<void> {
    const picked = await window.api.pickModelsDirectory()
    if (picked) setModelsInstallPathDraft(picked)
  }

  async function sendChat(): Promise<void> {
    if (!convId || !draft.trim()) return
    setErr(null)
    const userText = draft.trim()
    setDraft('')
    await window.api.messageAppend(convId, 'user', userText)
    let context = userText
    if (ragSnippets.length) {
      context =
        'Use the following knowledge snippets when relevant:\n' +
        ragSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n') +
        '\n\nUser question:\n' +
        userText
    }
    const msgs = [...messages.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: context }]
    try {
      const reply = await window.api.runtimeChat(msgs)
      await window.api.messageAppend(convId, 'assistant', reply)
      const m = await window.api.conversationMessages(convId)
      setMessages(m as { role: string; content: string }[])
    } catch (e) {
      setErr(String(e))
    }
  }

  async function newConversation(): Promise<void> {
    const c = (await window.api.conversationCreate()) as { id: string }
    setConvId(c.id)
    setMessages([])
    await loadConversations()
  }

  async function loadConv(id: string): Promise<void> {
    setConvId(id)
    const m = await window.api.conversationMessages(id)
    setMessages(m as { role: string; content: string }[])
  }

  async function runRag(): Promise<void> {
    if (!ragQuery.trim()) return
    setRagLoading(true)
    try {
      const snippets = await window.api.kbSearch(ragQuery, 8)
      setRagSnippets(snippets)
    } finally {
      setRagLoading(false)
    }
  }

  async function openWikiPage(sourceId: string): Promise<void> {
    setWikiSelectedId(sourceId)
    const p = await window.api.kbWikiPage(sourceId)
    setWikiTitle(p.title)
    setWikiBody(p.body)
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendChat()
    }
  }

  const runtimeOn = Boolean(runtimeStatus?.running)
  const topTitle = mainView === 'chat' ? 'Chat' : 'Knowledge wiki'
  const topSub =
    mainView === 'chat'
      ? 'Ground replies with your wiki from the right panel.'
      : 'Browse sources built from files you ingest. Link snippets in chat.'

  return (
    <div className="shell">
      <aside className="nav-rail" aria-label="Primary navigation">
        <div className="nav-brand" title="Local LLM">
          LLM
        </div>
        <nav className="nav-main">
          <button
            type="button"
            className={`nav-btn ${mainView === 'chat' ? 'active' : ''}`}
            onClick={() => setMainView('chat')}
            title="Chat"
          >
            <IconChat />
            Chat
          </button>
          <button
            type="button"
            className={`nav-btn wiki ${mainView === 'wiki' ? 'active' : ''}`}
            onClick={() => {
              setMainView('wiki')
              void loadWiki()
            }}
            title="Wiki"
          >
            <IconBook />
            Wiki
          </button>
        </nav>
        <div className="nav-spacer" />
        <nav className="nav-tools" aria-label="Tools">
          <button type="button" className="nav-btn" onClick={() => setDrawer('hf')} title="Models">
            <IconBox />
            Models
          </button>
          <button type="button" className="nav-btn" onClick={() => setDrawer('runtime')} title="Runtime">
            <IconCpu />
            Run
          </button>
          <button type="button" className="nav-btn" onClick={() => setDrawer('train')} title="Train">
            <IconFlask />
            Train
          </button>
          <button type="button" className="nav-btn" onClick={() => setDrawer('metrics')} title="Metrics">
            <IconActivity />
            Stats
          </button>
          <button type="button" className="nav-btn" onClick={() => setDrawer('settings')} title="Settings">
            <IconGear />
            More
          </button>
        </nav>
      </aside>

      <div className="main-column">
        <header className="top-bar">
          <div>
            <div className="top-bar-title">{topTitle}</div>
            <div className="top-bar-sub">{topSub}</div>
          </div>
          <div className="top-bar-actions">
            <div className="top-bar-pin-group">
              <button
                type="button"
                className={`top-bar-pin ${metricsPinned ? 'active' : ''}`}
                title={metricsPinned ? 'Unpin metrics widget' : 'Pin live metrics widget'}
                onClick={() => {
                  const next = !metricsPinned
                  setMetricsPinned(next)
                  void saveMetricsWidgetConfig({ metricsPinned: next })
                }}
              >
                <IconPin />
                <span className="top-bar-pin-label">{metricsPinned ? 'Metrics' : 'Pin metrics'}</span>
              </button>
              <button
                type="button"
                className={`top-bar-pin ${downloadsPinned ? 'active' : ''}`}
                title={downloadsPinned ? 'Unpin downloads widget' : 'Pin download progress widget'}
                onClick={() => {
                  const next = !downloadsPinned
                  setDownloadsPinned(next)
                  void saveMetricsWidgetConfig({ downloadsPinned: next })
                }}
              >
                <IconPin />
                <span className="top-bar-pin-label">{downloadsPinned ? 'Downloads' : 'Pin downloads'}</span>
              </button>
            </div>
            <div
              className="runtime-pill"
              title={runtimeOn ? 'Runtime connected' : 'Start a runtime from Run'}
              onClick={() => setDrawer('runtime')}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setDrawer('runtime')}
            >
              <span className={`runtime-pill-dot ${runtimeOn ? 'on' : ''}`} />
              {runtimeOn ? 'Runtime on' : 'Runtime off'}
            </div>
          </div>
        </header>

        {err && <div className="err-banner">{err}</div>}

        <div className="workspace">
          {mainView === 'chat' && (
            <div className="chat-layout">
              <aside className="conv-sidebar">
                <div className="conv-sidebar-header">
                  <button type="button" className="btn-new-chat" onClick={() => void newConversation()}>
                    New chat
                  </button>
                </div>
                <div className="conv-list">
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`conv-item ${convId === c.id ? 'active' : ''}`}
                      onClick={() => void loadConv(c.id)}
                    >
                      {c.title || c.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </aside>

              <section className="chat-center" aria-label="Conversation">
                <div className="messages-scroll">
                  {!convId && (
                    <div className="messages-empty">
                      <h2>Start a conversation</h2>
                      <p>Create a new chat, connect your runtime, and optional wiki context appears on the right.</p>
                    </div>
                  )}
                  {convId && messages.length === 0 && (
                    <div className="messages-empty">
                      <h2>Say hello</h2>
                      <p>Messages are saved automatically. Use the wiki panel to pull in knowledge before you send.</p>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`msg-row ${m.role === 'user' ? 'user' : 'assistant'}`}>
                      <div className="msg-bubble">
                        <div className="msg-role">{m.role}</div>
                        {m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <div className="composer-wrap">
                  <div className="rag-inline">
                    <input
                      className="input"
                      placeholder="Search knowledge base…"
                      value={ragQuery}
                      onChange={(e) => setRagQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void runRag()}
                    />
                    <button type="button" className="btn-secondary" onClick={() => void runRag()} disabled={ragLoading}>
                      {ragLoading ? 'Searching…' : 'Pull into chat'}
                    </button>
                    {ragSnippets.length > 0 && <span className="rag-badge">{ragSnippets.length} snippets active</span>}
                  </div>
                  <div className="composer-box">
                    <textarea
                      placeholder={convId ? 'Message… (Enter to send, Shift+Enter for line)' : 'Pick or create a chat first'}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onComposerKeyDown}
                      disabled={!convId}
                      rows={2}
                    />
                    <button
                      type="button"
                      className="btn-send"
                      disabled={!convId || !draft.trim()}
                      onClick={() => void sendChat()}
                      title="Send"
                    >
                      <IconSend />
                    </button>
                  </div>
                </div>
              </section>

              <aside className="kb-sidebar" aria-label="Knowledge snippets">
                <div className="kb-sidebar-header">
                  <h3>Knowledge</h3>
                  <p>Pull matches from your wiki into the next message. Open Wiki to add documents.</p>
                </div>
                <div className="kb-snippet-list">
                  {ragSnippets.length === 0 && <p className="muted" style={{ padding: '8px 4px' }}>No snippets yet — search above.</p>}
                  {ragSnippets.map((s, i) => (
                    <div key={i} className="kb-snippet">
                      <strong>Snippet {i + 1}</strong>
                      <div>{s}</div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          )}

          {mainView === 'wiki' && (
            <div className="wiki-layout">
              <nav className="wiki-nav" aria-label="Wiki topics">
                <div className="wiki-nav-header">
                  <h3>Library</h3>
                  <button
                    type="button"
                    className="btn-ingest"
                    onClick={() => void window.api.kbIngestFile().then(() => void loadWiki())}
                  >
                    + Add document
                  </button>
                </div>
                <div className="wiki-topic-list">
                  {wikiTopics.length === 0 && <p className="muted" style={{ padding: 12 }}>No sources yet. Add a document.</p>}
                  {wikiTopics.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`wiki-topic-btn ${wikiSelectedId === t.id ? 'active' : ''}`}
                      onClick={() => void openWikiPage(t.id)}
                    >
                      {t.title}
                      <span className="wiki-topic-meta">{t.chunkCount} sections indexed</span>
                    </button>
                  ))}
                </div>
              </nav>
              <article className="wiki-article">
                {wikiTitle ? (
                  <>
                    <h1>{wikiTitle}</h1>
                    <p className="wiki-lead">Compiled from your ingested sources. Use Pull into chat from the Chat view to cite this material.</p>
                    <div className="wiki-body wiki-prose">{wikiBody}</div>
                  </>
                ) : (
                  <>
                    <h1>Your wiki</h1>
                    <p className="wiki-lead">Select a topic or add a document. Content is chunked and searchable from Chat.</p>
                  </>
                )}
              </article>
            </div>
          )}
        </div>
      </div>

      {drawer && (
        <>
          <div className="drawer-backdrop" role="presentation" onClick={() => setDrawer(null)} />
          <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
            <div className="drawer-header">
              <h2 id="drawer-title">
                {drawer === 'hf' && 'Model library'}
                {drawer === 'runtime' && 'Inference runtime'}
                {drawer === 'train' && 'Training'}
                {drawer === 'metrics' && 'Metrics'}
                {drawer === 'settings' && 'Settings'}
              </h2>
              <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="drawer-body">
              {drawer === 'hf' && (
                <>
                  <div className="drawer-section">
                    <h3>Search Hugging Face</h3>
                    <div className="row">
                      <input
                        className="input"
                        style={{ flex: 1, minWidth: 160 }}
                        value={hfQuery}
                        onChange={(e) => setHfQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void runHfSearch()}
                      />
                      <button type="button" className="btn-primary" onClick={() => void runHfSearch()} disabled={hfSearchLoading}>
                        {hfSearchLoading ? 'Searching…' : 'Search'}
                      </button>
                    </div>
                  </div>
                  <div className="drawer-section hf-library-section">
                    <div className="hf-library-toolbar">
                      <h3 style={{ margin: 0, flex: 1 }}>
                        {hfLibraryMode === 'search' ? 'Search results' : 'Recommended for local inference'}
                      </h3>
                      {hfLibraryMode === 'search' && (
                        <button type="button" className="btn-secondary" onClick={() => backToRecommendations()}>
                          ← Recommendations
                        </button>
                      )}
                    </div>
                    {hfLibraryMode === 'recommended' && (
                      <p className="muted" style={{ margin: '0 0 12px' }}>
                        Curated GGUF-friendly picks. Click a card for files, or Download to grab the first GGUF (or first file). Search replaces this list until you go back.
                      </p>
                    )}
                    {hfLibraryMode === 'search' && (
                      <p className="muted" style={{ margin: '0 0 12px' }}>
                        Same layout as recommendations. Descriptions load from each model card. Download uses the first <code>.gguf</code> when available.
                      </p>
                    )}
                    {hfListLoading && (
                      <div className="hf-library-loading">
                        {hfLibraryMode === 'search' ? 'Searching and loading descriptions…' : 'Loading recommendations and descriptions…'}
                      </div>
                    )}
                    {!hfListLoading && hfListModels.length === 0 && hfLibraryMode === 'recommended' && (
                      <p className="muted">Could not load recommendations. Check your connection or run a search above.</p>
                    )}
                    {!hfListLoading && hfListModels.length === 0 && hfLibraryMode === 'search' && (
                      <p className="muted">No models matched. Try different keywords or return to recommendations.</p>
                    )}
                    <div className="hf-model-cards-list">
                      {hfListModels.map((m) => {
                        const hfJob = hfDownloadJobs[m.id]
                        const hfPct = hfJob ? hfCardProgressPct(hfJob) : null
                        const hfMeta = hfJob
                          ? hfPct != null
                            ? hfJob.bytesTotal > 0
                              ? `${hfJob.progress}% · ${formatBytes(hfJob.bytesReceived)} / ${formatBytes(hfJob.bytesTotal)}`
                              : `${hfJob.progress}%`
                            : 'Starting…'
                          : undefined
                        return (
                          <div key={m.id} className={`hf-model-card ${selectedModel === m.id ? 'selected' : ''}`}>
                            <button type="button" className="hf-model-card-main" onClick={() => void loadDetail(m.id)}>
                              <div className="hf-model-card-title">{m.id}</div>
                              {m.description ? (
                                <p className="hf-model-card-desc">{m.description}</p>
                              ) : (
                                <p className="hf-model-card-desc hf-model-card-desc--empty">No description on the model card.</p>
                              )}
                            </button>
                            {hfJob ? (
                              <div className="hf-model-card-progress">
                                <DownloadProgressBar compact pct={hfPct} meta={hfMeta} />
                                <div className="hf-model-card-progress-actions">
                                  <button type="button" className="btn-ghost-sm" onClick={() => void cancelDownloadJob(hfJob.jobId)}>
                                    Cancel download
                                  </button>
                                </div>
                              </div>
                            ) : null}
                            <div className="hf-model-card-footer">
                              <span className="hf-model-card-meta">
                                {(m.downloads ?? 0).toLocaleString()} downloads · {m.likes ?? 0} likes
                                {typeof m.totalSizeBytes === 'number' && m.totalSizeBytes > 0
                                  ? ` · ~${formatBytes(m.totalSizeBytes)}`
                                  : ''}
                              </span>
                              <button
                                type="button"
                                className="btn-card-download"
                                disabled={!!hfJob || quickDownloadRepo === m.id}
                                onClick={() => void quickDownloadFromRepo(m.id)}
                              >
                                {hfJob ? 'Downloading…' : quickDownloadRepo === m.id ? 'Preparing…' : 'Download'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className="drawer-section">
                    <h3>Selected model — files &amp; folder</h3>
                    {!detail && <p className="muted">Select a model above to choose a specific file and download folder.</p>}
                    {detail && (
                      <>
                        <p className="muted">{detail.description?.slice(0, 320) ?? '—'}</p>
                        <p className="muted">Total ~{(detail.totalSizeBytes / 1e9).toFixed(2)} GB (file sum)</p>
                        <select className="select" value={downloadFile} onChange={(e) => setDownloadFile(e.target.value)} style={{ marginBottom: 8 }}>
                          <option value="">Choose file</option>
                          {detail.siblings?.map((s) => (
                            <option key={s.path} value={s.path}>
                              {s.path}
                            </option>
                          ))}
                        </select>
                        <input className="input" placeholder="Download folder" value={destDir} onChange={(e) => setDestDir(e.target.value)} style={{ marginBottom: 8 }} />
                        <button type="button" className="btn-primary" onClick={() => void startDownload()}>
                          Download selected file
                        </button>
                        {lastJobId && <p className="muted">Last job: {lastJobId}</p>}
                        {selectedModel && hfDownloadJobs[selectedModel] ? (
                          <div className="hf-detail-download-progress" style={{ marginTop: 12 }}>
                            <DownloadProgressBar
                              compact
                              pct={hfCardProgressPct(hfDownloadJobs[selectedModel])}
                              meta={
                                hfCardProgressPct(hfDownloadJobs[selectedModel]) != null
                                  ? hfDownloadJobs[selectedModel].bytesTotal > 0
                                    ? `${hfDownloadJobs[selectedModel].progress}% · ${formatBytes(hfDownloadJobs[selectedModel].bytesReceived)} / ${formatBytes(hfDownloadJobs[selectedModel].bytesTotal)}`
                                    : `${hfDownloadJobs[selectedModel].progress}%`
                                  : 'Starting…'
                              }
                            />
                            <div className="download-progress-cancel-row">
                              <button
                                type="button"
                                className="btn-ghost-sm"
                                onClick={() => void cancelDownloadJob(hfDownloadJobs[selectedModel].jobId)}
                              >
                                Cancel download
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </>
              )}

              {drawer === 'runtime' && (
                <>
                  <div className="drawer-section">
                    <h3>Backend</h3>
                    <select className="select" value={runtimeKind} onChange={(e) => setRuntimeKind(e.target.value as 'llamacpp' | 'ollama')}>
                      <option value="ollama">Ollama</option>
                      <option value="llamacpp">llama.cpp server</option>
                    </select>
                  </div>
                  <div className="drawer-section">
                    <h3>Model</h3>
                    <input
                      className="input"
                      value={modelPath}
                      onChange={(e) => setModelPath(e.target.value)}
                      placeholder={runtimeKind === 'ollama' ? 'e.g. llama3.2' : 'Path to .gguf'}
                    />
                  </div>
                  <div className="drawer-section">
                    <h3>Local downloads</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Every Hub download tracked in this app (newest first). Use a finished file path with llama.cpp; Ollama uses tags you pull
                      separately (<code className="inline-code">ollama pull …</code>).
                    </p>
                    <p className="muted">
                      Default folder for new downloads:{' '}
                      <span className="runtime-downloads-default-path">{paths?.modelsDefault ?? '—'}</span>{' '}
                      <button type="button" className="btn-ghost-sm" onClick={() => setDrawer('settings')}>
                        Change in Settings
                      </button>
                    </p>
                    {localDownloads.length === 0 ? (
                      <p className="muted">No downloads yet. Open the Hub tool to download a GGUF file.</p>
                    ) : (
                      <ul className="runtime-downloads-list">
                        {localDownloads.map((r) => {
                          const dlPct = downloadRowProgressPct(r)
                          const showDlBar = r.status === 'downloading' || r.status === 'pending'
                          const dlMeta =
                            showDlBar && dlPct != null
                              ? `${dlPct}%${
                                  typeof r.bytes_received === 'number' && Number(r.bytes_total) > 0
                                    ? ` · ${formatBytes(r.bytes_received)} / ${formatBytes(Number(r.bytes_total))}`
                                    : ''
                                }`
                              : showDlBar
                                ? 'Starting…'
                                : undefined
                          return (
                            <li
                              key={r.id}
                              className={`runtime-download-row ${r.status === 'complete' ? '' : 'runtime-download-row-dim'}`}
                            >
                              <div className="runtime-download-row-head">
                                <span className="runtime-download-row-title">{fileNameFromPath(r.local_path)}</span>
                                <div className="runtime-download-row-actions">
                                  <span className={downloadStatusClass(r.status)}>{r.status}</span>
                                  {showDlBar ? (
                                    <button type="button" className="btn-ghost-sm" onClick={() => void cancelDownloadJob(r.id)}>
                                      Cancel
                                    </button>
                                  ) : null}
                                  {r.status === 'complete' ? (
                                    <button
                                      type="button"
                                      className="btn-ghost-sm"
                                      onClick={() => {
                                        setRuntimeKind('llamacpp')
                                        setModelPath(r.local_path)
                                      }}
                                    >
                                      Use path
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {showDlBar ? <DownloadProgressBar pct={dlPct} meta={dlMeta} /> : null}
                              <div className="runtime-download-row-repo muted">{r.repo_id}</div>
                              <div className="runtime-download-row-path">{r.local_path}</div>
                              <div className="runtime-download-row-meta">
                                {formatBytes(Number(r.bytes_total) || 0)}
                                {r.revision ? ` · ${r.revision}` : ''}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                  {runtimeKind === 'llamacpp' && (
                    <div className="drawer-section">
                      <h3>Binary</h3>
                      <input className="input" value={llamaBin} onChange={(e) => setLlamaBin(e.target.value)} placeholder="llama-server path" />
                    </div>
                  )}
                  <div className="row">
                    <button type="button" className="btn-primary" onClick={() => void startRuntime()}>
                      Start
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => void stopRuntime()}>
                      Stop
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => void refreshRunDrawer()}>
                      Refresh status
                    </button>
                  </div>
                  <div className="drawer-section" style={{ marginTop: 16 }}>
                    <h3>Runtime state</h3>
                    {!runtimeStatus && <p className="muted">Loading…</p>}
                    {runtimeStatus && (
                      <>
                        <div className="runtime-status-panel">
                          <div className="runtime-status-row">
                            <span className="runtime-status-label">Status</span>
                            <span
                              className={`runtime-status-value runtime-status-badge ${runtimeStatus.running ? 'on' : 'off'}`}
                            >
                              {runtimeStatus.running ? 'Running' : 'Stopped'}
                            </span>
                          </div>
                          <div className="runtime-status-row">
                            <span className="runtime-status-label">Backend</span>
                            <span className="runtime-status-value">{runtimeKindLabel(runtimeStatus.kind)}</span>
                          </div>
                          {runtimeStatus.endpoint ? (
                            <div className="runtime-status-row">
                              <span className="runtime-status-label">Endpoint</span>
                              <span className="runtime-status-value">{runtimeStatus.endpoint}</span>
                            </div>
                          ) : null}
                          <div className="runtime-status-row">
                            <span className="runtime-status-label">
                              {runtimeStatus.kind === 'ollama' ? 'Model tag' : 'Model'}
                            </span>
                            <span className="runtime-status-value">{runtimeStatus.modelPath || '—'}</span>
                          </div>
                          {typeof runtimeStatus.pid === 'number' ? (
                            <div className="runtime-status-row">
                              <span className="runtime-status-label">Process</span>
                              <span className="runtime-status-value">PID {runtimeStatus.pid}</span>
                            </div>
                          ) : null}
                        </div>
                        {runtimeStatus.lastError ? (
                          <p className="runtime-status-error" role="alert">
                            {runtimeStatus.lastError}
                          </p>
                        ) : null}
                        <details className="runtime-raw-toggle">
                          <summary>Raw status JSON</summary>
                          <pre className="code-block" style={{ marginTop: 8 }}>
                            {JSON.stringify(runtimeStatus, null, 2)}
                          </pre>
                        </details>
                      </>
                    )}
                  </div>
                </>
              )}

              {drawer === 'train' && (
                <>
                  <p className="muted">Optional Python worker. Requires training/train_lora.py.</p>
                  <div className="drawer-section">
                    <h3>Paths</h3>
                    <input className="input" placeholder="Base model path" value={trainBase} onChange={(e) => setTrainBase(e.target.value)} style={{ marginBottom: 8 }} />
                    <input className="input" placeholder="Dataset JSONL" value={trainDataset} onChange={(e) => setTrainDataset(e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      await window.api.trainStart({ baseModelPath: trainBase, datasetPath: trainDataset })
                      setTrainJobs(await window.api.trainListJobs())
                    }}
                  >
                    Start job
                  </button>
                  <pre className="code-block">{JSON.stringify(trainJobs, null, 2)}</pre>
                </>
              )}

              {drawer === 'metrics' && (
                <>
                  {metricsWidgetControls}
                  <p className="muted" style={{ marginTop: 0 }}>
                    History samples are recorded when you open this panel or use Record below. The pinned widget polls without saving each
                    tick.
                  </p>
                  <div className="row" style={{ marginBottom: 16 }}>
                    <button type="button" className="btn-primary" onClick={() => void refreshMetricsBundle()}>
                      Record snapshot &amp; refresh charts
                    </button>
                  </div>
                  {metricsBundle && (
                    <MetricsTimeSeries history={metricsBundle.history} />
                  )}
                  <details className="metrics-raw-toggle">
                    <summary>Raw snapshot JSON</summary>
                    <pre className="code-block" style={{ marginTop: 8 }}>
                      {JSON.stringify(metricsBundle?.snapshot ?? null, null, 2)}
                    </pre>
                  </details>
                </>
              )}

              {drawer === 'settings' && (
                <>
                  {metricsWidgetControls}
                  <div className="drawer-section">
                    <h3>Model install location</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Default folder for new Hugging Face downloads when the Hub leaves the destination as the app default. The folder is created
                      if it does not exist.
                    </p>
                    <input
                      className="input"
                      value={modelsInstallPathDraft}
                      onChange={(e) => setModelsInstallPathDraft(e.target.value)}
                      placeholder="Absolute path to models folder"
                    />
                    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                      <button type="button" className="btn-secondary" onClick={() => void pickModelsInstallFolder()}>
                        Browse…
                      </button>
                      <button type="button" className="btn-primary" onClick={() => void saveModelsInstallLocation()}>
                        Save location
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => void resetModelsInstallToDefault()}>
                        Reset to app default
                      </button>
                    </div>
                    {modelsDirSaveErr ? (
                      <p className="runtime-status-error" style={{ marginTop: 10 }} role="alert">
                        {modelsDirSaveErr}
                      </p>
                    ) : null}
                  </div>
                  <div className="drawer-section">
                    <h3>Hugging Face token</h3>
                    <input
                      type="password"
                      className="input"
                      placeholder="hf_…"
                      value={hfTokenInput}
                      onChange={(e) => setHfTokenInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ marginTop: 8 }}
                      onClick={() => void window.api.setHfToken(hfTokenInput || null).then(() => setHfTokenInput(''))}
                    >
                      Save
                    </button>
                  </div>
                  <div className="drawer-section">
                    <h3>Download cache</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Remove the in-app download registry and cached Hugging Face model metadata from the database. Active downloads are
                      cancelled first. This does not delete model files from your disk.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={downloadCacheClearBusy}
                      onClick={() => void clearDownloadCacheFromSettings()}
                    >
                      {downloadCacheClearBusy ? 'Clearing…' : 'Clear download cache'}
                    </button>
                    {downloadCacheClearMessage ? (
                      <p className="settings-action-success" role="status">
                        {downloadCacheClearMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="drawer-section">
                    <h3>Data paths</h3>
                    <pre className="code-block">{JSON.stringify(paths, null, 2)}</pre>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {metricsPinned && (
        <MetricsPinnedWidget
          snapshot={widgetSnap}
          series={widgetSeries}
          refreshMs={metricsRefreshMs}
          runtimeOn={runtimeOn}
          onUnpin={() => {
            setMetricsPinned(false)
            void saveMetricsWidgetConfig({ metricsPinned: false })
          }}
          onOpenStats={() => setDrawer('metrics')}
        />
      )}
      {downloadsPinned && (
        <DownloadsPinnedWidget
          downloads={pinnedDownloadsSnapshot}
          onUnpin={() => {
            setDownloadsPinned(false)
            void saveMetricsWidgetConfig({ downloadsPinned: false })
          }}
          onOpenRun={() => setDrawer('runtime')}
          onCancelJob={cancelDownloadJob}
        />
      )}
    </div>
  )
}
