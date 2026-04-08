import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  DownloadRow,
  HardwareSummary,
  HfModelDetail,
  HfModelSummary,
  MetricsSnapshot,
  RuntimeLoadProgress,
  RuntimeStatus
} from '@shared/types'
import { evaluateModelForHardware } from '@shared/modelHardwareFit'
import type { ColorSchemeId } from '@shared/colorScheme'
import { COLOR_SCHEME_IDS, COLOR_SCHEME_LABELS, DEFAULT_COLOR_SCHEME, parseColorScheme } from '@shared/colorScheme'
import { DownloadProgressBar, downloadRowProgressPct, fileNameFromPath, formatBytes } from './downloadProgressUi'
import { ActivityPinnedWidget, type ActivityChatTokens } from './ActivityPinnedWidget'
import { ChatRichContent } from './ChatRichContent'
import { DownloadsPinnedWidget } from './DownloadsPinnedWidget'
import { FloatingDots } from './FloatingDots'
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

function applyColorSchemeToDocument(id: ColorSchemeId): void {
  if (id === 'violet') {
    document.documentElement.removeAttribute('data-color-scheme')
  } else {
    document.documentElement.setAttribute('data-color-scheme', id)
  }
}

type MainView = 'chat' | 'wiki'
type ToolDrawer = 'hf' | 'runtime' | 'train' | 'metrics' | 'settings' | null
type HfLibraryMode = 'recommended' | 'search'
type HfModelSortKey = 'downloads' | 'likes' | 'size'

const HF_RECOMMENDED_FETCH_LIMIT = 72

const LS_SLIDE_CONV_W = 'slideConvWidthPx'
const LS_SLIDE_KB_W = 'slideKbWidthPx'
const SLIDE_CONV_MIN = 220
const SLIDE_CONV_DEFAULT = 300
const SLIDE_KB_MIN = 240
const SLIDE_KB_DEFAULT = 320

function readSlideWidthPx(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const n = parseInt(localStorage.getItem(key) ?? '', 10)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function clampSlideConv(px: number): number {
  const max = Math.max(SLIDE_CONV_MIN, Math.floor(window.innerWidth * 0.92))
  return Math.min(Math.max(Math.round(px), SLIDE_CONV_MIN), max)
}

function clampSlideKb(px: number): number {
  const max = Math.max(SLIDE_KB_MIN, Math.floor(window.innerWidth * 0.92))
  return Math.min(Math.max(Math.round(px), SLIDE_KB_MIN), max)
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (): void => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

const LLAMA_CPP_RELEASES_URL = 'https://github.com/ggerganov/llama.cpp/releases'
const LLAMA_CPP_SERVER_DOC_URL = 'https://github.com/ggerganov/llama.cpp/blob/master/tools/server/README.md'

type LlamaEnvInfo = {
  detected: boolean
  resolvedPath: string
  configuredValid: boolean
}

type OllamaHostStatus = {
  reachable: boolean
  baseUrl: string
}

function huggingFaceModelUrl(repoId: string): string {
  return `https://huggingface.co/${repoId.split('/').map(encodeURIComponent).join('/')}`
}

function parseNonNegativeInt(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function parseNonNegativeFloat(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = parseFloat(t)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

type PinnedWidgetsSide = 'left' | 'right' | 'top' | 'bottom'

function parsePinnedWidgetsSide(raw: unknown): PinnedWidgetsSide {
  if (raw === 'left' || raw === 'right' || raw === 'top' || raw === 'bottom') return raw
  return 'left'
}

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
  const [llamaEnv, setLlamaEnv] = useState<LlamaEnvInfo | null>(null)
  const [ollamaHost, setOllamaHost] = useState<OllamaHostStatus | null>(null)
  const [ollamaInstallBusy, setOllamaInstallBusy] = useState(false)
  const [ollamaInstallNote, setOllamaInstallNote] = useState<string | null>(null)
  const [ollamaInstallNoteKind, setOllamaInstallNoteKind] = useState<'success' | 'info' | 'error' | null>(null)
  const [ollamaInstallLog, setOllamaInstallLog] = useState<string[]>([])
  const ollamaInstallLogRef = useRef<HTMLPreElement>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [localDownloads, setLocalDownloads] = useState<DownloadRow[]>([])
  const [localModelFilePaths, setLocalModelFilePaths] = useState<string[]>([])

  const matchedLocalModelPath = useMemo(() => {
    const cur = modelPath.trim()
    if (!cur || localModelFilePaths.length === 0) return ''
    const win = paths?.platform === 'win32'
    return (
      localModelFilePaths.find((p) => (win ? p.toLowerCase() === cur.toLowerCase() : p === cur)) ?? ''
    )
  }, [localModelFilePaths, modelPath, paths?.platform])

  const localModelDefaultSyncRef = useRef<{ kind: typeof runtimeKind; localLen: number }>({
    kind: runtimeKind,
    localLen: 0
  })

  useEffect(() => {
    const prev = localModelDefaultSyncRef.current
    const switchedToLlama = prev.kind !== 'llamacpp' && runtimeKind === 'llamacpp'
    const listBecameAvailable = prev.localLen === 0 && localModelFilePaths.length > 0
    localModelDefaultSyncRef.current = {
      kind: runtimeKind,
      localLen: localModelFilePaths.length
    }

    if (runtimeKind !== 'llamacpp') return
    const files = localModelFilePaths
    if (files.length === 0) return

    const win = paths?.platform === 'win32'
    const cur = modelPath.trim()
    const matched = files.some((p) => (win ? p.toLowerCase() === cur.toLowerCase() : p === cur))
    if (matched) return
    if (switchedToLlama || listBecameAvailable) {
      setModelPath(files[0])
    }
  }, [runtimeKind, localModelFilePaths, paths?.platform, modelPath])

  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null)
  const [deleteConvRemoveKb, setDeleteConvRemoveKb] = useState(false)
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [saveChatKbBusy, setSaveChatKbBusy] = useState(false)
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
  const [hfSortBy, setHfSortBy] = useState<HfModelSortKey>('downloads')
  const [hfSortDir, setHfSortDir] = useState<'asc' | 'desc'>('desc')
  const [hfFilterMinLikes, setHfFilterMinLikes] = useState('')
  const [hfFilterMinDownloads, setHfFilterMinDownloads] = useState('')
  const [hfFilterMaxSizeGb, setHfFilterMaxSizeGb] = useState('')
  const [quickDownloadRepo, setQuickDownloadRepo] = useState<string | null>(null)
  const [trainJobs, setTrainJobs] = useState<unknown[]>([])
  const [trainBase, setTrainBase] = useState('')
  const [trainDataset, setTrainDataset] = useState('')
  const [hfTokenInput, setHfTokenInput] = useState('')
  const [colorScheme, setColorScheme] = useState<ColorSchemeId>(DEFAULT_COLOR_SCHEME)
  const [modelsInstallPathDraft, setModelsInstallPathDraft] = useState('')
  const [modelsDirSaveErr, setModelsDirSaveErr] = useState<string | null>(null)
  const [settingsMaintenanceBusy, setSettingsMaintenanceBusy] = useState<
    false | 'caches' | 'models' | 'factory'
  >(false)
  const [settingsMaintenanceMessage, setSettingsMaintenanceMessage] = useState<string | null>(null)
  const [settingsConfirmKind, setSettingsConfirmKind] = useState<null | 'caches' | 'models' | 'factory'>(
    null
  )
  const [hfDownloadJobs, setHfDownloadJobs] = useState<Record<string, HfCardDownloadState>>({})
  const hfDownloadJobsRef = useRef(hfDownloadJobs)
  hfDownloadJobsRef.current = hfDownloadJobs

  const [hardwareSummary, setHardwareSummary] = useState<HardwareSummary | null>(null)

  /** Slide-over panels for chat (narrow / medium breakpoints). */
  const [mobileConvOpen, setMobileConvOpen] = useState(false)
  const [mobileKbOpen, setMobileKbOpen] = useState(false)
  const narrowSlideConv = useMediaQuery('(max-width: 720px)')
  const narrowSlideKb = useMediaQuery('(max-width: 1100px)')
  const [slideConvWidthPx, setSlideConvWidthPx] = useState(() =>
    readSlideWidthPx(LS_SLIDE_CONV_W, SLIDE_CONV_DEFAULT)
  )
  const [slideKbWidthPx, setSlideKbWidthPx] = useState(() =>
    readSlideWidthPx(LS_SLIDE_KB_W, SLIDE_KB_DEFAULT)
  )
  const [slidePanelResizing, setSlidePanelResizing] = useState<null | 'conv' | 'kb'>(null)
  const convWRef = useRef(slideConvWidthPx)
  const kbWRef = useRef(slideKbWidthPx)

  useEffect(() => {
    convWRef.current = slideConvWidthPx
  }, [slideConvWidthPx])

  useEffect(() => {
    kbWRef.current = slideKbWidthPx
  }, [slideKbWidthPx])

  useEffect(() => {
    const onResize = (): void => {
      setSlideConvWidthPx((w) => clampSlideConv(w))
      setSlideKbWidthPx((w) => clampSlideKb(w))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!slidePanelResizing) return
    const kind = slidePanelResizing
    const onMove = (e: PointerEvent): void => {
      if (kind === 'conv') {
        const v = clampSlideConv(e.clientX)
        convWRef.current = v
        setSlideConvWidthPx(v)
      } else {
        const v = clampSlideKb(window.innerWidth - e.clientX)
        kbWRef.current = v
        setSlideKbWidthPx(v)
      }
    }
    const onUp = (): void => {
      try {
        if (kind === 'conv') localStorage.setItem(LS_SLIDE_CONV_W, String(convWRef.current))
        else localStorage.setItem(LS_SLIDE_KB_W, String(kbWRef.current))
      } catch {
        /* ignore */
      }
      setSlidePanelResizing(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [slidePanelResizing])

  const [metricsPinned, setMetricsPinned] = useState(false)
  const [downloadsPinned, setDownloadsPinned] = useState(false)
  const [activityPinned, setActivityPinned] = useState(false)
  const [runtimeLoadProgress, setRuntimeLoadProgress] = useState<RuntimeLoadProgress | null>(null)
  const [runtimeStarting, setRuntimeStarting] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [chatStreamBuffer, setChatStreamBuffer] = useState('')
  const [activityChatTokens, setActivityChatTokens] = useState<ActivityChatTokens | null>(null)
  const [pinnedWidgetsSide, setPinnedWidgetsSide] = useState<PinnedWidgetsSide>('left')
  const [pinnedDownloadsSnapshot, setPinnedDownloadsSnapshot] = useState<DownloadRow[]>([])
  const [metricsRefreshMs, setMetricsRefreshMs] = useState(3000)
  const [metricsRefreshCustomMode, setMetricsRefreshCustomMode] = useState(false)
  const [metricsCustomSec, setMetricsCustomSec] = useState('')
  const [widgetSnap, setWidgetSnap] = useState<MetricsSnapshot | null>(null)
  const [widgetSeries, setWidgetSeries] = useState<MetricsSnapshot[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!chatSending && !chatStreamBuffer) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chatSending, chatStreamBuffer])

  const refreshPaths = useCallback(async () => {
    const p = await window.api.getPaths()
    setPaths(p)
    setDestDir((d) => d || p.modelsDefault)
  }, [])

  const loadConversations = useCallback(async () => {
    const c = await window.api.conversationsList()
    setConversations(c as { id: string; title: string }[])
  }, [])

  const cancelRenameConv = useCallback(() => {
    setRenamingConvId(null)
    setRenameDraft('')
  }, [])

  const commitRenameConv = useCallback(async () => {
    if (!renamingConvId) return
    const id = renamingConvId
    const title = renameDraft.trim() || 'New chat'
    setErr(null)
    try {
      await window.api.conversationRename(id, title)
      cancelRenameConv()
      await loadConversations()
    } catch (e) {
      setErr(String(e))
    }
  }, [renamingConvId, renameDraft, loadConversations, cancelRenameConv])

  useLayoutEffect(() => {
    if (!renamingConvId) return
    const el = renameInputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [renamingConvId])

  const loadWiki = useCallback(async () => {
    const t = await window.api.kbWikiTopics()
    setWikiTopics(t as { id: string; title: string; chunkCount: number }[])
  }, [])

  useEffect(() => {
    if (deleteConvId) setDeleteConvRemoveKb(false)
  }, [deleteConvId])

  useEffect(() => {
    if (!deleteConvId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDeleteConvId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteConvId])

  const refreshRuntimeStatus = useCallback(async () => {
    const s = await window.api.runtimeStatus()
    setRuntimeStatus(s)
  }, [])

  const applyRuntimeInstallPaths = useCallback(
    (c: Awaited<ReturnType<typeof window.api.runtimeInstallPath>>) => {
      setLlamaEnv({
        detected: c.llamaDetected,
        resolvedPath: c.llamaResolvedPath || '',
        configuredValid: c.llamaConfiguredPathValid
      })
      setOllamaHost({ reachable: c.ollamaReachable, baseUrl: c.ollamaBase })
    },
    []
  )

  const refreshRunDrawerQuick = useCallback(async () => {
    const [s, downloads, install] = await Promise.all([
      window.api.runtimeStatus(),
      window.api.downloadsList(),
      window.api.runtimeInstallPath()
    ])
    setRuntimeStatus(s)
    setLocalDownloads(downloads)
    applyRuntimeInstallPaths(install)
  }, [applyRuntimeInstallPaths])

  const refreshLocalModelFiles = useCallback(async () => {
    try {
      const r = await window.api.listLocalModelsInDownloadDir()
      setLocalModelFilePaths(r.paths)
    } catch {
      setLocalModelFilePaths([])
    }
  }, [])

  const refreshRunDrawer = useCallback(async () => {
    await refreshRunDrawerQuick()
    await refreshLocalModelFiles()
  }, [refreshRunDrawerQuick, refreshLocalModelFiles])

  const runOllamaInstall = useCallback(async () => {
    const maxLogLines = 120
    setOllamaInstallBusy(true)
    setOllamaInstallNote(null)
    setOllamaInstallNoteKind(null)
    setOllamaInstallLog([])
    const unsub = window.api.onOllamaInstallProgress(({ message }) => {
      setOllamaInstallLog((prev) => {
        const next = [...prev, message]
        return next.length > maxLogLines ? next.slice(-maxLogLines) : next
      })
    })
    try {
      const r = await window.api.installOllama()
      if (r.ok) {
        if ('needsManualFinish' in r) {
          setOllamaInstallNote(r.hint)
          setOllamaInstallNoteKind('info')
        } else {
          setOllamaInstallNote(r.detail ?? 'Ollama is ready to use with this app.')
          setOllamaInstallNoteKind('success')
        }
      } else {
        setOllamaInstallNote(r.error)
        setOllamaInstallNoteKind('error')
      }
      await refreshRunDrawer()
    } catch (e) {
      setOllamaInstallNote(e instanceof Error ? e.message : String(e))
      setOllamaInstallNoteKind('error')
    } finally {
      unsub()
      setOllamaInstallBusy(false)
    }
  }, [refreshRunDrawer])

  useEffect(() => {
    if (ollamaHost?.reachable) {
      setOllamaInstallNote(null)
      setOllamaInstallNoteKind(null)
      setOllamaInstallLog([])
    }
  }, [ollamaHost?.reachable])

  useEffect(() => {
    return window.api.onRuntimeLoadProgress((p) => {
      setRuntimeLoadProgress(p)
    })
  }, [])

  useEffect(() => {
    if (ollamaInstallLog.length === 0 || !ollamaInstallLogRef.current) return
    const el = ollamaInstallLogRef.current
    el.scrollTop = el.scrollHeight
  }, [ollamaInstallLog])

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

  const runClearAllCaches = useCallback(async () => {
    setSettingsConfirmKind(null)
    setSettingsMaintenanceMessage(null)
    setErr(null)
    setSettingsMaintenanceBusy('caches')
    try {
      const r = await window.api.clearAllCaches()
      setHfDownloadJobs({})
      setSettingsMaintenanceMessage(
        [
          `Cleared ${r.downloadsRemoved} download registry row(s), ${r.hfCacheRemoved} Hugging Face metadata entr${r.hfCacheRemoved === 1 ? 'y' : 'ies'}, ${r.metricsRemoved} metrics sample(s), ${r.trainJobsRemoved} train job row(s), and ${r.vectorsEntriesCleared} entr${r.vectorsEntriesCleared === 1 ? 'y' : 'ies'} under the vectors folder.`,
          `Stopped ${r.downloadsCancelled} active download job(s) and ${r.trainProcessesKilled} training process(es). Chats, knowledge base, wiki, and model files on disk were not removed.`
        ].join(' ')
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
      setSettingsMaintenanceBusy(false)
    }
  }, [refreshRunDrawer, downloadsPinned])

  const runDeleteAllModels = useCallback(async () => {
    setSettingsConfirmKind(null)
    setSettingsMaintenanceMessage(null)
    setErr(null)
    setSettingsMaintenanceBusy('models')
    try {
      const r = await window.api.deleteAllModels()
      setHfDownloadJobs({})
      setLastJobId(null)
      const failHint =
        r.errors.length > 0 ? ` Some items could not be removed: ${r.errors.slice(0, 4).join(' · ')}` : ''
      setSettingsMaintenanceMessage(
        `Deleted ${r.removed} top-level item(s) from the models folder. Removed ${r.downloadsRemoved} download registry row(s).${failHint}`
      )
      void refreshPaths()
      void refreshRuntimeStatus()
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
      setSettingsMaintenanceBusy(false)
    }
  }, [refreshRunDrawer, downloadsPinned, refreshPaths, refreshRuntimeStatus])

  const runResetFactoryConfig = useCallback(async () => {
    setSettingsConfirmKind(null)
    setErr(null)
    setSettingsMaintenanceBusy('factory')
    try {
      await window.api.resetFactoryConfig()
      window.location.reload()
    } catch (e) {
      setErr(String(e))
      setSettingsMaintenanceBusy(false)
    }
  }, [])

  useEffect(() => {
    const mq720 = window.matchMedia('(min-width: 721px)')
    const mq1100 = window.matchMedia('(min-width: 1101px)')
    const onWide = (): void => {
      if (mq720.matches) setMobileConvOpen(false)
      if (mq1100.matches) setMobileKbOpen(false)
    }
    onWide()
    mq720.addEventListener('change', onWide)
    mq1100.addEventListener('change', onWide)
    return () => {
      mq720.removeEventListener('change', onWide)
      mq1100.removeEventListener('change', onWide)
    }
  }, [])

  useEffect(() => {
    if (mainView !== 'chat') {
      setMobileConvOpen(false)
      setMobileKbOpen(false)
    }
  }, [mainView])

  useEffect(() => {
    void refreshPaths()
    void window.api.runtimeInstallPath().then((c) => {
      const initialBin = c.llamaBinary.trim() ? c.llamaBinary : c.llamaResolvedPath || ''
      setLlamaBin(initialBin)
      applyRuntimeInstallPaths(c)
    })
    void loadConversations()
    void loadWiki()
    void refreshRuntimeStatus()
    void window.api.getConfig().then((c: Record<string, unknown>) => {
      if (typeof c.metricsPinned === 'boolean') setMetricsPinned(c.metricsPinned)
      if (typeof c.downloadsPinned === 'boolean') setDownloadsPinned(c.downloadsPinned)
      if (typeof c.activityPinned === 'boolean') setActivityPinned(c.activityPinned)
      setPinnedWidgetsSide(parsePinnedWidgetsSide(c.pinnedWidgetsSide))
      if (typeof c.metricsRefreshMs === 'number') {
        const ms = clampMetricsRefreshMs(c.metricsRefreshMs)
        setMetricsRefreshMs(ms)
        setMetricsRefreshCustomMode(!(METRICS_REFRESH_PRESETS_MS as readonly number[]).includes(ms))
      }
      const scheme = parseColorScheme(c.colorScheme)
      setColorScheme(scheme)
      applyColorSchemeToDocument(scheme)
    })
  }, [refreshPaths, loadConversations, loadWiki, refreshRuntimeStatus, applyRuntimeInstallPaths])

  useEffect(() => {
    if (runtimeKind !== 'llamacpp' || !llamaEnv?.detected || !llamaEnv.resolvedPath) return
    if (llamaBin.trim()) return
    setLlamaBin(llamaEnv.resolvedPath)
  }, [runtimeKind, llamaEnv?.detected, llamaEnv?.resolvedPath, llamaBin])

  useEffect(() => {
    if (drawer !== 'runtime') return
    void refreshRunDrawer()
    const quickId = window.setInterval(() => void refreshRunDrawerQuick(), 1000)
    const modelsId = window.setInterval(() => void refreshLocalModelFiles(), 4000)
    return () => {
      window.clearInterval(quickId)
      window.clearInterval(modelsId)
    }
  }, [drawer, refreshRunDrawer, refreshRunDrawerQuick, refreshLocalModelFiles])

  useEffect(() => {
    if (drawer !== 'runtime') return
    void refreshLocalModelFiles()
  }, [drawer, paths?.modelsDefault, refreshLocalModelFiles])

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

  const loadMetricsBundle = useCallback(async () => {
    const [snap, hist] = await Promise.all([
      window.api.metricsSnapshot({ persist: true }),
      window.api.metricsHistory(144)
    ])
    return {
      snapshot: snap,
      history: (hist as MetricsSnapshot[]) ?? []
    }
  }, [])

  const refreshMetricsBundle = useCallback(async () => {
    const bundle = await loadMetricsBundle()
    setMetricsBundle(bundle)
  }, [loadMetricsBundle])

  useEffect(() => {
    if (drawer !== 'metrics') return
    let cancelled = false
    const tick = async () => {
      try {
        const bundle = await loadMetricsBundle()
        if (cancelled) return
        setMetricsBundle(bundle)
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
  }, [drawer, metricsRefreshMs, loadMetricsBundle])

  const saveMetricsWidgetConfig = useCallback(
    async (patch: {
      metricsPinned?: boolean
      downloadsPinned?: boolean
      activityPinned?: boolean
      metricsRefreshMs?: number
      pinnedWidgetsSide?: PinnedWidgetsSide
    }) => {
      const body: Record<string, unknown> = {}
      if (patch.metricsPinned !== undefined) body.metricsPinned = patch.metricsPinned
      if (patch.downloadsPinned !== undefined) body.downloadsPinned = patch.downloadsPinned
      if (patch.activityPinned !== undefined) body.activityPinned = patch.activityPinned
      if (patch.metricsRefreshMs !== undefined) body.metricsRefreshMs = clampMetricsRefreshMs(patch.metricsRefreshMs)
      if (patch.pinnedWidgetsSide !== undefined) body.pinnedWidgetsSide = patch.pinnedWidgetsSide
      await window.api.setConfig(body)
    },
    []
  )

  const saveColorScheme = useCallback(async (id: ColorSchemeId) => {
    setColorScheme(id)
    applyColorSchemeToDocument(id)
    await window.api.setConfig({ colorScheme: id })
  }, [])

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
      <h3>Pinned widgets</h3>
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
        <span>Show live metrics in the Pinned widgets panel (does not write to history each tick)</span>
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
        <span>Show Hub download progress in the Pinned widgets panel</span>
      </label>
      <label className="metrics-widget-check" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={activityPinned}
          onChange={(e) => {
            const v = e.target.checked
            setActivityPinned(v)
            void saveMetricsWidgetConfig({ activityPinned: v })
          }}
        />
        <span>Show model load and reply progress in the Pinned widgets panel</span>
      </label>
      <label style={{ display: 'block', marginTop: 16 }}>
        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
          Panel side (when at least one widget is pinned)
        </span>
        <select
          className="select"
          style={{ width: '100%', maxWidth: 320 }}
          value={pinnedWidgetsSide}
          onChange={(e) => {
            const v = parsePinnedWidgetsSide(e.target.value)
            setPinnedWidgetsSide(v)
            void saveMetricsWidgetConfig({ pinnedWidgetsSide: v })
          }}
        >
          <option value="left">Left — beside the nav rail</option>
          <option value="right">Right — after the main content</option>
          <option value="top">Top — above the main content</option>
          <option value="bottom">Bottom — below the main content</option>
        </select>
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
    if (drawer === 'train') void window.api.trainListJobs().then(setTrainJobs)
    if (drawer === 'hf') {
      setHfLibraryMode('recommended')
      setHfResults([])
      setHfSearchLoading(false)
      setSelectedModel(null)
      setDetail(null)
      setRecommendedLoading(true)
      void window.api
        .hfRecommended(HF_RECOMMENDED_FETCH_LIMIT)
        .then((r) => setRecommendedModels(r as HfModelSummary[]))
        .catch(() => setRecommendedModels([]))
        .finally(() => setRecommendedLoading(false))
    }
  }, [drawer])

  useEffect(() => {
    if (drawer !== 'hf') return
    let cancelled = false
    void window.api.hardwareSummary(destDir.trim() || undefined).then((h) => {
      if (!cancelled) setHardwareSummary(h)
    })
    return () => {
      cancelled = true
    }
  }, [drawer, destDir])

  const hfSelectedFileSizeBytes = useMemo(() => {
    if (!detail || !downloadFile) return undefined
    const s = detail.siblings?.find((x) => x.path === downloadFile)?.size
    return s != null && s > 0 ? s : undefined
  }, [detail, downloadFile])

  const hfHardwareEval = useMemo(() => {
    if (!hardwareSummary) return null
    return evaluateModelForHardware(hfSelectedFileSizeBytes, hardwareSummary, {
      fileSelectedSizeMissing: Boolean(downloadFile) && hfSelectedFileSizeBytes == null
    })
  }, [hardwareSummary, hfSelectedFileSizeBytes, downloadFile])

  const hfListModels = hfLibraryMode === 'search' ? hfResults : recommendedModels
  const hfListLoading = hfLibraryMode === 'search' ? hfSearchLoading : recommendedLoading

  const hfDisplayModels = useMemo(() => {
    let rows = hfListModels.slice()
    const minLikes = parseNonNegativeInt(hfFilterMinLikes)
    if (minLikes != null) rows = rows.filter((m) => (m.likes ?? 0) >= minLikes)
    const minDl = parseNonNegativeInt(hfFilterMinDownloads)
    if (minDl != null) rows = rows.filter((m) => (m.downloads ?? 0) >= minDl)
    const maxGb = parseNonNegativeFloat(hfFilterMaxSizeGb)
    if (maxGb != null) {
      const maxBytes = maxGb * 1024 ** 3
      rows = rows.filter((m) => {
        const s = m.totalSizeBytes
        return s != null && s > 0 && s <= maxBytes
      })
    }
    const dir = hfSortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const tie = a.id.localeCompare(b.id)
      if (hfSortBy === 'downloads') {
        const va = a.downloads ?? 0
        const vb = b.downloads ?? 0
        if (va !== vb) return dir * (va - vb)
        return tie
      }
      if (hfSortBy === 'likes') {
        const va = a.likes ?? 0
        const vb = b.likes ?? 0
        if (va !== vb) return dir * (va - vb)
        return tie
      }
      const sa = a.totalSizeBytes
      const sb = b.totalSizeBytes
      const va = sa != null && sa > 0 ? sa : null
      const vb = sb != null && sb > 0 ? sb : null
      if (va == null && vb == null) return tie
      if (va == null) return 1
      if (vb == null) return -1
      if (va !== vb) return dir * (va - vb)
      return tie
    })
    return rows
  }, [hfListModels, hfSortBy, hfSortDir, hfFilterMinLikes, hfFilterMinDownloads, hfFilterMaxSizeGb])

  const hfFiltersActive =
    hfFilterMinLikes.trim() !== '' || hfFilterMinDownloads.trim() !== '' || hfFilterMaxSizeGb.trim() !== ''

  function clearHfListFilters(): void {
    setHfFilterMinLikes('')
    setHfFilterMinDownloads('')
    setHfFilterMaxSizeGb('')
  }

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
    if (runtimeStatus?.running || runtimeStarting) return
    setErr(null)
    setRuntimeStarting(true)
    setRuntimeLoadProgress(null)
    try {
      const s = await window.api.runtimeStart({ kind: runtimeKind, modelPath })
      setRuntimeStatus(s)
      const pathForStore =
        runtimeKind === 'llamacpp'
          ? llamaBin.trim() || llamaEnv?.resolvedPath || ''
          : llamaBin
      await window.api.setConfig({ llamaBinaryPath: pathForStore, runtimeKind })
      if (runtimeKind === 'llamacpp' && pathForStore) setLlamaBin(pathForStore)
      void refreshRunDrawer()
    } catch (e) {
      setErr(String(e))
    } finally {
      setRuntimeStarting(false)
      setRuntimeLoadProgress(null)
    }
  }

  async function stopRuntime(): Promise<void> {
    setErr(null)
    try {
      const s = await window.api.runtimeStop()
      setRuntimeStatus(s)
      void refreshRunDrawer()
    } catch (e) {
      setErr(String(e))
    }
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
    if (!convId || !draft.trim() || chatSending) return
    setErr(null)
    const userText = draft.trim()
    setDraft('')
    await window.api.messageAppend(convId, 'user', userText)
    setMessages((prev) => [...prev, { role: 'user', content: userText }])
    let context = userText
    if (ragSnippets.length) {
      context =
        'Use the following knowledge snippets when relevant:\n' +
        ragSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n') +
        '\n\nUser question:\n' +
        userText
    }
    const historyForApi = messages.map((m) => ({ role: m.role, content: m.content }))
    const msgs = [...historyForApi, { role: 'user' as const, content: context }]
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const totalChars = msgs.reduce((acc, m) => acc + m.content.length, 0)
    const promptTokenEstimate = Math.max(1, Math.ceil(totalChars / 4))
    setChatSending(true)
    setChatStreamBuffer('')
    setActivityChatTokens({
      prompt: promptTokenEstimate,
      completion: 0,
      promptIsEstimate: true,
      completionIsEstimate: true,
    })
    const offChat = window.api.onRuntimeChatProgress((p) => {
      if (p.requestId !== requestId) return
      if (p.kind === 'token' && p.text) {
        const chunk = p.text
        setChatStreamBuffer((prev) => prev + chunk)
        setActivityChatTokens((prev) => {
          if (!prev || !prev.completionIsEstimate) return prev
          const delta = Math.max(1, Math.ceil(chunk.length / 4))
          return { ...prev, completion: prev.completion + delta }
        })
      }
      if (p.kind === 'usage') {
        setActivityChatTokens((prev) => {
          const base =
            prev ??
            ({
              prompt: promptTokenEstimate,
              completion: 0,
              promptIsEstimate: true,
              completionIsEstimate: true,
            } satisfies ActivityChatTokens)
          return {
            prompt: p.promptTokens != null ? p.promptTokens : base.prompt,
            completion: p.completionTokens != null ? p.completionTokens : base.completion,
            promptIsEstimate: p.promptTokens != null ? false : base.promptIsEstimate,
            completionIsEstimate: p.completionTokens != null ? false : base.completionIsEstimate,
          }
        })
      }
    })
    try {
      const reply = await window.api.runtimeChat(msgs, requestId)
      await window.api.messageAppend(convId, 'assistant', reply)
      const m = await window.api.conversationMessages(convId)
      setMessages(m as { role: string; content: string }[])
    } catch (e) {
      setErr(String(e))
    } finally {
      offChat()
      setChatSending(false)
      setChatStreamBuffer('')
      setActivityChatTokens(null)
    }
  }

  async function newConversation(): Promise<void> {
    cancelRenameConv()
    const c = (await window.api.conversationCreate()) as { id: string }
    setConvId(c.id)
    setMessages([])
    setMobileConvOpen(false)
    await loadConversations()
  }

  async function loadConv(id: string): Promise<void> {
    cancelRenameConv()
    setConvId(id)
    setMobileConvOpen(false)
    const m = await window.api.conversationMessages(id)
    setMessages(m as { role: string; content: string }[])
  }

  async function confirmDeleteConversation(): Promise<void> {
    if (!deleteConvId) return
    const id = deleteConvId
    const removeKb = deleteConvRemoveKb
    setErr(null)
    try {
      await window.api.conversationDelete({ id, removeLinkedKnowledge: removeKb })
      setDeleteConvId(null)
      if (convId === id) {
        setConvId(null)
        setMessages([])
      }
      await loadConversations()
      if (removeKb) {
        await loadWiki()
        setWikiSelectedId(null)
        setWikiBody('')
        setWikiTitle('')
      }
    } catch (e) {
      setErr(String(e))
    }
  }

  async function saveCurrentChatToKb(): Promise<void> {
    if (!convId) return
    setSaveChatKbBusy(true)
    setErr(null)
    try {
      await window.api.kbIngestConversation(convId)
      await loadWiki()
    } catch (e) {
      setErr(String(e))
    } finally {
      setSaveChatKbBusy(false)
    }
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
  const assistantResponderLabel = useMemo(() => {
    if (!runtimeStatus?.running) return 'Assistant'
    const raw = runtimeStatus.modelPath?.trim()
    if (!raw) return 'Assistant'
    if (
      runtimeStatus.kind === 'llamacpp' &&
      (raw.includes('/') || raw.includes('\\') || /^[a-zA-Z]:[\\/]/.test(raw))
    ) {
      return fileNameFromPath(raw) || raw
    }
    return raw
  }, [runtimeStatus])
  const topTitle = mainView === 'chat' ? 'Chat' : 'Knowledge wiki'
  const topSub =
    mainView === 'chat'
      ? 'Ground replies with your wiki from the right panel.'
      : 'Browse sources built from files you ingest. Link snippets in chat.'

  return (
    <div className="shell">
      <aside className="nav-rail" aria-label="Primary navigation">
        <div className="nav-brand" title="Local LLM Desktop">
          <img src="/app-icon.png" alt="" width={44} height={44} decoding="async" />
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

      <div className={`shell-content shell-content--pinned-${pinnedWidgetsSide}`}>
        {(metricsPinned || downloadsPinned || activityPinned) && (
          <aside className="pinned-widgets-aside" aria-label="Pinned widgets">
            <div className="pinned-widgets-aside-header">
              <span className="pinned-widgets-aside-title">Pinned widgets</span>
              <div className="pinned-widgets-dock-symbols" role="group" aria-label="Widget bar position">
                {(
                  [
                    { side: 'left' as const, icon: 'fa-arrow-left', title: 'Dock bar on the left (beside nav)' },
                    { side: 'right' as const, icon: 'fa-arrow-right', title: 'Dock bar on the right (after main)' },
                    { side: 'top' as const, icon: 'fa-arrow-up', title: 'Dock bar on top (above main)' },
                    { side: 'bottom' as const, icon: 'fa-arrow-down', title: 'Dock bar on the bottom (below main)' }
                  ] as const
                ).map(({ side, icon, title }) => (
                  <button
                    key={side}
                    type="button"
                    className={`pinned-widgets-dock-btn ${pinnedWidgetsSide === side ? 'pinned-widgets-dock-btn--active' : ''}`}
                    title={title}
                    aria-label={title}
                    aria-pressed={pinnedWidgetsSide === side}
                    onClick={() => {
                      setPinnedWidgetsSide(side)
                      void saveMetricsWidgetConfig({ pinnedWidgetsSide: side })
                    }}
                  >
                    <i className={`fa-solid ${icon}`} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
            <div className="pinned-widgets-aside-body">
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
              {activityPinned && (
                <ActivityPinnedWidget
                  modelLoad={
                    runtimeStarting
                      ? (runtimeLoadProgress ?? { phase: 'starting', message: 'Starting runtime…' })
                      : null
                  }
                  chatSending={chatSending}
                  chatTokens={activityChatTokens}
                  onUnpin={() => {
                    setActivityPinned(false)
                    void saveMetricsWidgetConfig({ activityPinned: false })
                  }}
                  onOpenChat={() => {
                    setMainView('chat')
                    setMobileConvOpen(false)
                    setMobileKbOpen(false)
                  }}
                />
              )}
            </div>
          </aside>
        )}
        <div className="main-column">
        <header className="top-bar">
          <div>
            <div className="top-bar-title">{topTitle}</div>
            <div className="top-bar-sub">{topSub}</div>
          </div>
          <div className="top-bar-actions">
            {mainView === 'chat' && (
              <>
                <button
                  type="button"
                  className="top-bar-mobile-toggle top-bar-mobile-toggle--conv"
                  aria-expanded={mobileConvOpen}
                  onClick={() => {
                    setMobileKbOpen(false)
                    setMobileConvOpen((o) => !o)
                  }}
                >
                  Chats
                </button>
                <button
                  type="button"
                  className="top-bar-mobile-toggle top-bar-mobile-toggle--kb"
                  aria-expanded={mobileKbOpen}
                  onClick={() => {
                    setMobileConvOpen(false)
                    setMobileKbOpen((o) => !o)
                  }}
                >
                  Knowledge
                </button>
              </>
            )}
            <div className="top-bar-pin-group">
              <button
                type="button"
                className={`top-bar-pin ${metricsPinned ? 'active' : ''}`}
                title={metricsPinned ? 'Unpin metrics from sidebar' : 'Pin live metrics to Pinned widgets panel'}
                onClick={() => {
                  const next = !metricsPinned
                  setMetricsPinned(next)
                  void saveMetricsWidgetConfig({ metricsPinned: next })
                }}
              >
                <span className="top-bar-pin-icon" aria-hidden>
                  <i className="fa-solid fa-thumbtack" />
                </span>
                <span className="top-bar-pin-label">{metricsPinned ? 'Metrics' : 'Pin metrics'}</span>
              </button>
              <button
                type="button"
                className={`top-bar-pin ${downloadsPinned ? 'active' : ''}`}
                title={downloadsPinned ? 'Unpin downloads from sidebar' : 'Pin download progress to Pinned widgets panel'}
                onClick={() => {
                  const next = !downloadsPinned
                  setDownloadsPinned(next)
                  void saveMetricsWidgetConfig({ downloadsPinned: next })
                }}
              >
                <span className="top-bar-pin-icon" aria-hidden>
                  <i className="fa-solid fa-thumbtack" />
                </span>
                <span className="top-bar-pin-label">{downloadsPinned ? 'Downloads' : 'Pin downloads'}</span>
              </button>
              <button
                type="button"
                className={`top-bar-pin ${activityPinned ? 'active' : ''}`}
                title={
                  activityPinned
                    ? 'Unpin activity from sidebar'
                    : 'Pin model load & reply progress to Pinned widgets panel'
                }
                onClick={() => {
                  const next = !activityPinned
                  setActivityPinned(next)
                  void saveMetricsWidgetConfig({ activityPinned: next })
                }}
              >
                <span className="top-bar-pin-icon" aria-hidden>
                  <i className="fa-solid fa-thumbtack" />
                </span>
                <span className="top-bar-pin-label">{activityPinned ? 'Activity' : 'Pin activity'}</span>
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

        {deleteConvId && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-conv-title"
            onClick={() => setDeleteConvId(null)}
          >
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h2 id="delete-conv-title" className="modal-title">
                Delete this chat?
              </h2>
              <p className="muted modal-text">
                The conversation and its messages will be removed from this device. This cannot be undone.
              </p>
              <label className="modal-check">
                <input
                  type="checkbox"
                  checked={deleteConvRemoveKb}
                  onChange={(e) => setDeleteConvRemoveKb(e.target.checked)}
                />
                <span>Also delete knowledge base content saved from this chat (via &quot;Save chat to knowledge base&quot;)</span>
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setDeleteConvId(null)}>
                  Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => void confirmDeleteConversation()}>
                  Delete chat
                </button>
              </div>
            </div>
          </div>
        )}

        {settingsConfirmKind && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-destructive-title"
            onClick={() => setSettingsConfirmKind(null)}
          >
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h2 id="settings-destructive-title" className="modal-title">
                {settingsConfirmKind === 'caches' && 'Clear all caches?'}
                {settingsConfirmKind === 'models' && 'Delete all model files?'}
                {settingsConfirmKind === 'factory' && 'Reset settings to factory defaults?'}
              </h2>
              {settingsConfirmKind === 'caches' ? (
                <p className="muted modal-text">
                  This cancels active downloads, clears the download registry and Hugging Face metadata cache in the database, wipes metrics history and training job records, and deletes files under the vectors index folder. Your conversations, knowledge base, wiki pages, and downloaded model weight files are kept.
                </p>
              ) : null}
              {settingsConfirmKind === 'models' ? (
                <p className="muted modal-text">
                  Stops the runtime and cancels active downloads, then permanently deletes every file and folder inside your current models directory (
                  <code className="inline-code">{paths?.modelsDefault ?? '—'}</code>
                  ). The download registry is cleared. This cannot be undone.
                </p>
              ) : null}
              {settingsConfirmKind === 'factory' ? (
                <p className="muted modal-text">
                  Stops the runtime and cancels in-flight downloads. All saved settings (including custom models folder, llama binary path, Ollama URL, ports, and pinned widgets) return to defaults, and your Hugging Face token is removed from this device. Chats, knowledge base, wiki, caches, and model files are not changed by this action alone.
                </p>
              ) : null}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setSettingsConfirmKind(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={settingsMaintenanceBusy !== false}
                  onClick={() => {
                    if (settingsConfirmKind === 'caches') void runClearAllCaches()
                    else if (settingsConfirmKind === 'models') void runDeleteAllModels()
                    else void runResetFactoryConfig()
                  }}
                >
                  {settingsConfirmKind === 'caches' && 'Clear caches'}
                  {settingsConfirmKind === 'models' && 'Delete models'}
                  {settingsConfirmKind === 'factory' && 'Reset settings'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="workspace">
          {mainView === 'chat' && (
            <div
              className="chat-layout"
              style={
                {
                  ['--slide-conv-width' as string]: `${slideConvWidthPx}px`,
                  ['--slide-kb-width' as string]: `${slideKbWidthPx}px`
                } as React.CSSProperties
              }
            >
              {(mobileConvOpen || mobileKbOpen) && (
                <div
                  className="chat-sidebar-backdrop"
                  role="presentation"
                  aria-hidden
                  onClick={() => {
                    setMobileConvOpen(false)
                    setMobileKbOpen(false)
                  }}
                />
              )}
              <aside
                className={`conv-sidebar ${mobileConvOpen ? 'conv-sidebar--open' : ''} ${slidePanelResizing === 'conv' ? 'slide-panel--resizing' : ''}`}
              >
                <div className="conv-sidebar-header">
                  <div className="conv-sidebar-header-row">
                    <button type="button" className="btn-new-chat" onClick={() => void newConversation()}>
                      New chat
                    </button>
                    <button
                      type="button"
                      className="conv-sidebar-close btn-ghost-sm"
                      aria-label="Close chat list"
                      onClick={() => setMobileConvOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
                <div className="conv-list">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`conv-item-row ${renamingConvId === c.id ? 'conv-item-row--editing' : ''}`}
                    >
                      {renamingConvId === c.id ? (
                        <>
                          <input
                            ref={renameInputRef}
                            type="text"
                            className="conv-item-rename-input"
                            value={renameDraft}
                            maxLength={512}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void commitRenameConv()
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelRenameConv()
                              }
                            }}
                            aria-label="Rename chat"
                          />
                          <button
                            type="button"
                            className="conv-item-rename-action conv-item-rename-action--save"
                            title="Save name"
                            aria-label="Save chat name"
                            onClick={() => void commitRenameConv()}
                          >
                            <i className="fa-solid fa-check" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="conv-item-rename-action conv-item-rename-action--cancel"
                            title="Cancel"
                            aria-label="Cancel rename"
                            onClick={cancelRenameConv}
                          >
                            <i className="fa-solid fa-xmark" aria-hidden />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`conv-item ${convId === c.id ? 'active' : ''}`}
                            onClick={() => void loadConv(c.id)}
                          >
                            {c.title || c.id.slice(0, 8)}
                          </button>
                          <button
                            type="button"
                            className="conv-item-rename"
                            title="Rename chat"
                            aria-label={`Rename chat ${c.title || c.id.slice(0, 8)}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setRenamingConvId(c.id)
                              setRenameDraft(c.title || '')
                            }}
                          >
                            <i className="fa-solid fa-pen" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="conv-item-delete"
                            title="Delete chat"
                            aria-label={`Delete chat ${c.title || c.id.slice(0, 8)}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteConvId(c.id)
                            }}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {narrowSlideConv && mobileConvOpen ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize chat list width"
                    className="slide-panel-resize-handle slide-panel-resize-handle--from-left-panel"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const v = clampSlideConv(e.clientX)
                      convWRef.current = v
                      setSlideConvWidthPx(v)
                      setSlidePanelResizing('conv')
                    }}
                  />
                ) : null}
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
                        <div
                          className="msg-role"
                          title={
                            m.role === 'assistant' && runtimeStatus?.running && runtimeStatus.modelPath
                              ? runtimeStatus.modelPath
                              : undefined
                          }
                        >
                          {m.role === 'assistant'
                            ? assistantResponderLabel
                            : m.role === 'user'
                              ? 'you'
                              : m.role}
                        </div>
                        <ChatRichContent content={m.content} />
                      </div>
                    </div>
                  ))}
                  {chatSending ? (
                    <div className="msg-row assistant">
                      <div className="msg-bubble msg-bubble--streaming">
                        <div
                          className="msg-role"
                          title={
                            runtimeStatus?.running && runtimeStatus.modelPath
                              ? runtimeStatus.modelPath
                              : undefined
                          }
                        >
                          {assistantResponderLabel}
                        </div>
                        {chatStreamBuffer ? (
                          <ChatRichContent content={chatStreamBuffer} plainStreaming />
                        ) : (
                          <FloatingDots label="Generating reply" />
                        )}
                      </div>
                    </div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>

                <div className="composer-wrap">
                  {chatSending ? (
                    <div className="chat-generating-floater" aria-live="polite">
                      <FloatingDots label="Generating reply" />
                      <span className="chat-generating-floater-label">
                        {chatStreamBuffer ? 'Streaming reply…' : 'Waiting for reply…'}
                      </span>
                    </div>
                  ) : null}
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
                  {convId && messages.length > 0 && (
                    <div className="save-chat-kb-row">
                      <button
                        type="button"
                        className="btn-secondary btn-save-chat-kb"
                        disabled={saveChatKbBusy}
                        onClick={() => void saveCurrentChatToKb()}
                        title="Adds this thread as a wiki source so it can be removed with the chat if you choose"
                      >
                        {saveChatKbBusy ? 'Saving…' : 'Save chat to knowledge base'}
                      </button>
                    </div>
                  )}
                  <div className="composer-box">
                    <textarea
                      placeholder={convId ? 'Message… (Enter to send, Shift+Enter for line)' : 'Pick or create a chat first'}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onComposerKeyDown}
                      disabled={!convId || chatSending}
                      rows={2}
                    />
                    <button
                      type="button"
                      className="btn-send"
                      disabled={!convId || !draft.trim() || chatSending}
                      onClick={() => void sendChat()}
                      title="Send"
                    >
                      <IconSend />
                    </button>
                  </div>
                </div>
              </section>

              <aside
                className={`kb-sidebar ${mobileKbOpen ? 'kb-sidebar--open' : ''} ${slidePanelResizing === 'kb' ? 'slide-panel--resizing' : ''}`}
                aria-label="Knowledge snippets"
              >
                {narrowSlideKb && mobileKbOpen ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize knowledge panel width"
                    className="slide-panel-resize-handle slide-panel-resize-handle--from-right-panel"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const v = clampSlideKb(window.innerWidth - e.clientX)
                      kbWRef.current = v
                      setSlideKbWidthPx(v)
                      setSlidePanelResizing('kb')
                    }}
                  />
                ) : null}
                <div className="kb-sidebar-header">
                  <div className="kb-sidebar-header-row">
                    <h3>Knowledge</h3>
                    <button
                      type="button"
                      className="kb-sidebar-close btn-ghost-sm"
                      aria-label="Close knowledge panel"
                      onClick={() => setMobileKbOpen(false)}
                    >
                      Done
                    </button>
                  </div>
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
                        Curated GGUF-friendly picks. Sort and filter by likes, downloads, or total repo size. Click a card for files, or Download to grab the first GGUF (or first file). Search replaces this list until you go back.
                      </p>
                    )}
                    {hfLibraryMode === 'search' && (
                      <p className="muted" style={{ margin: '0 0 12px' }}>
                        Same layout as recommendations. Sort and filter apply to this result set. Download uses the first <code>.gguf</code> when available.
                      </p>
                    )}
                    <div className="hf-library-filters" aria-label="Sort and filter models">
                      <div className="hf-library-filters-grid">
                        <label className="hf-library-filter-field">
                          <span className="hf-library-filter-label">Sort by</span>
                          <select
                            className="select"
                            value={hfSortBy}
                            onChange={(e) => setHfSortBy(e.target.value as HfModelSortKey)}
                          >
                            <option value="downloads">Downloads</option>
                            <option value="likes">Likes</option>
                            <option value="size">Model size (repo total)</option>
                          </select>
                        </label>
                        <label className="hf-library-filter-field">
                          <span className="hf-library-filter-label">Order</span>
                          <select
                            className="select"
                            value={hfSortDir}
                            onChange={(e) => setHfSortDir(e.target.value as 'asc' | 'desc')}
                          >
                            <option value="desc">High → low</option>
                            <option value="asc">Low → high</option>
                          </select>
                        </label>
                        <label className="hf-library-filter-field">
                          <span className="hf-library-filter-label">Min likes</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            step={1}
                            placeholder="Any"
                            value={hfFilterMinLikes}
                            onChange={(e) => setHfFilterMinLikes(e.target.value)}
                          />
                        </label>
                        <label className="hf-library-filter-field">
                          <span className="hf-library-filter-label">Min downloads</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            step={1}
                            placeholder="Any"
                            value={hfFilterMinDownloads}
                            onChange={(e) => setHfFilterMinDownloads(e.target.value)}
                          />
                        </label>
                        <label className="hf-library-filter-field">
                          <span className="hf-library-filter-label">Max size (GiB)</span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            step={0.1}
                            placeholder="Any"
                            value={hfFilterMaxSizeGb}
                            onChange={(e) => setHfFilterMaxSizeGb(e.target.value)}
                          />
                        </label>
                        {hfFiltersActive && (
                          <div className="hf-library-filter-actions">
                            <button type="button" className="btn-secondary" onClick={clearHfListFilters}>
                              Clear filters
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="muted hf-library-filters-hint">
                        Size uses the summed file sizes from the Hub listing when available; models without a size are omitted when a max size filter is set, and sort by size lists them last.
                      </p>
                    </div>
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
                    {!hfListLoading && hfListModels.length > 0 && hfDisplayModels.length === 0 && (
                      <p className="muted">No models match the current filters. Clear filters or relax thresholds.</p>
                    )}
                    <div className="hf-model-cards-list">
                      {hfDisplayModels.map((m) => {
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
                              {m.description ? <p className="hf-model-card-desc">{m.description}</p> : null}
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
                              <div className="hf-model-card-footer-info">
                                <span className="hf-model-card-meta">
                                  {(m.downloads ?? 0).toLocaleString()} downloads · {m.likes ?? 0} likes
                                  {typeof m.totalSizeBytes === 'number' && m.totalSizeBytes > 0
                                    ? ` · ~${formatBytes(m.totalSizeBytes)}`
                                    : ''}
                                </span>
                                <a
                                  href={huggingFaceModelUrl(m.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hf-model-card-hub-link"
                                >
                                  View on Hugging Face
                                </a>
                              </div>
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
                        {hfHardwareEval ? (
                          <div
                            className={`hf-model-fit hf-model-fit--${hfHardwareEval.verdict}`}
                            role="status"
                          >
                            <p className="hf-model-fit-title">This machine vs selected file</p>
                            <p className="hf-model-fit-headline">{hfHardwareEval.headline}</p>
                            <ul className="hf-model-fit-notes">
                              {hfHardwareEval.notes.map((n, i) => (
                                <li key={i}>{n}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="muted hf-model-fit-loading">Checking this machine…</p>
                        )}
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
                    <div className="runtime-ollama-probe" role="status">
                      <div className="runtime-ollama-probe-row">
                        <span className="runtime-ollama-probe-label">Ollama on host</span>
                        {ollamaHost == null ? (
                          <span className="muted runtime-ollama-probe-pending">Checking…</span>
                        ) : (
                          <>
                            <span
                              className={`runtime-ollama-probe-mark ${ollamaHost.reachable ? 'runtime-ollama-probe-mark--ok' : 'runtime-ollama-probe-mark--bad'}`}
                              aria-label={ollamaHost.reachable ? 'Ollama reachable' : 'Ollama not reachable'}
                              title={ollamaHost.reachable ? 'Daemon responds at configured URL' : 'No Ollama API at configured URL'}
                            >
                              {ollamaHost.reachable ? '✓' : '✗'}
                            </span>
                            <code className="inline-code runtime-ollama-probe-url">{ollamaHost.baseUrl}</code>
                          </>
                        )}
                      </div>
                      {ollamaHost != null && !ollamaHost.reachable && (
                        <div className="runtime-ollama-install">
                          <p className="muted runtime-ollama-install-disclosure">
                            Ollama is third-party software from{' '}
                            <button type="button" className="btn-link-inline" onClick={() => void window.api.openExternalUrl('https://ollama.com/')}>
                              ollama.com
                            </button>
                            . Install Ollama downloads the official script from ollama.com and runs it (PowerShell on Windows,{' '}
                            <code className="inline-code">install.sh</code> on macOS and Linux). This app stays pointed at{' '}
                            <code className="inline-code">{ollamaHost.baseUrl}</code>.
                          </p>
                          <div className="runtime-ollama-install-actions">
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={ollamaInstallBusy}
                              onClick={() => void runOllamaInstall()}
                            >
                              {ollamaInstallBusy ? 'Installing…' : 'Install Ollama'}
                            </button>
                          </div>
                          {(ollamaInstallBusy || ollamaInstallLog.length > 0) && (
                            <div className="runtime-ollama-install-progress" aria-live="polite" aria-label="Installation progress">
                              <div className="runtime-ollama-install-progress-head">
                                {ollamaInstallBusy ? 'Installation progress' : 'Last install output'}
                              </div>
                              <pre ref={ollamaInstallLogRef} className="runtime-ollama-install-log" tabIndex={0}>
                                {ollamaInstallLog.length === 0
                                  ? ollamaInstallBusy
                                    ? 'Starting…'
                                    : ''
                                  : ollamaInstallLog.join('\n')}
                              </pre>
                            </div>
                          )}
                          {ollamaInstallNote ? (
                            <p
                              className={`runtime-ollama-install-note${
                                ollamaInstallNoteKind === 'error'
                                  ? ' runtime-ollama-install-note--error'
                                  : ollamaInstallNoteKind === 'success'
                                    ? ' runtime-ollama-install-note--success'
                                    : ollamaInstallNoteKind === 'info'
                                      ? ' runtime-ollama-install-note--info'
                                      : ''
                              }`}
                              role="status"
                            >
                              {ollamaInstallNote}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                  {runtimeKind === 'llamacpp' && llamaEnv && !llamaEnv.detected && (
                    <div className="runtime-llama-setup-banner" role="status">
                      <p className="runtime-llama-setup-banner-title">llama-server not detected</p>
                      <p className="muted" style={{ margin: '0 0 12px' }}>
                        Install a release build, put <code className="inline-code">llama-server</code> on your PATH, or enter the full path under Binary below.
                      </p>
                      <div className="runtime-llama-setup-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void window.api.openExternalUrl(LLAMA_CPP_RELEASES_URL)}
                        >
                          Open llama.cpp releases
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void window.api.openExternalUrl(LLAMA_CPP_SERVER_DOC_URL)}
                        >
                          Server docs
                        </button>
                      </div>
                    </div>
                  )}
                  {runtimeKind === 'llamacpp' && llamaEnv?.detected && !llamaEnv.configuredValid && llamaEnv.resolvedPath ? (
                    <p className="muted runtime-llama-path-note">
                      No saved binary path on disk; using{' '}
                      <code className="inline-code">{llamaEnv.resolvedPath}</code> from PATH. Save by pressing Start or paste a path under Binary.
                    </p>
                  ) : null}
                  <div className="drawer-section">
                    <h3>Model</h3>
                    <label className="runtime-local-models-label" htmlFor="runtime-local-model-select">
                      Download folder <span className="runtime-local-models-dir">({paths?.modelsDefault ?? '—'})</span>
                    </label>
                    <select
                      id="runtime-local-model-select"
                      className="select runtime-local-model-select"
                      aria-label="Choose a downloaded GGUF model file"
                      value={matchedLocalModelPath}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) setModelPath(v)
                      }}
                    >
                      <option value="">
                        {localModelFilePaths.length === 0
                          ? '— No .gguf files in folder —'
                          : '— Custom path or Ollama tag (below) —'}
                      </option>
                      {localModelFilePaths.map((p) => (
                        <option key={p} value={p} title={p}>
                          {fileNameFromPath(p)}
                        </option>
                      ))}
                    </select>
                    <input
                      id="runtime-model-path-input"
                      className="input runtime-model-path-input"
                      value={modelPath}
                      onChange={(e) => setModelPath(e.target.value)}
                      placeholder={runtimeKind === 'ollama' ? 'e.g. llama3.2' : 'Path to .gguf'}
                      aria-label={runtimeKind === 'ollama' ? 'Ollama model tag' : 'Path to model weights'}
                    />
                    <p className="muted runtime-model-hint">
                      {runtimeKind === 'ollama'
                        ? 'Ollama expects a model tag. If it is not on disk yet, Start will run ollama pull for that tag (can take a while). The list above is .gguf files for llama.cpp only.'
                        : 'Pick from the list or paste a full path. Subfolders are scanned.'}
                    </p>
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
                      {llamaEnv?.detected && llamaEnv.configuredValid ? (
                        <p className="muted runtime-llama-ok">llama-server binary path found.</p>
                      ) : null}
                      <input className="input" value={llamaBin} onChange={(e) => setLlamaBin(e.target.value)} placeholder="llama-server path" />
                    </div>
                  )}
                  {runtimeStarting ? (
                    <div className="runtime-load-progress-banner" role="status" aria-live="polite">
                      {runtimeLoadProgress?.percent != null ? (
                        <div className="runtime-load-progress-bar">
                          <div
                            className="runtime-load-progress-bar-fill"
                            style={{
                              width: `${Math.min(100, Math.max(0, runtimeLoadProgress.percent))}%`
                            }}
                          />
                        </div>
                      ) : null}
                      <p className="runtime-load-progress-message">
                        {runtimeLoadProgress?.message ?? 'Starting runtime…'}
                      </p>
                    </div>
                  ) : null}
                  <div className="row">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={runtimeStarting}
                      onClick={() => void startRuntime()}
                    >
                      {runtimeStarting ? 'Starting…' : 'Start'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={runtimeStarting}
                      onClick={() => void stopRuntime()}
                    >
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
                    While this panel is open, a snapshot is saved and charts refresh every <strong>{formatRefreshLabel(metricsRefreshMs)}</strong>{' '}
                    (same as Pinned widgets; adjust there). The pinned panel polls without writing history each tick.
                  </p>
                  <div className="row" style={{ marginBottom: 16 }}>
                    <button type="button" className="btn-primary" onClick={() => void refreshMetricsBundle()}>
                      Record snapshot &amp; refresh now
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
                  <div className="drawer-section">
                    <h3>Appearance</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Accent palette for buttons, highlights, and chat accents. Secondary panels use a light glass treatment so the backdrop shows
                      through.
                    </p>
                    <label style={{ display: 'block', marginTop: 12 }}>
                      <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                        Color scheme
                      </span>
                      <select
                        className="select"
                        style={{ width: '100%', maxWidth: 320 }}
                        value={colorScheme}
                        onChange={(e) => void saveColorScheme(parseColorScheme(e.target.value))}
                      >
                        {COLOR_SCHEME_IDS.map((id) => (
                          <option key={id} value={id}>
                            {COLOR_SCHEME_LABELS[id]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
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
                    <h3>Caches, models, and reset</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Destructive actions are confirmed in a dialog. Use them when troubleshooting or reclaiming disk space.
                    </p>
                    <div className="settings-danger-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={settingsMaintenanceBusy !== false}
                        onClick={() => setSettingsConfirmKind('caches')}
                      >
                        {settingsMaintenanceBusy === 'caches' ? 'Working…' : 'Clear all caches'}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={settingsMaintenanceBusy !== false}
                        onClick={() => setSettingsConfirmKind('models')}
                      >
                        {settingsMaintenanceBusy === 'models' ? 'Deleting…' : 'Delete all models'}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={settingsMaintenanceBusy !== false}
                        onClick={() => setSettingsConfirmKind('factory')}
                      >
                        {settingsMaintenanceBusy === 'factory' ? 'Resetting…' : 'Reset settings to defaults'}
                      </button>
                    </div>
                    {settingsMaintenanceMessage ? (
                      <p className="settings-action-success" role="status">
                        {settingsMaintenanceMessage}
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
    </div>
  )
}
