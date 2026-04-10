import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import type {
  DownloadRow,
  HardwareSummary,
  HfModelDetail,
  HfModelSummary,
  KbSearchHit,
  KnowledgeGraphPayload,
  MetricsSnapshot,
  PluginIntegrationReport,
  RuntimeLoadProgress,
  RuntimeStatus,
  WikiChatHighlightTerm,
  WikiGlossaryEntry,
  WikiRelatedSource,
  WikiSourceKind,
  WikiTopic
} from '@shared/types'
import { evaluateModelForHardware } from '@shared/modelHardwareFit'
import type { ColorSchemeId } from '@shared/colorScheme'
import { COLOR_SCHEME_IDS, COLOR_SCHEME_LABELS, DEFAULT_COLOR_SCHEME, parseColorScheme } from '@shared/colorScheme'
import {
  appendJournalTexts,
  defaultModelProfile,
  loadModelProfile,
  mergePersonalityPatches,
  MODEL_PROFILE_SYSTEM_PROMPT,
  profileStorageKey,
  saveModelProfile,
  stripModelProfileMarkers,
  stripPartialProfileStreamTail,
  type ModelProfile,
  type ModelPersonalityVibe
} from '@shared/modelPersonality'
import { DownloadProgressBar, downloadRowProgressPct, fileNameFromPath, formatBytes } from './downloadProgressUi'
import { ActivityPinnedWidget, type ActivityChatTokens } from './ActivityPinnedWidget'
import type { ActivityTokenHistoryPoint } from './ActivityTokenSessionChart'
import { ChatRichContent } from './ChatRichContent'
import { DownloadsPinnedWidget } from './DownloadsPinnedWidget'
import { FloatingDots } from './FloatingDots'
import { ModelPresenceBackdrop } from './ModelPresenceBackdrop'
import { MetricsTimeSeries } from './MetricsTimeSeries'
import { MetricsPinnedWidget } from './MetricsPinnedWidget'
import { KnowledgeGraphView } from './KnowledgeGraphView'
import { buildWikiTocGroupsFromRoot, WikiArticleTocNav, type WikiTocGroup } from './WikiArticleToc'

function WikiEntryRemoveButton(props: { ariaLabel: string; onPress: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="wiki-entry-remove"
      aria-label={props.ariaLabel}
      title="Remove from wiki"
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        props.onPress()
      }}
    >
      <i className="fa-solid fa-trash-can" aria-hidden />
    </button>
  )
}

const WIKI_KIND_ORDER: WikiSourceKind[] = ['document', 'extracted_note', 'saved_chat', 'other']
const WIKI_KIND_LABELS: Record<WikiSourceKind, string> = {
  document: 'Documents',
  extracted_note: 'Chat notes',
  saved_chat: 'Saved chats',
  other: 'Other'
}

function groupWikiTopicsByKind(topics: WikiTopic[]): Map<WikiSourceKind, WikiTopic[]> {
  const m = new Map<WikiSourceKind, WikiTopic[]>()
  for (const k of WIKI_KIND_ORDER) m.set(k, [])
  for (const t of topics) {
    const bucket = m.get(t.kind) ?? m.get('other')!
    bucket.push(t)
  }
  return m
}

const METRICS_REFRESH_PRESETS_MS = [
  1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 3_600_000
] as const

/** Poll interval for the ambient model-presence backdrop (tokens / CPU / context). */
const BACKDROP_METRICS_MS = 1200

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
type PinnedWidgetsSide = 'left' | 'right' | 'top' | 'bottom'

const HF_RECOMMENDED_FETCH_LIMIT = 72

const LS_SLIDE_CONV_W = 'slideConvWidthPx'
const LS_SLIDE_KB_W = 'slideKbWidthPx'
const LS_SLIDE_CONV_EDGE = 'slideConvEdge'
const LS_SLIDE_KB_EDGE = 'slideKbEdge'
const SLIDE_CONV_MIN = 220
const SLIDE_CONV_DEFAULT = 300
const SLIDE_KB_MIN = 240
const SLIDE_KB_DEFAULT = 320

type SlidePanelEdge = 'left' | 'right'

function readSlideWidthPx(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const n = parseInt(localStorage.getItem(key) ?? '', 10)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function readSlideEdge(key: string, fallback: SlidePanelEdge): SlidePanelEdge {
  if (typeof window === 'undefined') return fallback
  try {
    const v = localStorage.getItem(key)
    if (v === 'left' || v === 'right') return v
  } catch {
    /* ignore */
  }
  return fallback
}

function persistSlideEdge(key: string, edge: SlidePanelEdge): void {
  try {
    localStorage.setItem(key, edge)
  } catch {
    /* ignore */
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

const PINNED_W_MIN = 200
const PINNED_W_DEFAULT = 308
const PINNED_H_MIN = 140
const PINNED_H_DEFAULT = 360

function clampPinnedWidth(px: number): number {
  const max = Math.max(PINNED_W_MIN + 40, Math.floor(window.innerWidth * 0.58))
  return Math.min(Math.max(Math.round(px), PINNED_W_MIN), max)
}

function clampPinnedHeight(px: number): number {
  const max = Math.max(PINNED_H_MIN + 40, Math.min(620, Math.floor(window.innerHeight * 0.65)))
  return Math.min(Math.max(Math.round(px), PINNED_H_MIN), max)
}

const CHAT_MAX_TOKENS_MIN = 1
const CHAT_MAX_TOKENS_MAX = 262_144
const CHAT_MAX_TOKENS_DEFAULT = 512

function clampChatMaxTokens(n: number): number {
  if (!Number.isFinite(n)) return CHAT_MAX_TOKENS_DEFAULT
  return Math.min(CHAT_MAX_TOKENS_MAX, Math.max(CHAT_MAX_TOKENS_MIN, Math.floor(n)))
}

const INTEGRATION_PORT_DEFAULT = 17373

function clampIntegrationPort(n: number): number {
  if (!Number.isFinite(n)) return INTEGRATION_PORT_DEFAULT
  return Math.min(65535, Math.max(1024, Math.floor(n)))
}

function pinnedWidgetsAsideStyle(
  narrowStack: boolean,
  side: PinnedWidgetsSide,
  widthPx: number,
  heightPx: number
): React.CSSProperties {
  if (narrowStack && (side === 'left' || side === 'right')) {
    return { width: '100%', maxHeight: clampPinnedHeight(heightPx) }
  }
  if (side === 'left' || side === 'right') {
    return { width: clampPinnedWidth(widthPx) }
  }
  return {
    width: '100%',
    height: clampPinnedHeight(heightPx),
    maxHeight: clampPinnedHeight(heightPx)
  }
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

function parsePinnedWidgetsSide(raw: unknown): PinnedWidgetsSide {
  if (raw === 'left' || raw === 'right' || raw === 'top' || raw === 'bottom') return raw
  return 'left'
}

function runtimeKindLabel(kind: RuntimeStatus['kind']): string {
  if (kind === 'ollama') return 'Ollama'
  if (kind === 'llamacpp') return 'llama.cpp server'
  return 'None'
}

const MODEL_PROFILE_VIBE_LABELS: { key: keyof ModelPersonalityVibe; label: string }[] = [
  { key: 'warmth', label: 'Warmth' },
  { key: 'energy', label: 'Energy' },
  { key: 'playfulness', label: 'Playfulness' },
  { key: 'calm', label: 'Calm' },
  { key: 'expressiveness', label: 'Expressiveness' },
  { key: 'hueShift', label: 'Hue shift' }
]

/** Chat row in the viewport (may omit DB-only fields while a user message is optimistic). */
type ChatMessageVm = {
  id?: string
  role: string
  content: string
  /** Unix ms from DB or client when the message was stored / sent. */
  createdAt?: number
  promptTokens?: number | null
  completionTokens?: number | null
  promptTokensIsEstimate?: boolean | null
  completionTokensIsEstimate?: boolean | null
}

function charTokenEst(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4))
}

function bubbleTokenLine(m: ChatMessageVm): string {
  const r = m.role
  if (r === 'user') {
    if (m.promptTokens != null && Number.isFinite(m.promptTokens)) {
      const n = Math.round(m.promptTokens)
      return `${m.promptTokensIsEstimate ? 'Sent ~' : 'Sent '}${n} tok`
    }
    return `Sent ~${charTokenEst(m.content)} tok`
  }
  if (r === 'assistant') {
    if (m.completionTokens != null && Number.isFinite(m.completionTokens)) {
      const n = Math.round(m.completionTokens)
      return `${m.completionTokensIsEstimate ? 'Generated ~' : 'Generated '}${n} tok`
    }
    return `Generated ~${charTokenEst(m.content)} tok`
  }
  return `~${charTokenEst(m.content)} tok`
}

function streamingTokenFoot(tokens: ActivityChatTokens): string {
  const fmt = (n: number, est: boolean) => `${est ? '~' : ''}${Math.max(0, Math.round(n))}`
  return `Sent ${fmt(tokens.prompt, tokens.promptIsEstimate)} tok · Generated ${fmt(tokens.completion, tokens.completionIsEstimate)} tok`
}

/** Compact time for chat bubbles; full date in `title` via native <time>. */
function formatChatTimestamp(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const sameYear = d.getFullYear() === now.getFullYear()
  if (sameYear) {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function chatTimeTitle(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'medium'
  })
}

function looksLikeLocalModelFilePath(s: string): boolean {
  return s.includes('/') || s.includes('\\') || /^[a-zA-Z]:[\\/]/.test(s)
}

function localModelPathsEqual(a: string, b: string, winPlatform: boolean): boolean {
  const na = a.trim().replace(/\\/g, '/')
  const nb = b.trim().replace(/\\/g, '/')
  return winPlatform ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/** True if `want` matches an Ollama tags list entry (exact tag, same base name, or `want:` prefix). */
function ollamaRegistryTagInstalled(tags: readonly string[], want: string): boolean {
  const w = want.trim()
  if (!w) return false
  return tags.some((name) => {
    const base = name.split(':')[0] ?? ''
    return name === w || name.startsWith(`${w}:`) || base === w
  })
}

/** Hugging Face model id (or custom label) saved on download; shown as chat author when that file is loaded. */
function chatAuthorLabelForModelPath(
  modelPath: string | undefined,
  downloads: DownloadRow[],
  winPlatform: boolean
): string | null {
  const raw = modelPath?.trim()
  if (!raw || !looksLikeLocalModelFilePath(raw)) return null
  for (const d of downloads) {
    const label = d.chat_display_name?.trim()
    if (!label) continue
    if (localModelPathsEqual(d.local_path, raw, winPlatform)) return label
  }
  return null
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

/** Pinned widget bar docked on the left (narrow strip beside main). */
function IconDockLeft(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="11" height="16" rx="1.5" />
    </svg>
  )
}

function IconDockRight(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="11" height="16" rx="1.5" />
      <rect x="16" y="4" width="5" height="16" rx="1.5" />
    </svg>
  )
}

function IconDockTop(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <rect x="3" y="11" width="18" height="9" rx="1.5" />
    </svg>
  )
}

function IconDockBottom(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="9" rx="1.5" />
      <rect x="3" y="15" width="18" height="5" rx="1.5" />
    </svg>
  )
}

export default function App(): React.ReactElement {
  const [mainView, setMainView] = useState<MainView>('chat')
  const [drawer, setDrawer] = useState<ToolDrawer>(null)

  const [paths, setPaths] = useState<Awaited<ReturnType<typeof window.api.getPaths>> | null>(null)
  const winPlatform = paths?.platform === 'win32'
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
  const [ollamaChatTags, setOllamaChatTags] = useState<string[]>([])
  const [ollamaChatTagsLoading, setOllamaChatTagsLoading] = useState(false)
  const [ollamaChatTagsErr, setOllamaChatTagsErr] = useState<string | null>(null)
  const [localGgufDeleteMarks, setLocalGgufDeleteMarks] = useState<string[]>([])
  const [ollamaDeleteMarks, setOllamaDeleteMarks] = useState<string[]>([])
  const [modelPurgeBusy, setModelPurgeBusy] = useState(false)
  const matchedLocalModelPath = useMemo(() => {
    const cur = modelPath.trim()
    if (!cur || localModelFilePaths.length === 0) return ''
    return (
      localModelFilePaths.find((p) => (winPlatform ? p.toLowerCase() === cur.toLowerCase() : p === cur)) ?? ''
    )
  }, [localModelFilePaths, modelPath, winPlatform])

  /** Include the runtime’s model when it isn’t in the scanned folder list yet. */
  const topBarLlamaModelPathOptions = useMemo(() => {
    const base = localModelFilePaths
    const loaded =
      runtimeStatus?.running &&
      runtimeKind === 'llamacpp' &&
      runtimeStatus?.kind === 'llamacpp' &&
      runtimeStatus.modelPath?.trim()
        ? runtimeStatus.modelPath.trim()
        : ''
    if (!loaded) return base
    if (base.some((p) => localModelPathsEqual(p, loaded, winPlatform))) return base
    return [loaded, ...base]
  }, [
    localModelFilePaths,
    runtimeStatus?.running,
    runtimeStatus?.kind,
    runtimeStatus?.modelPath,
    runtimeKind,
    winPlatform
  ])

  /** Include the loaded Ollama tag when it isn’t returned by list yet. */
  const topBarOllamaModelOptions = useMemo(() => {
    const base = ollamaChatTags
    const loaded =
      runtimeStatus?.running &&
      runtimeKind === 'ollama' &&
      runtimeStatus?.kind === 'ollama' &&
      runtimeStatus.modelPath?.trim()
        ? runtimeStatus.modelPath.trim()
        : ''
    if (!loaded) return base
    if (base.includes(loaded)) return base
    return [loaded, ...base]
  }, [ollamaChatTags, runtimeStatus?.running, runtimeStatus?.kind, runtimeStatus?.modelPath, runtimeKind])

  const runtimeOn = Boolean(runtimeStatus?.running)

  const topBarModelSelectValue = useMemo(() => {
    const cur = modelPath.trim()
    if (runtimeKind === 'llamacpp') {
      if (runtimeOn && runtimeStatus?.modelPath?.trim()) {
        const loaded = runtimeStatus.modelPath.trim()
        for (const p of topBarLlamaModelPathOptions) {
          if (localModelPathsEqual(p, loaded, winPlatform)) return p
        }
        return loaded
      }
      return matchedLocalModelPath || ''
    }
    if (runtimeKind === 'ollama') {
      if (runtimeOn && runtimeStatus?.modelPath?.trim()) {
        return runtimeStatus.modelPath.trim()
      }
      return cur && ollamaChatTags.includes(cur) ? cur : ''
    }
    return ''
  }, [
    runtimeKind,
    matchedLocalModelPath,
    modelPath,
    ollamaChatTags,
    runtimeOn,
    runtimeStatus?.modelPath,
    topBarLlamaModelPathOptions,
    winPlatform
  ])

  useEffect(() => {
    setLocalGgufDeleteMarks([])
    setOllamaDeleteMarks([])
  }, [runtimeKind])

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
    if (runtimeStatus?.running) return
    const files = localModelFilePaths
    if (files.length === 0) return

    const win = paths?.platform === 'win32'
    const cur = modelPath.trim()
    const matched = files.some((p) => (win ? p.toLowerCase() === cur.toLowerCase() : p === cur))
    if (matched) return
    if (switchedToLlama || listBecameAvailable) {
      setModelPath(files[0])
      return
    }
    if (cur) {
      setModelPath(files[0])
    }
  }, [runtimeKind, localModelFilePaths, paths?.platform, modelPath, runtimeStatus?.running])

  useEffect(() => {
    if (runtimeKind !== 'ollama') return
    if (ollamaChatTagsLoading) return

    const tags = ollamaChatTags
    const cur = modelPath.trim()
    const loaded = runtimeStatus?.running ? runtimeStatus.modelPath?.trim() ?? '' : ''

    if (tags.length === 0) {
      if (!runtimeStatus?.running && cur) setModelPath('')
      return
    }

    if (!cur) return
    if (tags.includes(cur)) return
    if (loaded && cur === loaded) return
    if (runtimeStatus?.running) return
    setModelPath(tags[0])
  }, [runtimeKind, ollamaChatTags, ollamaChatTagsLoading, modelPath, runtimeStatus?.running, runtimeStatus?.modelPath])

  /** Keep the model field aligned with the running server so the top-bar list shows the loaded model. */
  useEffect(() => {
    if (!runtimeStatus?.running || !runtimeStatus.modelPath?.trim()) return
    if (runtimeStatus.kind !== 'ollama' && runtimeStatus.kind !== 'llamacpp') return
    if (runtimeStatus.kind !== runtimeKind) return
    const mp = runtimeStatus.modelPath.trim()
    const cur = modelPath.trim()
    if (runtimeKind === 'llamacpp') {
      if (localModelPathsEqual(cur, mp, winPlatform)) return
    } else if (cur === mp) {
      return
    }
    setModelPath(mp)
  }, [
    runtimeStatus?.running,
    runtimeStatus?.modelPath,
    runtimeStatus?.kind,
    runtimeKind,
    modelPath,
    winPlatform
  ])

  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null)
  const [deleteConvRemoveKb, setDeleteConvRemoveKb] = useState(false)
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [saveChatKbBusy, setSaveChatKbBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessageVm[]>([])
  const [draft, setDraft] = useState('')
  const [ragQuery, setRagQuery] = useState('')
  const [ragSnippets, setRagSnippets] = useState<string[]>([])
  const [ragLoading, setRagLoading] = useState(false)
  const [ragSuggestHits, setRagSuggestHits] = useState<KbSearchHit[]>([])
  const [ragSuggestFocused, setRagSuggestFocused] = useState(false)
  const [ragSuggestActive, setRagSuggestActive] = useState(-1)
  const ragSuggestSeqRef = useRef(0)

  const [wikiTopics, setWikiTopics] = useState<WikiTopic[]>([])
  const [wikiHighlightTerms, setWikiHighlightTerms] = useState<WikiChatHighlightTerm[]>([])
  const [wikiBody, setWikiBody] = useState('')
  const [wikiTitle, setWikiTitle] = useState('')
  const [wikiGlossary, setWikiGlossary] = useState<WikiGlossaryEntry[]>([])
  const [wikiRelated, setWikiRelated] = useState<WikiRelatedSource[]>([])
  const [wikiSelectedId, setWikiSelectedId] = useState<string | null>(null)
  const [wikiDeletePending, setWikiDeletePending] = useState<{ id: string; title: string } | null>(null)
  const [wikiSearchQuery, setWikiSearchQuery] = useState('')
  const [wikiSearchHits, setWikiSearchHits] = useState<KbSearchHit[]>([])
  const [wikiSearchBusy, setWikiSearchBusy] = useState(false)
  const [wikiExportBusy, setWikiExportBusy] = useState(false)
  const [wikiTocGroups, setWikiTocGroups] = useState<WikiTocGroup[]>([])
  const wikiSearchSeqRef = useRef(0)
  const [kgPayload, setKgPayload] = useState<KnowledgeGraphPayload | null>(null)
  const [kgLoading, setKgLoading] = useState(false)

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
  const [hfOllamaPullRepoId, setHfOllamaPullRepoId] = useState<string | null>(null)
  const [hfOllamaPullBusy, setHfOllamaPullBusy] = useState(false)
  const [hfOllamaPullProgress, setHfOllamaPullProgress] = useState<RuntimeLoadProgress | null>(null)
  const [ollamaHubPullNameDraft, setOllamaHubPullNameDraft] = useState('')
  const [trainJobs, setTrainJobs] = useState<unknown[]>([])
  const [trainBase, setTrainBase] = useState('')
  const [trainDataset, setTrainDataset] = useState('')
  const [hfTokenInput, setHfTokenInput] = useState('')
  const [colorScheme, setColorScheme] = useState<ColorSchemeId>(DEFAULT_COLOR_SCHEME)
  const [chatMaxTokensDraft, setChatMaxTokensDraft] = useState(String(CHAT_MAX_TOKENS_DEFAULT))
  const [wikiAutoExtract, setWikiAutoExtract] = useState(true)
  const [integrationListenEnabled, setIntegrationListenEnabled] = useState(false)
  const [integrationPortDraft, setIntegrationPortDraft] = useState(String(INTEGRATION_PORT_DEFAULT))
  const [integrationTokenDraft, setIntegrationTokenDraft] = useState('')
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
  const [slideConvEdge, setSlideConvEdge] = useState<SlidePanelEdge>(() =>
    readSlideEdge(LS_SLIDE_CONV_EDGE, 'left')
  )
  const [slideKbEdge, setSlideKbEdge] = useState<SlidePanelEdge>(() => readSlideEdge(LS_SLIDE_KB_EDGE, 'right'))
  const [slidePanelResizing, setSlidePanelResizing] = useState<null | 'conv' | 'kb'>(null)
  const [pinnedBarResizing, setPinnedBarResizing] = useState(false)
  const convWRef = useRef(slideConvWidthPx)
  const kbWRef = useRef(slideKbWidthPx)
  const slideConvEdgeRef = useRef(slideConvEdge)
  const slideKbEdgeRef = useRef(slideKbEdge)
  const pinnedWRef = useRef(PINNED_W_DEFAULT)
  const pinnedHRef = useRef(PINNED_H_DEFAULT)
  const pinnedWidgetsSideRef = useRef<PinnedWidgetsSide>('left')
  const narrowForPinnedRef = useRef(false)
  const pinnedBarResizeRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)
  narrowForPinnedRef.current = narrowSlideConv

  useEffect(() => {
    convWRef.current = slideConvWidthPx
  }, [slideConvWidthPx])

  useEffect(() => {
    kbWRef.current = slideKbWidthPx
  }, [slideKbWidthPx])

  useEffect(() => {
    slideConvEdgeRef.current = slideConvEdge
  }, [slideConvEdge])

  useEffect(() => {
    slideKbEdgeRef.current = slideKbEdge
  }, [slideKbEdge])

  const [pinnedWidgetsWidthPx, setPinnedWidgetsWidthPx] = useState(PINNED_W_DEFAULT)
  const [pinnedWidgetsHeightPx, setPinnedWidgetsHeightPx] = useState(PINNED_H_DEFAULT)

  useEffect(() => {
    pinnedWRef.current = pinnedWidgetsWidthPx
  }, [pinnedWidgetsWidthPx])

  useEffect(() => {
    pinnedHRef.current = pinnedWidgetsHeightPx
  }, [pinnedWidgetsHeightPx])

  useEffect(() => {
    const onResize = (): void => {
      setSlideConvWidthPx((w) => clampSlideConv(w))
      setSlideKbWidthPx((w) => clampSlideKb(w))
      setPinnedWidgetsWidthPx((w) => clampPinnedWidth(w))
      setPinnedWidgetsHeightPx((h) => clampPinnedHeight(h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!slidePanelResizing) return
    const kind = slidePanelResizing
    const onMove = (e: PointerEvent): void => {
      if (kind === 'conv') {
        const v =
          slideConvEdgeRef.current === 'left'
            ? clampSlideConv(e.clientX)
            : clampSlideConv(window.innerWidth - e.clientX)
        convWRef.current = v
        setSlideConvWidthPx(v)
      } else {
        const v =
          slideKbEdgeRef.current === 'right'
            ? clampSlideKb(window.innerWidth - e.clientX)
            : clampSlideKb(e.clientX)
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

  useEffect(() => {
    if (!pinnedBarResizing) return
    const onMove = (e: PointerEvent): void => {
      const r = pinnedBarResizeRef.current
      if (!r) return
      const side = pinnedWidgetsSideRef.current
      const narrowStack = narrowForPinnedRef.current && (side === 'left' || side === 'right')
      if (narrowStack) {
        const next = clampPinnedHeight(r.startH + (e.clientY - r.startY))
        pinnedHRef.current = next
        setPinnedWidgetsHeightPx(next)
        return
      }
      if (side === 'left') {
        const next = clampPinnedWidth(r.startW + (e.clientX - r.startX))
        pinnedWRef.current = next
        setPinnedWidgetsWidthPx(next)
        return
      }
      if (side === 'right') {
        const next = clampPinnedWidth(r.startW - (e.clientX - r.startX))
        pinnedWRef.current = next
        setPinnedWidgetsWidthPx(next)
        return
      }
      if (side === 'top') {
        const next = clampPinnedHeight(r.startH + (e.clientY - r.startY))
        pinnedHRef.current = next
        setPinnedWidgetsHeightPx(next)
        return
      }
      if (side === 'bottom') {
        const next = clampPinnedHeight(r.startH - (e.clientY - r.startY))
        pinnedHRef.current = next
        setPinnedWidgetsHeightPx(next)
      }
    }
    const onUp = (): void => {
      void window.api.setConfig({
        pinnedWidgetsWidthPx: clampPinnedWidth(pinnedWRef.current),
        pinnedWidgetsHeightPx: clampPinnedHeight(pinnedHRef.current)
      })
      setPinnedBarResizing(false)
      pinnedBarResizeRef.current = null
    }
    const side = pinnedWidgetsSideRef.current
    const narrowStack = narrowForPinnedRef.current && (side === 'left' || side === 'right')
    const cursor =
      narrowStack || side === 'top' || side === 'bottom' ? 'ns-resize' : 'ew-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [pinnedBarResizing])

  const [metricsPinned, setMetricsPinned] = useState(false)
  const [downloadsPinned, setDownloadsPinned] = useState(false)
  const [activityPinned, setActivityPinned] = useState(false)
  const [runtimeLoadProgress, setRuntimeLoadProgress] = useState<RuntimeLoadProgress | null>(null)
  const [runtimeStarting, setRuntimeStarting] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [streamingReplyStartedAt, setStreamingReplyStartedAt] = useState<number | null>(null)
  const [chatStreamBuffer, setChatStreamBuffer] = useState('')
  const [activityChatTokens, setActivityChatTokens] = useState<ActivityChatTokens | null>(null)
  const activityChatTokensRef = useRef<ActivityChatTokens | null>(null)
  const [activityTokenHistory, setActivityTokenHistory] = useState<ActivityTokenHistoryPoint[]>([])
  const [integrationPluginReports, setIntegrationPluginReports] = useState<PluginIntegrationReport[]>([])
  const [pinnedWidgetsSide, setPinnedWidgetsSide] = useState<PinnedWidgetsSide>('left')
  const [pinnedDownloadsSnapshot, setPinnedDownloadsSnapshot] = useState<DownloadRow[]>([])
  const [metricsRefreshMs, setMetricsRefreshMs] = useState(3000)
  const [metricsRefreshCustomMode, setMetricsRefreshCustomMode] = useState(false)
  const [metricsCustomSec, setMetricsCustomSec] = useState('')
  const [widgetSnap, setWidgetSnap] = useState<MetricsSnapshot | null>(null)
  const [widgetSeries, setWidgetSeries] = useState<MetricsSnapshot[]>([])
  const [backdropSnap, setBackdropSnap] = useState<MetricsSnapshot | null>(null)
  const [modelProfile, setModelProfile] = useState<ModelProfile>(() => defaultModelProfile())

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const runtimeWasRunningRef = useRef(false)

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

  const onWikiRichDomReady = useCallback((root: HTMLDivElement) => {
    setWikiTocGroups(buildWikiTocGroupsFromRoot(root))
  }, [])

  const loadWiki = useCallback(async () => {
    setWikiTopics(await window.api.kbWikiTopics())
    try {
      setWikiHighlightTerms(await window.api.kbWikiHighlightTerms())
    } catch {
      setWikiHighlightTerms([])
    }
  }, [])

  useEffect(() => {
    const q = wikiSearchQuery.trim()
    if (mainView !== 'wiki') return
    if (!q) {
      setWikiSearchHits([])
      setWikiSearchBusy(false)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      const seq = ++wikiSearchSeqRef.current
      if (typeof window.api.kbSearchHits !== 'function') {
        setWikiSearchHits([])
        setWikiSearchBusy(false)
        return
      }
      setWikiSearchBusy(true)
      void window.api
        .kbSearchHits(q, 20)
        .then((hits) => {
          if (cancelled || seq !== wikiSearchSeqRef.current) return
          setWikiSearchHits(hits)
        })
        .finally(() => {
          if (cancelled || seq !== wikiSearchSeqRef.current) return
          setWikiSearchBusy(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [wikiSearchQuery, mainView])

  useEffect(() => {
    const q = ragQuery.trim()
    if (!q) {
      setRagSuggestHits([])
      return
    }
    let cancelled = false
    const seq = ++ragSuggestSeqRef.current
    const t = window.setTimeout(() => {
      if (typeof window.api.kbSearchHits !== 'function') {
        if (!cancelled && seq === ragSuggestSeqRef.current) setRagSuggestHits([])
        return
      }
      void window.api.kbSearchHits(q, 14).then((hits) => {
        if (cancelled || seq !== ragSuggestSeqRef.current) return
        setRagSuggestHits(hits)
      })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [ragQuery])

  useEffect(() => {
    setRagSuggestActive(-1)
  }, [ragQuery, ragSuggestHits])

  const loadKnowledgeGraph = useCallback(async () => {
    setKgLoading(true)
    try {
      const d = await window.api.kbKnowledgeGraph()
      setKgPayload(d)
    } catch {
      setKgPayload(null)
    } finally {
      setKgLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mainView === 'wiki') {
      void loadKnowledgeGraph()
    }
  }, [mainView, wikiTopics.length, loadKnowledgeGraph])

  useEffect(() => {
    if (!wikiTitle.trim()) setWikiTocGroups([])
  }, [wikiTitle])

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

  useEffect(() => {
    if (!wikiDeletePending) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setWikiDeletePending(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wikiDeletePending])

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

  const refreshOllamaChatTags = useCallback(async () => {
    setOllamaChatTagsLoading(true)
    setOllamaChatTagsErr(null)
    try {
      const listTags = window.api.ollamaListTags
      if (typeof listTags !== 'function') {
        setOllamaChatTags([])
        setOllamaChatTagsErr(
          'The preload script is out of date (ollamaListTags missing). Stop the app, run npm run build, then start again — or use npm run dev so predev rebuilds preload.'
        )
        return
      }
      const r = await listTags()
      setOllamaChatTags(Array.isArray(r.names) ? r.names : [])
      if (r.error) setOllamaChatTagsErr(r.error)
    } catch (e) {
      setOllamaChatTags([])
      setOllamaChatTagsErr(e instanceof Error ? e.message : String(e))
    } finally {
      setOllamaChatTagsLoading(false)
    }
  }, [])

  const toggleLocalGgufDeleteMark = useCallback((p: string) => {
    setLocalGgufDeleteMarks((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }, [])

  const toggleOllamaDeleteMark = useCallback((tag: string) => {
    setOllamaDeleteMarks((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }, [])

  const deleteMarkedLocalGgufs = useCallback(async () => {
    if (localGgufDeleteMarks.length === 0) return
    const toDelete = [...localGgufDeleteMarks]
    const lines = toDelete.map((p) => fileNameFromPath(p)).join('\n')
    if (
      !window.confirm(
        `Permanently delete ${toDelete.length} file(s)?\n\n${lines}\n\nThis cannot be undone.`
      )
    )
      return
    setModelPurgeBusy(true)
    setErr(null)
    try {
      for (const p of toDelete) {
        await window.api.deleteLocalGgufModel(p)
        try {
          localStorage.removeItem(profileStorageKey(p))
        } catch {
          /* ignore */
        }
      }
      setLocalGgufDeleteMarks([])
      const curTrim = modelPath.trim()
      if (toDelete.some((p) => localModelPathsEqual(p, curTrim, winPlatform))) {
        setModelPath('')
      }
      await refreshLocalModelFiles()
      void refreshRunDrawerQuick()
    } catch (e) {
      setErr(String(e))
    } finally {
      setModelPurgeBusy(false)
    }
  }, [localGgufDeleteMarks, modelPath, winPlatform, refreshLocalModelFiles, refreshRunDrawerQuick])

  const deleteMarkedOllamaModels = useCallback(async () => {
    if (ollamaDeleteMarks.length === 0) return
    const toRemove = [...ollamaDeleteMarks]
    const lines = toRemove.join('\n')
    if (
      !window.confirm(
        `Remove ${toRemove.length} model(s) from Ollama?\n\n${lines}\n\nThis frees disk space in Ollama's store.`
      )
    )
      return
    setModelPurgeBusy(true)
    setErr(null)
    try {
      for (const tag of toRemove) {
        await window.api.deleteOllamaModel(tag)
        try {
          localStorage.removeItem(profileStorageKey(tag))
        } catch {
          /* ignore */
        }
      }
      setOllamaDeleteMarks([])
      const curTrim = modelPath.trim()
      if (toRemove.includes(curTrim)) {
        setModelPath('')
      }
      await refreshOllamaChatTags()
      void refreshRunDrawerQuick()
    } catch (e) {
      setErr(String(e))
    } finally {
      setModelPurgeBusy(false)
    }
  }, [ollamaDeleteMarks, modelPath, refreshOllamaChatTags, refreshRunDrawerQuick])

  const refreshDownloadsList = useCallback(async () => {
    try {
      const rows = await window.api.downloadsList()
      setLocalDownloads(rows as DownloadRow[])
    } catch {
      /* ignore */
    }
  }, [])

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
    if (!ollamaHost?.reachable) return
    void refreshOllamaChatTags()
  }, [ollamaHost?.reachable, refreshOllamaChatTags])

  useEffect(() => {
    return window.api.onRuntimeLoadProgress((p) => {
      setRuntimeLoadProgress(p)
    })
  }, [])

  useEffect(() => {
    return window.api.onOllamaPullProgress((p) => {
      setHfOllamaPullProgress(p)
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
      if (typeof c.pinnedWidgetsWidthPx === 'number') {
        setPinnedWidgetsWidthPx(clampPinnedWidth(c.pinnedWidgetsWidthPx))
      }
      if (typeof c.pinnedWidgetsHeightPx === 'number') {
        setPinnedWidgetsHeightPx(clampPinnedHeight(c.pinnedWidgetsHeightPx))
      }
      if (typeof c.metricsRefreshMs === 'number') {
        const ms = clampMetricsRefreshMs(c.metricsRefreshMs)
        setMetricsRefreshMs(ms)
        setMetricsRefreshCustomMode(!(METRICS_REFRESH_PRESETS_MS as readonly number[]).includes(ms))
      }
      const scheme = parseColorScheme(c.colorScheme)
      setColorScheme(scheme)
      applyColorSchemeToDocument(scheme)
      if (typeof c.chatMaxTokens === 'number') {
        setChatMaxTokensDraft(String(clampChatMaxTokens(c.chatMaxTokens)))
      }
      setWikiAutoExtract(c.wikiAutoExtract !== false)
      if (typeof c.integrationListenEnabled === 'boolean') setIntegrationListenEnabled(c.integrationListenEnabled)
      if (typeof c.integrationPort === 'number') {
        setIntegrationPortDraft(String(clampIntegrationPort(c.integrationPort)))
      }
      if (typeof c.integrationToken === 'string') setIntegrationTokenDraft(c.integrationToken)
    })
  }, [refreshPaths, loadConversations, loadWiki, refreshRuntimeStatus, applyRuntimeInstallPaths])

  useEffect(() => {
    const cap = 15
    void window.api.integrationPluginReportsList().then((list) => {
      setIntegrationPluginReports(list.slice(-cap))
    })
    const off = window.api.onIntegrationPluginReport((r) => {
      setIntegrationPluginReports((prev) => [...prev, r].slice(-cap))
    })
    return off
  }, [])

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
    void refreshDownloadsList()
  }, [refreshDownloadsList])

  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        const jobs = hfDownloadJobsRef.current
        const repoIds = Object.keys(jobs)
        if (repoIds.length === 0) return
        const next: Record<string, HfCardDownloadState> = { ...jobs }
        let changed = false
        let refreshDownloadsAfter = false
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
            if (st.status === 'complete') refreshDownloadsAfter = true
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
        if (changed) {
          setHfDownloadJobs(next)
          if (refreshDownloadsAfter) void refreshDownloadsList()
        }
      })()
    }, 400)
    return () => clearInterval(id)
  }, [refreshDownloadsList])

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
    const active = Boolean(runtimeStatus?.running) || runtimeStarting || chatSending
    if (!active) {
      setBackdropSnap(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const s = (await window.api.metricsSnapshot({ persist: false })) as MetricsSnapshot
        if (!cancelled) setBackdropSnap(s)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = window.setInterval(tick, BACKDROP_METRICS_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [runtimeStatus?.running, runtimeStarting, chatSending])

  const personalityModelKey = useMemo(() => {
    if (runtimeStatus?.running && runtimeStatus.modelPath?.trim()) return runtimeStatus.modelPath.trim()
    return modelPath.trim()
  }, [runtimeStatus?.running, runtimeStatus?.modelPath, modelPath])

  useEffect(() => {
    if (!personalityModelKey) {
      setModelProfile(defaultModelProfile())
      return
    }
    setModelProfile(loadModelProfile(personalityModelKey))
  }, [personalityModelKey])

  const clearModelProfileStorage = useCallback(() => {
    if (!personalityModelKey) return
    const fresh = defaultModelProfile()
    setModelProfile(fresh)
    saveModelProfile(personalityModelKey, fresh)
  }, [personalityModelKey])

  useEffect(() => {
    const running = Boolean(runtimeStatus?.running)
    const was = runtimeWasRunningRef.current
    runtimeWasRunningRef.current = running
    if (!running) {
      setActivityTokenHistory([])
      return
    }
    if (running && !was) {
      setActivityTokenHistory([])
    }
  }, [runtimeStatus?.running])

  useEffect(() => {
    return window.api.onRuntimeChatProgress((p) => {
      if (p.kind !== 'usage') return
      const dp = p.promptTokens
      const dc = p.completionTokens
      if (dp == null && dc == null) return
      const addP = typeof dp === 'number' && !Number.isNaN(dp) ? dp : 0
      const addC = typeof dc === 'number' && !Number.isNaN(dc) ? dc : 0
      if (addP === 0 && addC === 0) return
      setActivityTokenHistory((prev) => {
        const last = prev[prev.length - 1]
        const baseP = last?.promptCum ?? 0
        const baseC = last?.completionCum ?? 0
        return [
          ...prev,
          {
            ts: Date.now(),
            promptCum: baseP + addP,
            completionCum: baseC + addC
          }
        ].slice(-400)
      })
    })
  }, [])

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
      <h3 className="settings-section-title">
        <i className="fa-solid fa-thumbtack" aria-hidden />
        Pinned widgets
      </h3>
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
        <span>
          <i className="fa-solid fa-gauge-high" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
          Show live metrics in the Pinned widgets panel (does not write to history each tick)
        </span>
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
        <span>
          <i className="fa-solid fa-download" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
          Show Hub download progress in the Pinned widgets panel
        </span>
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
        <span>
          <i className="fa-solid fa-bars-staggered" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
          Show model load and reply progress in the Pinned widgets panel
        </span>
      </label>
      <label style={{ display: 'block', marginTop: 16 }}>
        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
          <i className="fa-solid fa-arrows-left-right" aria-hidden style={{ marginRight: 6, opacity: 0.6 }} />
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
        <i className="fa-solid fa-clock" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
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
            <i className="fa-solid fa-stopwatch" aria-hidden style={{ marginRight: 6, opacity: 0.6 }} />
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
          className="btn-secondary settings-btn-icon"
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
          <i className="fa-solid fa-check" aria-hidden />
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
      setOllamaHubPullNameDraft('')
      setRecommendedLoading(true)
      void refreshDownloadsList()
      void refreshLocalModelFiles()
      void refreshOllamaChatTags()
      void window.api
        .hfRecommended(HF_RECOMMENDED_FETCH_LIMIT)
        .then((r) => setRecommendedModels(r as HfModelSummary[]))
        .catch(() => setRecommendedModels([]))
        .finally(() => setRecommendedLoading(false))
    }
  }, [drawer, refreshDownloadsList, refreshLocalModelFiles, refreshOllamaChatTags])

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

  const hfHubInstalledModels = useMemo(() => {
    return hfDisplayModels.filter((m) =>
      runtimeKind === 'ollama'
        ? ollamaRegistryTagInstalled(ollamaChatTags, m.ollamaLibraryName ?? '')
        : localDownloads.some((r) => r.repo_id === m.id && r.status === 'complete')
    )
  }, [hfDisplayModels, runtimeKind, ollamaChatTags, localDownloads])

  const hfHubAvailableModels = useMemo(() => {
    return hfDisplayModels.filter((m) =>
      runtimeKind === 'ollama'
        ? !ollamaRegistryTagInstalled(ollamaChatTags, m.ollamaLibraryName ?? '')
        : !localDownloads.some((r) => r.repo_id === m.id && r.status === 'complete')
    )
  }, [hfDisplayModels, runtimeKind, ollamaChatTags, localDownloads])

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
    setOllamaHubPullNameDraft('')
  }

  async function runHfSearch(): Promise<void> {
    setErr(null)
    setHfLibraryMode('search')
    setHfSearchLoading(true)
    setSelectedModel(null)
    setDetail(null)
    setOllamaHubPullNameDraft('')
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
        destDir,
        chatDisplayName: repoId
      })) as { id: string; progress?: number; bytesReceived?: number; bytesTotal?: number; status?: string }
      setLastJobId(j.id)
      void refreshDownloadsList()
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
      const detailRow = d as HfModelDetail
      setDetail(detailRow)
      const tag = detailRow.ollamaLibraryName?.trim()
      setOllamaHubPullNameDraft(tag ?? '')
      const gguf = detailRow.siblings?.find((s) => s.path.endsWith('.gguf'))
      if (gguf) setDownloadFile(gguf.path)
    } catch (e) {
      setErr(String(e))
    }
  }

  async function runOllamaPullForHub(repoId: string, tag: string): Promise<void> {
    const trimmed = tag.trim()
    if (!trimmed) {
      setErr('Enter an Ollama model name to pull.')
      return
    }
    setErr(null)
    setHfOllamaPullRepoId(repoId)
    setHfOllamaPullProgress(null)
    setHfOllamaPullBusy(true)
    try {
      const pull = window.api.ollamaPullModel
      if (typeof pull !== 'function') {
        throw new Error('Preload is out of date (ollamaPullModel missing). Rebuild the app.')
      }
      await pull(trimmed)
      void refreshOllamaChatTags()
    } catch (e) {
      setErr(String(e))
    } finally {
      setHfOllamaPullBusy(false)
      setHfOllamaPullRepoId(null)
      setHfOllamaPullProgress(null)
    }
  }

  async function hubQuickInstall(repoId: string): Promise<void> {
    const summary = hfListModels.find((x) => x.id === repoId)
    if (!summary) {
      setErr('Model not found in the current list.')
      return
    }
    if (runtimeKind === 'llamacpp') {
      await quickDownloadFromRepo(repoId)
      return
    }
    const tag = summary.ollamaLibraryName?.trim()
    if (!tag) {
      setErr(
        'No preset Ollama tag for this Hub entry. Select the card and type a model name under “Selected model”, or switch the top bar to llama.cpp to download the .gguf file.'
      )
      return
    }
    await runOllamaPullForHub(repoId, tag)
  }

  async function startDownload(): Promise<void> {
    setErr(null)
    if (runtimeKind === 'ollama') {
      if (!selectedModel) return
      const tag = ollamaHubPullNameDraft.trim()
      if (!tag) {
        setErr('Enter an Ollama model name to pull (for example: llama3.2).')
        return
      }
      await runOllamaPullForHub(selectedModel, tag)
      return
    }
    if (!selectedModel || !downloadFile || !destDir) return
    try {
      const j = (await window.api.hfDownload({
        repoId: selectedModel,
        revision: 'main',
        filename: downloadFile,
        destDir,
        chatDisplayName: selectedModel
      })) as { id: string; progress?: number; bytesReceived?: number; bytesTotal?: number; status?: string }
      setLastJobId(j.id)
      void refreshDownloadsList()
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

  const renderHfHubCard = (m: HfModelSummary): ReactElement => {
    const hfJob = hfDownloadJobs[m.id]
    const hfPct = hfJob ? hfCardProgressPct(hfJob) : null
    const hfMeta = hfJob
      ? hfPct != null
        ? hfJob.bytesTotal > 0
          ? `${hfJob.progress}% · ${formatBytes(hfJob.bytesReceived)} / ${formatBytes(hfJob.bytesTotal)}`
          : `${hfJob.progress}%`
        : 'Starting…'
      : undefined
    const ollamaPullHere = runtimeKind === 'ollama' && hfOllamaPullRepoId === m.id
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
    const installBusy =
      !!hfJob || quickDownloadRepo === m.id || (runtimeKind === 'ollama' && hfOllamaPullBusy)
    const quickOllamaBlocked = runtimeKind === 'ollama' && !m.ollamaLibraryName?.trim()

    return (
      <div key={m.id} className={`hf-model-card ${selectedModel === m.id ? 'selected' : ''}`}>
        <button type="button" className="hf-model-card-main" onClick={() => void loadDetail(m.id)}>
          <div className="hf-model-card-title">{m.id}</div>
          {m.description ? <p className="hf-model-card-desc">{m.description}</p> : null}
          {m.ollamaLibraryName ? (
            <p className="muted hf-model-card-ollama-hint" style={{ marginTop: 8, fontSize: 12 }}>
              Ollama tag: <code className="inline-code">{m.ollamaLibraryName}</code>
            </p>
          ) : null}
        </button>
        {ollamaPullHere ? (
          <div className="hf-model-card-progress">
            <DownloadProgressBar compact pct={oPullPct} meta={oPullMeta} />
          </div>
        ) : hfJob ? (
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
            disabled={installBusy || quickOllamaBlocked}
            title={
              quickOllamaBlocked
                ? 'Open this card and enter an Ollama model name, or use llama.cpp to download the file.'
                : undefined
            }
            onClick={() => void hubQuickInstall(m.id)}
          >
            {hfJob
              ? 'Downloading…'
              : ollamaPullHere
                ? 'Pulling…'
                : quickDownloadRepo === m.id
                  ? 'Preparing…'
                  : runtimeKind === 'ollama'
                    ? 'Pull'
                    : 'Download'}
          </button>
        </div>
      </div>
    )
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
    const userSentAt = Date.now()
    await window.api.messageAppend(convId, 'user', userText)
    setMessages((prev) => [...prev, { role: 'user', content: userText, createdAt: userSentAt }])
    let context = userText
    if (ragSnippets.length) {
      context =
        'Use the following knowledge snippets when relevant:\n' +
        ragSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n') +
        '\n\nUser question:\n' +
        userText
    }
    const historyForApi = messages.map((m) => ({ role: m.role, content: m.content }))
    const msgs = [
      { role: 'system' as const, content: MODEL_PROFILE_SYSTEM_PROMPT },
      ...historyForApi,
      { role: 'user' as const, content: context }
    ]
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const totalChars = msgs.reduce((acc, m) => acc + m.content.length, 0)
    const promptTokenEstimate = Math.max(1, Math.ceil(totalChars / 4))
    setChatSending(true)
    setStreamingReplyStartedAt(Date.now())
    setChatStreamBuffer('')
    const initialTok: ActivityChatTokens = {
      prompt: promptTokenEstimate,
      completion: 0,
      promptIsEstimate: true,
      completionIsEstimate: true,
    }
    activityChatTokensRef.current = initialTok
    setActivityChatTokens(initialTok)
    const offChat = window.api.onRuntimeChatProgress((p) => {
      if (p.requestId !== requestId) return
      if (p.kind === 'token' && p.text) {
        const chunk = p.text
        setChatStreamBuffer((prev) => prev + chunk)
        setActivityChatTokens((prev) => {
          if (!prev || !prev.completionIsEstimate) {
            activityChatTokensRef.current = prev
            return prev
          }
          const delta = Math.max(1, Math.ceil(chunk.length / 4))
          const next = { ...prev, completion: prev.completion + delta }
          activityChatTokensRef.current = next
          return next
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
          const next = {
            prompt: p.promptTokens != null ? p.promptTokens : base.prompt,
            completion: p.completionTokens != null ? p.completionTokens : base.completion,
            promptIsEstimate: p.promptTokens != null ? false : base.promptIsEstimate,
            completionIsEstimate: p.completionTokens != null ? false : base.completionIsEstimate
          }
          activityChatTokensRef.current = next
          return next
        })
      }
    })
    try {
      const reply = await window.api.runtimeChat(msgs, requestId)
      const { visible: replyVisible, patches: ambiancePatches, journalTexts } = stripModelProfileMarkers(reply)
      const snap = activityChatTokensRef.current
      await window.api.messageAppend(
        convId,
        'assistant',
        replyVisible,
        undefined,
        snap
          ? {
              promptTokens: snap.prompt,
              completionTokens: snap.completion,
              promptIsEstimate: snap.promptIsEstimate,
              completionIsEstimate: snap.completionIsEstimate
            }
          : undefined
      )
      const st = await window.api.runtimeStatus()
      const persistKey = st?.modelPath?.trim() || modelPath.trim()
      if (persistKey && (ambiancePatches.length > 0 || journalTexts.length > 0)) {
        setModelProfile((prev) => {
          let vibe = prev.vibe
          for (const patch of ambiancePatches) {
            vibe = mergePersonalityPatches(vibe, patch)
          }
          let next: ModelProfile = { ...prev, vibe }
          if (journalTexts.length > 0) {
            next = appendJournalTexts(next, journalTexts)
          }
          saveModelProfile(persistKey, next)
          return next
        })
      }
      const m = await window.api.conversationMessages(convId)
      setMessages(m as ChatMessageVm[])
      const convTitle = conversations.find((c) => c.id === convId)?.title
      void window.api
        .kbWikiExtractTurn({
          conversationId: convId,
          conversationTitle: convTitle,
          userMessage: userText,
          assistantMessage: replyVisible
        })
        .then((r) => {
          if (r.ok && r.skipped === false && r.sourceId) void loadWiki()
        })
        .catch(() => {
          /* extraction is best-effort */
        })
    } catch (e) {
      setErr(String(e))
    } finally {
      offChat()
      setChatSending(false)
      setStreamingReplyStartedAt(null)
      setChatStreamBuffer('')
      activityChatTokensRef.current = null
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
    setMessages(m as ChatMessageVm[])
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
        setWikiGlossary([])
        setWikiRelated([])
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

  async function runRagWithQuery(q: string): Promise<void> {
    const t = q.trim()
    if (!t) return
    setRagLoading(true)
    try {
      const snippets = await window.api.kbSearch(t, 8)
      setRagSnippets(snippets)
    } finally {
      setRagLoading(false)
    }
  }

  async function runRag(): Promise<void> {
    await runRagWithQuery(ragQuery)
  }

  async function applyRagSuggestion(hit: KbSearchHit): Promise<void> {
    setRagQuery(hit.sourceTitle)
    setRagSuggestFocused(false)
    setRagSuggestActive(-1)
    await runRagWithQuery(hit.sourceTitle)
  }

  function onRagSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (!ragSuggestOpen || ragSuggestionRows.length === 0) {
      if (e.key === 'Enter') void runRag()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setRagSuggestActive((i) => Math.min(ragSuggestionRows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setRagSuggestActive((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setRagSuggestFocused(false)
      setRagSuggestActive(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (ragSuggestActive >= 0) {
        void applyRagSuggestion(ragSuggestionRows[ragSuggestActive])
      } else {
        void runRag()
      }
    }
  }

  async function openWikiPage(sourceId: string): Promise<void> {
    setWikiSelectedId(sourceId)
    const p = await window.api.kbWikiPage(sourceId)
    setWikiTitle(p.title)
    setWikiBody(p.body)
    setWikiGlossary(p.glossary)
    setWikiRelated(p.relatedSources)
  }

  async function navigateChatKeywordToWiki(sourceId: string): Promise<void> {
    setMainView('wiki')
    await openWikiPage(sourceId)
  }

  async function exportWikiZipToDisk(): Promise<void> {
    if (typeof window.api.kbExportWikiZip !== 'function') {
      setErr('Export wiki is unavailable. Rebuild the app so preload includes kbExportWikiZip.')
      return
    }
    setWikiExportBusy(true)
    setErr(null)
    try {
      await window.api.kbExportWikiZip()
    } catch (e) {
      setErr(String(e))
    } finally {
      setWikiExportBusy(false)
    }
  }

  async function confirmDeleteWikiEntry(): Promise<void> {
    if (!wikiDeletePending) return
    const { id } = wikiDeletePending
    const wasViewingDeleted = wikiSelectedId === id
    setWikiDeletePending(null)
    if (typeof window.api.kbDeleteSource !== 'function') {
      setErr('Remove from wiki is unavailable. Rebuild the app so preload includes kbDeleteSource.')
      return
    }
    setErr(null)
    try {
      await window.api.kbDeleteSource(id)
      if (wasViewingDeleted) {
        setWikiSelectedId(null)
        setWikiTitle('')
        setWikiBody('')
        setWikiGlossary([])
        setWikiRelated([])
      }
      await loadWiki()
      void loadKnowledgeGraph()
    } catch (e) {
      setErr(String(e))
    }
  }

  function onComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendChat()
    }
  }

  const loadedModelTitle = useMemo(() => {
    if (!runtimeStatus?.modelPath?.trim()) return 'Model ready'
    const raw = runtimeStatus.modelPath.trim()
    const win = paths?.platform === 'win32'
    const fromHub = chatAuthorLabelForModelPath(raw, localDownloads, Boolean(win))
    if (fromHub) return fromHub
    if (runtimeStatus.kind === 'llamacpp' && looksLikeLocalModelFilePath(raw)) {
      return fileNameFromPath(raw) || raw
    }
    return raw
  }, [runtimeStatus, localDownloads, paths?.platform])
  const assistantResponderLabel = useMemo(() => {
    if (!runtimeStatus?.running) return 'Assistant'
    const raw = runtimeStatus.modelPath?.trim()
    if (!raw) return 'Assistant'
    const win = paths?.platform === 'win32'
    const fromHub = chatAuthorLabelForModelPath(raw, localDownloads, Boolean(win))
    if (fromHub) return fromHub
    if (runtimeStatus.kind === 'llamacpp' && looksLikeLocalModelFilePath(raw)) {
      return fileNameFromPath(raw) || raw
    }
    return raw
  }, [runtimeStatus, localDownloads, paths?.platform])
  const topTitle = mainView === 'chat' ? 'Chat' : 'Knowledge wiki'
  const topSub =
    mainView === 'chat'
      ? 'Ground replies with your wiki from the right panel.'
      : 'Browse sources built from files you ingest. Link snippets in chat.'

  const wikiSearchTrimmed = wikiSearchQuery.trim()
  const wikiHasSearch = wikiSearchTrimmed.length > 0
  const wikiSearchQLower = wikiSearchTrimmed.toLowerCase()
  const wikiTitleMatchTopics = useMemo(() => {
    if (!wikiHasSearch) return wikiTopics
    return wikiTopics.filter((t) => t.title.toLowerCase().includes(wikiSearchQLower))
  }, [wikiTopics, wikiHasSearch, wikiSearchQLower])
  const wikiTitleMatchIds = useMemo(
    () => new Set(wikiTitleMatchTopics.map((t) => t.id)),
    [wikiTitleMatchTopics]
  )
  const wikiContentHits = useMemo(() => {
    if (!wikiHasSearch) return []
    return wikiSearchHits.filter((h) => !wikiTitleMatchIds.has(h.sourceId))
  }, [wikiHasSearch, wikiSearchHits, wikiTitleMatchIds])

  const ragSuggestionRows = useMemo((): KbSearchHit[] => {
    const q = ragQuery.trim().toLowerCase()
    if (!q) return []
    if (ragSuggestHits.length > 0) return ragSuggestHits
    return wikiTopics
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 12)
      .map((t) => ({
        sourceId: t.id,
        sourceTitle: t.title,
        chunkId: `browse:${t.id}`,
        heading: null,
        snippet: `${WIKI_KIND_LABELS[t.kind]}${t.chunkCount > 0 ? ` · ${t.chunkCount} chunks` : ''}`,
        kind: t.kind
      }))
  }, [ragQuery, ragSuggestHits, wikiTopics])

  const ragSuggestOpen =
    ragSuggestFocused && ragSuggestionRows.length > 0 && !ragLoading

  const wikiBrowseByKind = useMemo(() => groupWikiTopicsByKind(wikiTopics), [wikiTopics])
  const wikiTitleMatchByKind = useMemo(
    () => groupWikiTopicsByKind(wikiTitleMatchTopics),
    [wikiTitleMatchTopics]
  )
  const wikiTitleMatchKindCount = useMemo(
    () => WIKI_KIND_ORDER.filter((k) => (wikiTitleMatchByKind.get(k) ?? []).length > 0).length,
    [wikiTitleMatchByKind]
  )
  const wikiSelectedKindLabel = useMemo(() => {
    if (!wikiSelectedId) return null
    const t = wikiTopics.find((x) => x.id === wikiSelectedId)
    return t ? WIKI_KIND_LABELS[t.kind] : null
  }, [wikiSelectedId, wikiTopics])

  const backdropCtxPercent = useMemo(() => {
    const used = backdropSnap?.runtimeCtxUsed
    if (used == null || !Number.isFinite(used)) return undefined
    const n = parseInt(chatMaxTokensDraft.trim(), 10)
    const cap = clampChatMaxTokens(Number.isFinite(n) ? n : CHAT_MAX_TOKENS_DEFAULT)
    if (cap <= 0) return undefined
    return Math.min(100, Math.max(0, (used / cap) * 100))
  }, [backdropSnap?.runtimeCtxUsed, chatMaxTokensDraft])

  return (
    <div className="shell">
      <ModelPresenceBackdrop
        running={Boolean(runtimeStatus?.running)}
        starting={runtimeStarting}
        loadPercent={runtimeLoadProgress?.percent ?? null}
        chatBusy={chatSending}
        modelPath={runtimeStatus?.modelPath}
        tokensPerSec={backdropSnap?.runtimeTokensPerSec}
        cpuPercent={backdropSnap?.processCpuPercent}
        ctxPercent={backdropCtxPercent}
        personality={modelProfile.vibe}
      />
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
          <aside
            className={`pinned-widgets-aside ${pinnedBarResizing ? 'pinned-widgets-aside--resizing' : ''}`}
            aria-label="Pinned widgets"
            style={pinnedWidgetsAsideStyle(
              narrowSlideConv,
              pinnedWidgetsSide,
              pinnedWidgetsWidthPx,
              pinnedWidgetsHeightPx
            )}
          >
            <div className="pinned-widgets-aside-header">
              <span className="pinned-widgets-aside-title">Pinned widgets</span>
              <div className="pinned-widgets-dock-symbols" role="group" aria-label="Widget bar position">
                {(
                  [
                    { side: 'left' as const, DockIcon: IconDockLeft, title: 'Dock bar on the left (beside nav)' },
                    { side: 'right' as const, DockIcon: IconDockRight, title: 'Dock bar on the right (after main)' },
                    { side: 'top' as const, DockIcon: IconDockTop, title: 'Dock bar on top (above main)' },
                    { side: 'bottom' as const, DockIcon: IconDockBottom, title: 'Dock bar on the bottom (below main)' }
                  ] as const
                ).map(({ side, DockIcon, title }) => (
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
                    <DockIcon />
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
                  tokenHistory={activityTokenHistory}
                  runtimeOn={runtimeOn}
                  pluginReports={integrationPluginReports}
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
            <div
              role="separator"
              aria-orientation={
                narrowSlideConv && (pinnedWidgetsSide === 'left' || pinnedWidgetsSide === 'right')
                  ? 'horizontal'
                  : pinnedWidgetsSide === 'left' || pinnedWidgetsSide === 'right'
                    ? 'vertical'
                    : 'horizontal'
              }
              aria-label="Resize pinned widgets panel"
              className={
                narrowSlideConv && (pinnedWidgetsSide === 'left' || pinnedWidgetsSide === 'right')
                  ? 'pinned-widgets-resize-handle pinned-widgets-resize-handle--stacked'
                  : `pinned-widgets-resize-handle pinned-widgets-resize-handle--${pinnedWidgetsSide}`
              }
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                pinnedWidgetsSideRef.current = pinnedWidgetsSide
                pinnedBarResizeRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  startW: pinnedWidgetsWidthPx,
                  startH: pinnedWidgetsHeightPx
                }
                setPinnedBarResizing(true)
              }}
            />
          </aside>
        )}
        <div className="main-column">
        <header className="top-bar">
          <div className="top-bar-leading">
            <div className="top-bar-title">{topTitle}</div>
            <div className="top-bar-sub">{topSub}</div>
          </div>
          <div className="top-bar-runtime-wrap" aria-label="Model and runtime">
            <div className="top-bar-runtime-row">
              <select
                id="top-bar-runtime-backend-select"
                className="select top-bar-runtime-backend"
                aria-label="Inference backend"
                value={runtimeKind}
                disabled={runtimeStarting || runtimeOn}
                onChange={(e) => setRuntimeKind(e.target.value as 'llamacpp' | 'ollama')}
              >
                <option value="ollama">Ollama</option>
                <option value="llamacpp">llama.cpp</option>
              </select>
              <select
                id="top-bar-runtime-model-select"
                className="select top-bar-runtime-model-select"
                aria-label={runtimeKind === 'ollama' ? 'Ollama model' : 'Model weights file'}
                disabled={runtimeStarting || runtimeOn}
                value={topBarModelSelectValue}
                onChange={(e) => {
                  setModelPath(e.target.value)
                }}
              >
                <option value="">
                  {runtimeKind === 'ollama'
                    ? ollamaChatTagsLoading
                      ? 'Loading models…'
                      : ollamaChatTagsErr
                        ? 'Could not list models'
                        : ollamaChatTags.length === 0
                          ? 'No Ollama models found'
                          : 'Choose Ollama model…'
                    : localModelFilePaths.length === 0
                      ? 'No .gguf in folder'
                      : 'Choose model file…'}
                </option>
                {runtimeKind === 'llamacpp'
                  ? topBarLlamaModelPathOptions.map((p) => {
                      const loadedMp = (runtimeOn ? runtimeStatus?.modelPath?.trim() : '') ?? ''
                      const loadedOnly =
                        Boolean(loadedMp) &&
                        localModelPathsEqual(p, loadedMp, winPlatform) &&
                        !localModelFilePaths.some((q) => localModelPathsEqual(q, loadedMp, winPlatform))
                      return (
                        <option key={p} value={p} title={p}>
                          {fileNameFromPath(p)}
                          {loadedOnly ? ' · loaded' : ''}
                        </option>
                      )
                    })
                  : topBarOllamaModelOptions.map((tag) => {
                      const ollamaLoaded = runtimeStatus?.modelPath?.trim() ?? ''
                      const loadedOnly =
                        runtimeOn && ollamaLoaded !== '' && tag === ollamaLoaded && !ollamaChatTags.includes(tag)
                      return (
                        <option key={tag} value={tag} title={tag}>
                          {tag}
                          {loadedOnly ? ' · loaded' : ''}
                        </option>
                      )
                    })}
              </select>
              {runtimeOn ? (
                <button
                  type="button"
                  className="btn-secondary top-bar-runtime-action"
                  disabled={runtimeStarting}
                  onClick={() => void stopRuntime()}
                >
                  Unload
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary top-bar-runtime-action"
                  disabled={runtimeStarting || !modelPath.trim()}
                  onClick={() => void startRuntime()}
                >
                  {runtimeStarting ? 'Starting…' : 'Start'}
                </button>
              )}
            </div>
            {runtimeStarting ? (
              <div className="top-bar-runtime-progress-wrap" role="status" aria-live="polite">
                {runtimeLoadProgress?.percent != null ? (
                  <div className="top-bar-runtime-progress-track">
                    <div
                      className="top-bar-runtime-progress-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, runtimeLoadProgress.percent))}%`
                      }}
                    />
                  </div>
                ) : null}
                <span className="top-bar-runtime-progress-msg">
                  {runtimeLoadProgress?.message ?? 'Starting…'}
                </span>
              </div>
            ) : null}
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
            <div className="top-bar-pin-group" role="group" aria-label="Pin widgets to sidebar">
              <button
                type="button"
                className={`top-bar-pin ${metricsPinned ? 'active' : ''}`}
                title={metricsPinned ? 'Unpin metrics from sidebar' : 'Pin live metrics to Pinned widgets panel'}
                aria-label={metricsPinned ? 'Unpin metrics from sidebar' : 'Pin live metrics to Pinned widgets panel'}
                aria-pressed={metricsPinned}
                onClick={() => {
                  const next = !metricsPinned
                  setMetricsPinned(next)
                  void saveMetricsWidgetConfig({ metricsPinned: next })
                }}
              >
                <span className="top-bar-pin-icon" aria-hidden>
                  <i className="fa-solid fa-chart-line" />
                </span>
              </button>
              <button
                type="button"
                className={`top-bar-pin ${downloadsPinned ? 'active' : ''}`}
                title={downloadsPinned ? 'Unpin downloads from sidebar' : 'Pin download progress to Pinned widgets panel'}
                aria-label={downloadsPinned ? 'Unpin downloads from sidebar' : 'Pin download progress to Pinned widgets panel'}
                aria-pressed={downloadsPinned}
                onClick={() => {
                  const next = !downloadsPinned
                  setDownloadsPinned(next)
                  void saveMetricsWidgetConfig({ downloadsPinned: next })
                }}
              >
                <span className="top-bar-pin-icon" aria-hidden>
                  <i className="fa-solid fa-download" />
                </span>
              </button>
              <button
                type="button"
                className={`top-bar-pin ${activityPinned ? 'active' : ''}`}
                title={
                  activityPinned
                    ? 'Unpin activity from sidebar'
                    : 'Pin model load & reply progress to Pinned widgets panel'
                }
                aria-label={
                  activityPinned
                    ? 'Unpin activity from sidebar'
                    : 'Pin model load and reply progress to Pinned widgets panel'
                }
                aria-pressed={activityPinned}
                onClick={() => {
                  const next = !activityPinned
                  setActivityPinned(next)
                  void saveMetricsWidgetConfig({ activityPinned: next })
                }}
              >
                <span className="top-bar-pin-icon" aria-hidden>
                  <i className="fa-solid fa-bolt" />
                </span>
              </button>
            </div>
            <div
              className="runtime-pill"
              title={runtimeOn ? 'Runtime details (Run panel)' : 'Runtime setup: top bar to start, Run for more options'}
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

        {wikiDeletePending && (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wiki-delete-title"
            onClick={() => setWikiDeletePending(null)}
          >
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h2 id="wiki-delete-title" className="modal-title">
                Remove wiki entry?
              </h2>
              <p className="muted modal-text">
                <strong>{wikiDeletePending.title}</strong> will be removed from your library, including its search index
                and compiled wiki page. This cannot be undone.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setWikiDeletePending(null)}>
                  Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => void confirmDeleteWikiEntry()}>
                  Remove entry
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
                  Stops the runtime and cancels in-flight downloads. All saved settings (including custom models folder, llama binary path, Ollama URL, ports, max response tokens, auto wiki extraction from chat, IDE integration, and pinned widgets) return to defaults, and your Hugging Face token is removed from this device. Chats, knowledge base, wiki, caches, and model files are not changed by this action alone.
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
              data-slide-conv-edge={slideConvEdge}
              data-slide-kb-edge={slideKbEdge}
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
                {narrowSlideConv && mobileConvOpen && slideConvEdge === 'right' ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize chat list width"
                    className="slide-panel-resize-handle slide-panel-resize-handle--from-right-panel"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const v = clampSlideConv(window.innerWidth - e.clientX)
                      convWRef.current = v
                      setSlideConvWidthPx(v)
                      setSlidePanelResizing('conv')
                    }}
                  />
                ) : null}
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
                {narrowSlideConv && mobileConvOpen && slideConvEdge === 'left' ? (
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
                    <div key={m.id ?? `m-${i}`} className={`msg-row ${m.role === 'user' ? 'user' : 'assistant'}`}>
                      <div className="msg-bubble">
                        <div className="msg-bubble-top">
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
                          {typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? (
                            <time
                              className="msg-time"
                              dateTime={new Date(m.createdAt).toISOString()}
                              title={chatTimeTitle(m.createdAt)}
                            >
                              {formatChatTimestamp(m.createdAt)}
                            </time>
                          ) : null}
                        </div>
                        <ChatRichContent
                          content={m.content}
                          wikiHighlightTerms={wikiHighlightTerms}
                          onWikiKeywordNavigate={(id) => void navigateChatKeywordToWiki(id)}
                        />
                        <div className="msg-token-foot">{bubbleTokenLine(m)}</div>
                      </div>
                    </div>
                  ))}
                  {chatSending ? (
                    <div className="msg-row assistant">
                      <div className="msg-bubble msg-bubble--streaming">
                        <div className="msg-bubble-top">
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
                          {streamingReplyStartedAt != null ? (
                            <time
                              className="msg-time"
                              dateTime={new Date(streamingReplyStartedAt).toISOString()}
                              title={chatTimeTitle(streamingReplyStartedAt)}
                            >
                              {formatChatTimestamp(streamingReplyStartedAt)}
                            </time>
                          ) : null}
                        </div>
                        {chatStreamBuffer ? (
                          <ChatRichContent
                            content={stripPartialProfileStreamTail(chatStreamBuffer)}
                            plainStreaming
                            wikiHighlightTerms={wikiHighlightTerms}
                            onWikiKeywordNavigate={(id) => void navigateChatKeywordToWiki(id)}
                          />
                        ) : (
                          <FloatingDots label="Generating reply" />
                        )}
                        {activityChatTokens ? (
                          <div className="msg-token-foot">{streamingTokenFoot(activityChatTokens)}</div>
                        ) : null}
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
                  <div className="composer-toolbar">
                    <div className="rag-inline">
                      <div className="rag-autocomplete">
                        <input
                          className="input"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={ragSuggestOpen}
                          aria-controls="rag-suggest-listbox"
                          aria-activedescendant={
                            ragSuggestOpen && ragSuggestActive >= 0
                              ? `rag-suggest-opt-${ragSuggestActive}`
                              : undefined
                          }
                          placeholder="Search knowledge base…"
                          value={ragQuery}
                          onChange={(e) => setRagQuery(e.target.value)}
                          onFocus={() => setRagSuggestFocused(true)}
                          onBlur={() => {
                            window.setTimeout(() => setRagSuggestFocused(false), 200)
                          }}
                          onKeyDown={onRagSearchKeyDown}
                        />
                        {ragSuggestOpen ? (
                          <ul
                            id="rag-suggest-listbox"
                            className="rag-suggest-list"
                            role="listbox"
                            aria-label="Knowledge base matches"
                          >
                            {ragSuggestionRows.map((h, i) => (
                              <li
                                key={`${h.sourceId}-${h.chunkId}-${i}`}
                                id={`rag-suggest-opt-${i}`}
                                role="option"
                                aria-selected={i === ragSuggestActive}
                                className={`rag-suggest-option${
                                  i === ragSuggestActive ? ' rag-suggest-option--active' : ''
                                }`}
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  void applyRagSuggestion(h)
                                }}
                                onMouseEnter={() => setRagSuggestActive(i)}
                              >
                                <span className="rag-suggest-option-title">{h.sourceTitle}</span>
                                {h.snippet ? (
                                  <span className="rag-suggest-option-snippet">{h.snippet}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
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
                  </div>
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
                {narrowSlideKb && mobileKbOpen && slideKbEdge === 'right' ? (
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
                {narrowSlideKb && mobileKbOpen && slideKbEdge === 'left' ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize knowledge panel width"
                    className="slide-panel-resize-handle slide-panel-resize-handle--from-left-panel"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const v = clampSlideKb(e.clientX)
                      kbWRef.current = v
                      setSlideKbWidthPx(v)
                      setSlidePanelResizing('kb')
                    }}
                  />
                ) : null}
              </aside>
            </div>
          )}

          {mainView === 'wiki' && (
            <div className="wiki-layout">
              <nav className="wiki-nav" aria-label="Wiki topics">
                <div className="wiki-nav-header">
                  <h3>Library</h3>
                  <input
                    id="wiki-library-search"
                    type="search"
                    className="wiki-search-input"
                    placeholder="Search titles and content…"
                    value={wikiSearchQuery}
                    onChange={(e) => setWikiSearchQuery(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-busy={wikiHasSearch && wikiSearchBusy}
                  />
                  <div className="wiki-nav-actions">
                    <button
                      type="button"
                      className="btn-ingest"
                      onClick={() => void window.api.kbIngestFile().then(() => void loadWiki())}
                    >
                      + Add document
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-wiki-export"
                      disabled={wikiExportBusy}
                      onClick={() => void exportWikiZipToDisk()}
                    >
                      {wikiExportBusy ? 'Exporting…' : 'Export wiki (ZIP)'}
                    </button>
                  </div>
                </div>
                <div className="wiki-topic-list">
                  {wikiTopics.length === 0 && (
                    <p className="muted" style={{ padding: 12 }}>
                      No sources yet. Add a document.
                    </p>
                  )}
                  {wikiTopics.length > 0 && !wikiHasSearch &&
                    WIKI_KIND_ORDER.map((kind) => {
                      const list = wikiBrowseByKind.get(kind) ?? []
                      if (list.length === 0) return null
                      return (
                        <div key={kind} className="wiki-topic-group">
                          <p className="wiki-topic-group-label" id={`wiki-group-${kind}`}>
                            {WIKI_KIND_LABELS[kind]}
                          </p>
                          <div className="wiki-topic-group-list" role="group" aria-labelledby={`wiki-group-${kind}`}>
                            {list.map((t) => (
                              <div key={t.id} className="wiki-library-entry">
                                <button
                                  type="button"
                                  className={`wiki-topic-btn ${wikiSelectedId === t.id ? 'active' : ''}`}
                                  onClick={() => void openWikiPage(t.id)}
                                >
                                  {t.title}
                                  <span className="wiki-topic-meta">{t.chunkCount} sections indexed</span>
                                </button>
                                <WikiEntryRemoveButton
                                  ariaLabel={`Remove ${t.title} from wiki`}
                                  onPress={() => setWikiDeletePending({ id: t.id, title: t.title })}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  {wikiTopics.length > 0 && wikiHasSearch && (
                    <>
                      {wikiTitleMatchTopics.length > 0 && (
                        <p className="wiki-search-section-label">Matching titles</p>
                      )}
                      {wikiTitleMatchKindCount > 1
                        ? WIKI_KIND_ORDER.map((kind) => {
                            const list = wikiTitleMatchByKind.get(kind) ?? []
                            if (list.length === 0) return null
                            return (
                              <div key={kind} className="wiki-topic-group wiki-topic-group--compact">
                                <p className="wiki-topic-group-sublabel" id={`wiki-search-title-${kind}`}>
                                  {WIKI_KIND_LABELS[kind]}
                                </p>
                                <div
                                  className="wiki-topic-group-list"
                                  role="group"
                                  aria-labelledby={`wiki-search-title-${kind}`}
                                >
                                  {list.map((t) => (
                                    <div key={t.id} className="wiki-library-entry">
                                      <button
                                        type="button"
                                        className={`wiki-topic-btn ${wikiSelectedId === t.id ? 'active' : ''}`}
                                        onClick={() => void openWikiPage(t.id)}
                                      >
                                        {t.title}
                                        <span className="wiki-topic-meta">
                                          {t.chunkCount} sections indexed
                                        </span>
                                      </button>
                                      <WikiEntryRemoveButton
                                        ariaLabel={`Remove ${t.title} from wiki`}
                                        onPress={() => setWikiDeletePending({ id: t.id, title: t.title })}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })
                        : wikiTitleMatchTopics.map((t) => (
                            <div key={t.id} className="wiki-library-entry">
                              <button
                                type="button"
                                className={`wiki-topic-btn ${wikiSelectedId === t.id ? 'active' : ''}`}
                                onClick={() => void openWikiPage(t.id)}
                              >
                                {t.title}
                                <span className="wiki-topic-meta">{t.chunkCount} sections indexed</span>
                              </button>
                              <WikiEntryRemoveButton
                                ariaLabel={`Remove ${t.title} from wiki`}
                                onPress={() => setWikiDeletePending({ id: t.id, title: t.title })}
                              />
                            </div>
                          ))}
                      {(wikiContentHits.length > 0 || wikiSearchBusy) && (
                        <p className="wiki-search-section-label">In content</p>
                      )}
                      {wikiSearchBusy && wikiContentHits.length === 0 && (
                        <p className="muted wiki-search-status">Searching…</p>
                      )}
                      {wikiContentHits.map((h) => (
                        <div key={h.sourceId} className="wiki-library-entry">
                          <button
                            type="button"
                            className={`wiki-search-hit-btn ${wikiSelectedId === h.sourceId ? 'active' : ''}`}
                            onClick={() => void openWikiPage(h.sourceId)}
                          >
                            <span className="wiki-search-hit-title-row">
                              <span className="wiki-search-hit-title">{h.sourceTitle}</span>
                              <span className="wiki-source-kind-pill">{WIKI_KIND_LABELS[h.kind]}</span>
                            </span>
                            {h.heading ? (
                              <span className="wiki-search-hit-heading">{h.heading}</span>
                            ) : null}
                            <span className="wiki-search-hit-snippet">{h.snippet}</span>
                          </button>
                          <WikiEntryRemoveButton
                            ariaLabel={`Remove ${h.sourceTitle} from wiki`}
                            onPress={() =>
                              setWikiDeletePending({ id: h.sourceId, title: h.sourceTitle })
                            }
                          />
                        </div>
                      ))}
                      {!wikiSearchBusy &&
                        wikiTitleMatchTopics.length === 0 &&
                        wikiContentHits.length === 0 && (
                          <p className="muted wiki-search-status">No matches for that search.</p>
                        )}
                    </>
                  )}
                </div>
              </nav>
              <div className="wiki-main">
              <article className="wiki-article">
                {wikiTitle ? (
                  <>
                    <div className="wiki-article-inner">
                      <header className="wiki-article-header">
                        <div className="wiki-article-title-row">
                          <h1 className="wiki-article-title">{wikiTitle}</h1>
                          <div className="wiki-article-title-actions">
                            {wikiSelectedKindLabel ? (
                              <span className="wiki-source-kind-pill wiki-source-kind-pill--article">
                                {wikiSelectedKindLabel}
                              </span>
                            ) : null}
                            {wikiSelectedId ? (
                              <WikiEntryRemoveButton
                                ariaLabel={`Remove ${wikiTitle} from wiki`}
                                onPress={() =>
                                  setWikiDeletePending({ id: wikiSelectedId, title: wikiTitle })
                                }
                              />
                            ) : null}
                          </div>
                        </div>
                        <p className="wiki-article-hatnote wiki-lead">
                          Compiled from your ingested sources. Use <strong>Pull into chat</strong> from the Chat view
                          to cite this material.
                        </p>
                      </header>

                      <div className="wiki-article-main mw-parser-output">
                        <WikiArticleTocNav groups={wikiTocGroups} />
                        <ChatRichContent
                          content={wikiBody}
                          className="wiki-rich-body"
                          onRichDomReady={onWikiRichDomReady}
                        />
                      </div>

                      {wikiGlossary.length > 0 ? (
                        <section
                          className="wiki-glossary-panel wiki-article-end-section"
                          aria-label="Glossary"
                        >
                          <h2 className="wiki-section-heading">Glossary</h2>
                          <dl className="wiki-glossary-dl">
                            {wikiGlossary.map((e, gi) => (
                              <div key={`${e.term}-${gi}`} className="wiki-glossary-row">
                                <dt>{e.term}</dt>
                                <dd>{e.definition}</dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      ) : null}

                      {wikiRelated.length > 0 ? (
                        <nav
                          className="wiki-related-panel wiki-article-end-section"
                          aria-label="Related knowledge"
                        >
                          <h2 className="wiki-section-heading">See also</h2>
                          <p className="wiki-related-lead">
                            Other library entries that share topical words with this article (links open in the wiki).
                          </p>
                          <ul className="wiki-related-list">
                            {wikiRelated.map((r) => (
                              <li key={r.id}>
                                <button
                                  type="button"
                                  className="wiki-related-link"
                                  onClick={() => void openWikiPage(r.id)}
                                >
                                  <span className="wiki-related-link-title">{r.title}</span>
                                  <span className="wiki-source-kind-pill wiki-source-kind-pill--inline">
                                    {WIKI_KIND_LABELS[r.kind]}
                                  </span>
                                </button>
                                {r.sharedTerms.length > 0 ? (
                                  <span className="wiki-related-terms">
                                    {r.sharedTerms.map((term) => (
                                      <span key={term} className="wiki-related-term-chip">
                                        {term}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </nav>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="wiki-article-inner wiki-article-empty">
                    <h1 className="wiki-article-title">Your wiki</h1>
                    <p className="wiki-lead">
                      Select a topic or add a document. Content is chunked and searchable from Chat. The{' '}
                      <strong>Knowledge graph</strong> section below shows how sources, chunks, and wiki pages connect.
                    </p>
                  </div>
                )}
              </article>
              <section
                className="wiki-graph-section"
                aria-labelledby="wiki-knowledge-graph-heading"
              >
                <h2 id="wiki-knowledge-graph-heading" className="wiki-graph-section-heading">
                  Knowledge graph
                </h2>
                <div className="wiki-graph-panel-wrap">
                  <KnowledgeGraphView
                    hideToolbarTitle
                    data={kgPayload}
                    loading={kgLoading}
                    onRefresh={() => void loadKnowledgeGraph()}
                    onPickSource={(id) => {
                      void openWikiPage(id)
                    }}
                  />
                </div>
              </section>
              </div>
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
                {drawer === 'settings' && (
                  <>
                    <i className="fa-solid fa-gear" aria-hidden style={{ marginRight: 10, opacity: 0.88 }} />
                    Settings
                  </>
                )}
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
                    <p className="hf-library-runtime-hint muted" style={{ margin: '0 0 12px' }}>
                      <strong>Top bar backend:</strong>{' '}
                      {runtimeKind === 'ollama' ? (
                        <>
                          <span>Ollama</span> — installing pulls into the Ollama library at your configured API URL. Hub
                          cards with a preset tag can <strong>Pull</strong> in one click; others need a name under
                          “Selected model”.
                        </>
                      ) : (
                        <>
                          <span>llama.cpp</span> — installing downloads <code>.gguf</code> files into your models folder
                          (same as the Run panel).
                        </>
                      )}
                    </p>
                    {hfLibraryMode === 'recommended' && (
                      <p className="muted" style={{ margin: '0 0 12px' }}>
                        Curated GGUF-friendly picks. Sort and filter by likes, downloads, or total repo size. Lists below
                        split what is already installed versus what you can add. Search replaces this list until you go
                        back.
                      </p>
                    )}
                    {hfLibraryMode === 'search' && (
                      <p className="muted" style={{ margin: '0 0 12px' }}>
                        Sort and filter apply to this result set. Install uses the active backend (Ollama pull vs. Hub file
                        download for llama.cpp).
                      </p>
                    )}
                    {runtimeKind === 'llamacpp' && localModelFilePaths.length > 0 ? (
                      <div className="hf-library-disk-block" role="region" aria-label="Weights on disk">
                        <h4 className="hf-library-subheading">.gguf files in your models folder</h4>
                        <ul className="hf-library-disk-list muted">
                          {localModelFilePaths.map((p) => (
                            <li key={p}>
                              <code className="inline-code">{fileNameFromPath(p)}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {runtimeKind === 'ollama' ? (
                      <div className="hf-library-disk-block" role="region" aria-label="Ollama library">
                        <h4 className="hf-library-subheading">Models in your Ollama library</h4>
                        {ollamaChatTagsLoading ? (
                          <p className="muted" style={{ margin: 0 }}>
                            Loading…
                          </p>
                        ) : ollamaChatTagsErr ? (
                          <p className="muted" style={{ margin: 0 }}>
                            {ollamaChatTagsErr}
                          </p>
                        ) : ollamaChatTags.length === 0 ? (
                          <p className="muted" style={{ margin: 0 }}>
                            None reported yet. Pull a model below or from the Run panel.
                          </p>
                        ) : (
                          <ul className="hf-library-disk-list hf-library-disk-list--tags">
                            {ollamaChatTags.map((tag) => (
                              <li key={tag}>
                                <code className="inline-code">{tag}</code>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
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
                    {!hfListLoading && hfDisplayModels.length > 0 ? (
                      <>
                        <h4 className="hf-library-subheading hf-library-subheading--list">In this list — installed</h4>
                        {hfHubInstalledModels.length === 0 ? (
                          <p className="muted hf-library-column-empty">Nothing from this list yet for the current backend.</p>
                        ) : (
                          <div className="hf-model-cards-list hf-model-cards-list--installed">
                            {hfHubInstalledModels.map((m) => renderHfHubCard(m))}
                          </div>
                        )}
                        <h4 className="hf-library-subheading hf-library-subheading--list">Available to install</h4>
                        {hfHubAvailableModels.length === 0 ? (
                          <p className="muted hf-library-column-empty">All filtered models are already installed.</p>
                        ) : (
                          <div className="hf-model-cards-list">
                            {hfHubAvailableModels.map((m) => renderHfHubCard(m))}
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                  <div className="drawer-section">
                    <h3>
                      Selected model —{' '}
                      {runtimeKind === 'ollama' ? 'Ollama pull' : 'files & folder'}
                    </h3>
                    {!detail && (
                      <p className="muted">
                        {runtimeKind === 'ollama'
                          ? 'Select a Hub model above. You can pull any Ollama library name, or use a preset tag when the card lists one.'
                          : 'Select a model above to choose a specific file and download folder.'}
                      </p>
                    )}
                    {detail && (
                      <>
                        <p className="muted">{detail.description?.slice(0, 320) ?? '—'}</p>
                        <p className="muted">Total ~{(detail.totalSizeBytes / 1e9).toFixed(2)} GB (file sum)</p>
                        {runtimeKind === 'llamacpp' ? (
                          hfHardwareEval ? (
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
                          )
                        ) : null}
                        {runtimeKind === 'ollama' ? (
                          <>
                            <label className="runtime-field-label" htmlFor="hf-ollama-pull-name">
                              Ollama model name
                            </label>
                            <input
                              id="hf-ollama-pull-name"
                              className="input"
                              style={{ marginBottom: 8 }}
                              value={ollamaHubPullNameDraft}
                              onChange={(e) => setOllamaHubPullNameDraft(e.target.value)}
                              placeholder="e.g. llama3.2, qwen2.5:3b"
                              disabled={hfOllamaPullBusy}
                            />
                            <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
                              Pulled models appear in the Ollama library list above and in the top bar model menu.
                            </p>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={hfOllamaPullBusy || !ollamaHubPullNameDraft.trim()}
                              onClick={() => void startDownload()}
                            >
                              {hfOllamaPullBusy ? 'Pulling…' : 'Pull model'}
                            </button>
                            {selectedModel &&
                            hfOllamaPullRepoId === selectedModel &&
                            hfOllamaPullProgress?.message ? (
                              <div className="hf-detail-download-progress" style={{ marginTop: 12 }}>
                                <DownloadProgressBar
                                  compact
                                  pct={
                                    hfOllamaPullProgress.percent != null
                                      ? hfOllamaPullProgress.percent
                                      : null
                                  }
                                  meta={
                                    hfOllamaPullProgress.percent != null
                                      ? `${hfOllamaPullProgress.percent}% · ${hfOllamaPullProgress.message}`
                                      : hfOllamaPullProgress.message
                                  }
                                />
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <select
                              className="select"
                              value={downloadFile}
                              onChange={(e) => setDownloadFile(e.target.value)}
                              style={{ marginBottom: 8 }}
                            >
                              <option value="">Choose file</option>
                              {detail.siblings?.map((s) => (
                                <option key={s.path} value={s.path}>
                                  {s.path}
                                </option>
                              ))}
                            </select>
                            <input
                              className="input"
                              placeholder="Download folder"
                              value={destDir}
                              onChange={(e) => setDestDir(e.target.value)}
                              style={{ marginBottom: 8 }}
                            />
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
                      </>
                    )}
                  </div>
                </>
              )}

              {drawer === 'runtime' && (
                <>
                  {personalityModelKey ? (
                    <div className="drawer-section model-profile-panel" aria-label="Model profile">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-address-card" aria-hidden />
                        Model profile
                      </h3>
                      <p className="muted model-profile-panel-model" title={personalityModelKey}>
                        {looksLikeLocalModelFilePath(personalityModelKey)
                          ? fileNameFromPath(personalityModelKey)
                          : personalityModelKey}
                      </p>
                      <p className="muted model-profile-panel-lead">
                        Mood shapes the background glow. The journal collects optional first-person notes the model adds
                        via hidden markers at the end of its replies.
                      </p>
                      <div className="model-profile-traits" aria-label="Mood traits">
                        {MODEL_PROFILE_VIBE_LABELS.map(({ key, label }) => {
                          const v = modelProfile.vibe[key]
                          const widthPct = Math.min(
                            100,
                            Math.max(0, key === 'hueShift' ? ((v + 1) / 2) * 100 : v * 100)
                          )
                          return (
                            <div key={key} className="model-profile-trait">
                              <span className="model-profile-trait-label">{label}</span>
                              <div className="model-profile-trait-track">
                                <div className="model-profile-trait-fill" style={{ width: `${widthPct}%` }} />
                              </div>
                              <span className="model-profile-trait-value">
                                {key === 'hueShift' ? v.toFixed(2) : `${Math.round(v * 100)}%`}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="model-profile-journal-toolbar">
                        <h4 className="model-profile-journal-title">Journal</h4>
                        <button
                          type="button"
                          className="btn-ghost-sm"
                          onClick={() => clearModelProfileStorage()}
                        >
                          Reset profile
                        </button>
                      </div>
                      {modelProfile.journal.length === 0 ? (
                        <p className="muted model-profile-journal-empty">No entries yet.</p>
                      ) : (
                        <ul className="model-profile-journal-list">
                          {[...modelProfile.journal]
                            .slice()
                            .reverse()
                            .map((e) => (
                              <li key={e.id} className="model-profile-journal-item">
                                <time
                                  className="model-profile-journal-time"
                                  dateTime={new Date(e.createdAt).toISOString()}
                                  title={chatTimeTitle(e.createdAt)}
                                >
                                  {formatChatTimestamp(e.createdAt)}
                                </time>
                                <p className="model-profile-journal-text">{e.text}</p>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  ) : null}

                  {runtimeOn ? (
                    <div className="runtime-loaded-hero" role="region" aria-label="Loaded model">
                      <div className="runtime-loaded-hero-header">
                        <span className="runtime-loaded-hero-badge">Active</span>
                        <button type="button" className="btn-ghost-sm" onClick={() => void refreshRunDrawer()}>
                          Refresh
                        </button>
                      </div>
                      <p className="runtime-loaded-hero-kicker">Model in memory</p>
                      <h3 className="runtime-loaded-hero-title">{loadedModelTitle}</h3>
                      <p className="runtime-loaded-hero-meta">
                        {runtimeStatus ? (
                          <>
                            <span>{runtimeKindLabel(runtimeStatus.kind)}</span>
                            {runtimeStatus.endpoint ? (
                              <>
                                <span className="runtime-loaded-hero-meta-sep"> · </span>
                                <code className="inline-code">{runtimeStatus.endpoint}</code>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">Loading…</span>
                        )}
                      </p>
                      {runtimeStatus && typeof runtimeStatus.pid === 'number' ? (
                        <p className="muted runtime-loaded-hero-pid">Process PID {runtimeStatus.pid}</p>
                      ) : null}
                      <div className="runtime-loaded-hero-actions">
                        <button type="button" className="btn-primary" onClick={() => void stopRuntime()}>
                          Unload model
                        </button>
                      </div>
                      {runtimeStatus?.lastError ? (
                        <p className="runtime-status-error" role="alert">
                          {runtimeStatus.lastError}
                        </p>
                      ) : null}
                      {runtimeStatus ? (
                        <details className="runtime-raw-toggle">
                          <summary>Technical details</summary>
                          <pre className="code-block" style={{ marginTop: 8 }}>
                            {JSON.stringify(runtimeStatus, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}

                  {!runtimeOn ? (
                    <>
                  <div className="drawer-section runtime-load-card">
                    <h3 className="runtime-load-card-title">Runtime setup</h3>
                    <p className="muted runtime-load-card-lead">
                      Choose backend, model, and <strong>Start</strong> in the top bar. Use this panel for Ollama install,
                      llama-server binary, and downloads.
                    </p>
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
                    {runtimeKind === 'ollama' &&
                    ollamaChatTags.length > 0 &&
                    !ollamaChatTagsLoading &&
                    !ollamaChatTagsErr ? (
                      <div className="runtime-model-purge" role="group" aria-label="Remove Ollama models">
                        <div className="runtime-model-purge-title">Remove models from Ollama</div>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
                          Checked tags are removed from the Ollama library on disk. Stop the runtime first if a model is
                          loaded.
                        </p>
                        <ul className="runtime-model-purge-list">
                          {ollamaChatTags.map((tag, i) => (
                            <li key={tag} className="runtime-model-purge-row">
                              <input
                                type="checkbox"
                                id={`ollama-purge-${i}`}
                                checked={ollamaDeleteMarks.includes(tag)}
                                disabled={runtimeStarting || modelPurgeBusy}
                                onChange={() => toggleOllamaDeleteMark(tag)}
                              />
                              <label htmlFor={`ollama-purge-${i}`}>
                                <code className="inline-code">{tag}</code>
                              </label>
                            </li>
                          ))}
                        </ul>
                        <div className="runtime-model-purge-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={
                              runtimeStarting || modelPurgeBusy || ollamaDeleteMarks.length === 0
                            }
                            onClick={() => void deleteMarkedOllamaModels()}
                          >
                            {modelPurgeBusy ? 'Removing…' : 'Delete selected from Ollama'}
                          </button>
                        </div>
                      </div>
                    ) : null}
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
                      <code className="inline-code">{llamaEnv.resolvedPath}</code> from PATH. Save by starting a model from
                      the top bar or paste a binary path below.
                    </p>
                  ) : null}
                    {runtimeKind === 'llamacpp' ? (
                      <p className="muted runtime-field-hint-inline">
                        .gguf scan folder:{' '}
                        <span className="runtime-local-models-dir">{paths?.modelsDefault ?? '—'}</span>
                      </p>
                    ) : null}
                    {runtimeKind === 'llamacpp' ? (
                      <>
                        <label className="runtime-field-label" htmlFor="runtime-llama-bin-input">
                          llama-server binary
                        </label>
                        {llamaEnv?.detected && llamaEnv.configuredValid ? (
                          <p className="muted runtime-llama-ok">Saved path looks valid.</p>
                        ) : null}
                        <input
                          id="runtime-llama-bin-input"
                          className="input"
                          value={llamaBin}
                          disabled={runtimeStarting}
                          onChange={(e) => setLlamaBin(e.target.value)}
                          placeholder="Path to llama-server"
                        />
                      </>
                    ) : null}
                    {runtimeKind === 'llamacpp' && localModelFilePaths.length > 0 ? (
                      <div className="runtime-model-purge" role="group" aria-label="Delete local GGUF files">
                        <div className="runtime-model-purge-title">Delete local .gguf files</div>
                        <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
                          Permanently removes files from the configured models folder. Stop the runtime first if one of
                          these is loaded.
                        </p>
                        <ul className="runtime-model-purge-list">
                          {localModelFilePaths.map((p, i) => (
                            <li key={p} className="runtime-model-purge-row">
                              <input
                                type="checkbox"
                                id={`gguf-purge-${i}`}
                                checked={localGgufDeleteMarks.includes(p)}
                                disabled={runtimeStarting || modelPurgeBusy}
                                onChange={() => toggleLocalGgufDeleteMark(p)}
                              />
                              <label htmlFor={`gguf-purge-${i}`}>
                                <code className="inline-code">{fileNameFromPath(p)}</code>
                                <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                                  {p}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        <div className="runtime-model-purge-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={
                              runtimeStarting || modelPurgeBusy || localGgufDeleteMarks.length === 0
                            }
                            onClick={() => void deleteMarkedLocalGgufs()}
                          >
                            {modelPurgeBusy ? 'Deleting…' : 'Delete selected files'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="row runtime-load-primary-actions">
                      <button type="button" className="btn-secondary" onClick={() => void refreshRunDrawer()}>
                        Refresh status
                      </button>
                    </div>
                  </div>

                  <details className="runtime-drawer-advanced">
                    <summary>Hub downloads &amp; copy path</summary>
                    <div className="drawer-section runtime-drawer-advanced-body">
                      <p className="muted" style={{ marginTop: 0 }}>
                        Finished downloads (newest first). “Use path” fills the top bar model field for llama.cpp.
                      </p>
                      <p className="muted">
                        Default save folder:{' '}
                        <span className="runtime-downloads-default-path">{paths?.modelsDefault ?? '—'}</span>{' '}
                        <button type="button" className="btn-ghost-sm" onClick={() => setDrawer('settings')}>
                          Settings
                        </button>
                      </p>
                      {localDownloads.length === 0 ? (
                        <p className="muted">No downloads yet. Use the Models (Hub) tool.</p>
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
                                        disabled={runtimeStarting}
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
                  </details>

                  {!runtimeStatus ? <p className="muted runtime-runtime-footnote">Checking runtime…</p> : null}
                  {runtimeStatus && !runtimeStatus.running && runtimeStatus.lastError ? (
                    <p className="runtime-status-error" role="alert">
                      {runtimeStatus.lastError}
                    </p>
                  ) : null}
                  {runtimeStatus ? (
                    <details className="runtime-raw-toggle">
                      <summary>Raw status JSON</summary>
                      <pre className="code-block" style={{ marginTop: 8 }}>
                        {JSON.stringify(runtimeStatus, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                    </>
                  ) : null}
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
                <div className="settings-page">
                  <section className="settings-group" aria-labelledby="settings-grp-look">
                    <h2 id="settings-grp-look" className="settings-group-heading">
                      <i className="fa-solid fa-palette" aria-hidden />
                      Look &amp; layout
                    </h2>
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-swatchbook" aria-hidden />
                        Appearance
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Accent palette for buttons, highlights, and chat accents. Secondary panels use a light glass treatment so the backdrop shows
                        through.
                      </p>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-droplet" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
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
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-table-columns" aria-hidden />
                        Chat slide panels
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        On medium widths the knowledge panel slides over the chat; at ≤720px the chat list does too. Wide layouts keep fixed columns.
                      </p>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-comments" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Chats list slides in from (≤720px)
                        </span>
                        <select
                          className="select"
                          style={{ width: '100%', maxWidth: 320 }}
                          value={slideConvEdge}
                          onChange={(e) => {
                            const v = e.target.value as SlidePanelEdge
                            setSlideConvEdge(v)
                            persistSlideEdge(LS_SLIDE_CONV_EDGE, v)
                          }}
                        >
                          <option value="left">Left edge</option>
                          <option value="right">Right edge</option>
                        </select>
                      </label>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-book" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Knowledge panel slides in from (≤1100px)
                        </span>
                        <select
                          className="select"
                          style={{ width: '100%', maxWidth: 320 }}
                          value={slideKbEdge}
                          onChange={(e) => {
                            const v = e.target.value as SlidePanelEdge
                            setSlideKbEdge(v)
                            persistSlideEdge(LS_SLIDE_KB_EDGE, v)
                          }}
                        >
                          <option value="left">Left edge</option>
                          <option value="right">Right edge</option>
                        </select>
                      </label>
                    </div>
                  </section>

                  <section className="settings-group" aria-labelledby="settings-grp-chat">
                    <h2 id="settings-grp-chat" className="settings-group-heading">
                      <i className="fa-solid fa-comments" aria-hidden />
                      Chat &amp; knowledge
                    </h2>
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                        Generation &amp; wiki
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Caps how many tokens the model may generate per reply (Ollama <code className="inline-code">num_predict</code>, llama.cpp{' '}
                        <code className="inline-code">max_tokens</code>). Takes effect on the next message.
                      </p>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-hashtag" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Max response tokens
                        </span>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', maxWidth: 200 }}
                          min={CHAT_MAX_TOKENS_MIN}
                          max={CHAT_MAX_TOKENS_MAX}
                          value={chatMaxTokensDraft}
                          onChange={(e) => setChatMaxTokensDraft(e.target.value)}
                          onBlur={() => {
                            const n = parseInt(chatMaxTokensDraft.trim(), 10)
                            const v = clampChatMaxTokens(Number.isFinite(n) ? n : CHAT_MAX_TOKENS_DEFAULT)
                            setChatMaxTokensDraft(String(v))
                            void window.api.setConfig({ chatMaxTokens: v })
                          }}
                        />
                      </label>
                      <label className="metrics-widget-check" style={{ marginTop: 16 }}>
                        <input
                          type="checkbox"
                          checked={wikiAutoExtract}
                          onChange={(e) => {
                            const v = e.target.checked
                            setWikiAutoExtract(v)
                            void window.api.setConfig({ wikiAutoExtract: v })
                          }}
                        />
                        <span>
                          <i className="fa-solid fa-book-open" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                          Auto-extract wiki notes after each reply
                        </span>
                      </label>
                      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                        Runs a short second pass on the local model to distill bullet notes into the knowledge base. Notes are linked to the conversation so
                        they can be removed with <strong>Save chat to knowledge base</strong>–style cleanup when you delete the chat. Turn off to save time and
                        tokens.
                      </p>
                    </div>
                  </section>

                  <section className="settings-group" aria-labelledby="settings-grp-integ">
                    <h2 id="settings-grp-integ" className="settings-group-heading">
                      <i className="fa-solid fa-plug" aria-hidden />
                      Integrations
                    </h2>
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-code" aria-hidden />
                        IDE bridge (localhost)
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        HTTP API on <strong>127.0.0.1</strong> for IntelliJ and other tools. Start the model runtime in this app first. Sample plugin and API
                        notes live under <code className="inline-code">integrations/intellij-plugin</code> and <code className="inline-code">docs/intellij-integration.md</code>.
                      </p>
                      <label className="metrics-widget-check" style={{ marginTop: 12 }}>
                        <input
                          type="checkbox"
                          checked={integrationListenEnabled}
                          onChange={(e) => {
                            const v = e.target.checked
                            setIntegrationListenEnabled(v)
                            void window.api.setConfig({ integrationListenEnabled: v })
                          }}
                        />
                        <span>
                          <i className="fa-solid fa-tower-broadcast" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                          Enable HTTP bridge for plugins
                        </span>
                      </label>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-network-wired" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Port
                        </span>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', maxWidth: 200 }}
                          min={1024}
                          max={65535}
                          value={integrationPortDraft}
                          onChange={(e) => setIntegrationPortDraft(e.target.value)}
                          onBlur={() => {
                            const n = parseInt(integrationPortDraft.trim(), 10)
                            const v = clampIntegrationPort(Number.isFinite(n) ? n : INTEGRATION_PORT_DEFAULT)
                            setIntegrationPortDraft(String(v))
                            void window.api.setConfig({ integrationPort: v })
                          }}
                        />
                      </label>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-key" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Optional bearer token (if set, required for <code className="inline-code">/v1/*</code> only)
                        </span>
                        <input
                          type="password"
                          className="input"
                          style={{ width: '100%', maxWidth: 360 }}
                          autoComplete="off"
                          value={integrationTokenDraft}
                          onChange={(e) => setIntegrationTokenDraft(e.target.value)}
                          onBlur={() => void window.api.setConfig({ integrationToken: integrationTokenDraft })}
                        />
                      </label>
                    </div>
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-cloud-arrow-down" aria-hidden />
                        Hugging Face
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Token used for Hub downloads and private models. Stored with OS secure storage when you save.
                      </p>
                      <input
                        type="password"
                        className="input"
                        placeholder="hf_…"
                        value={hfTokenInput}
                        onChange={(e) => setHfTokenInput(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary settings-btn-icon"
                        style={{ marginTop: 8 }}
                        onClick={() => void window.api.setHfToken(hfTokenInput || null).then(() => setHfTokenInput(''))}
                      >
                        <i className="fa-solid fa-floppy-disk" aria-hidden />
                        Save token
                      </button>
                    </div>
                  </section>

                  <section className="settings-group" aria-labelledby="settings-grp-storage">
                    <h2 id="settings-grp-storage" className="settings-group-heading">
                      <i className="fa-solid fa-hard-drive" aria-hidden />
                      Storage &amp; paths
                    </h2>
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-folder-open" aria-hidden />
                        Model install location
                      </h3>
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
                        <button
                          type="button"
                          className="btn-secondary settings-btn-icon"
                          onClick={() => void pickModelsInstallFolder()}
                        >
                          <i className="fa-solid fa-folder-tree" aria-hidden />
                          Browse…
                        </button>
                        <button
                          type="button"
                          className="btn-primary settings-btn-icon"
                          onClick={() => void saveModelsInstallLocation()}
                        >
                          <i className="fa-solid fa-floppy-disk" aria-hidden />
                          Save location
                        </button>
                        <button
                          type="button"
                          className="btn-secondary settings-btn-icon"
                          onClick={() => void resetModelsInstallToDefault()}
                        >
                          <i className="fa-solid fa-rotate-left" aria-hidden />
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
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-map" aria-hidden />
                        Data paths (read-only)
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Internal paths the app uses for chats, KB, wiki, and caches—useful when backing up or scripting.
                      </p>
                      <pre className="code-block">{JSON.stringify(paths, null, 2)}</pre>
                    </div>
                  </section>

                  <section className="settings-group" aria-labelledby="settings-grp-widgets">
                    <h2 id="settings-grp-widgets" className="settings-group-heading">
                      <i className="fa-solid fa-gauge-high" aria-hidden />
                      Widgets &amp; refresh
                    </h2>
                    {metricsWidgetControls}
                  </section>

                  <section className="settings-group settings-group--danger" aria-labelledby="settings-grp-maint">
                    <h2 id="settings-grp-maint" className="settings-group-heading">
                      <i className="fa-solid fa-triangle-exclamation" aria-hidden />
                      Maintenance
                    </h2>
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-wrench" aria-hidden />
                        Caches, models, &amp; reset
                      </h3>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Destructive actions are confirmed in a dialog. Use them when troubleshooting or reclaiming disk space.
                      </p>
                      <div className="settings-danger-actions">
                        <button
                          type="button"
                          className="btn-secondary settings-btn-icon"
                          disabled={settingsMaintenanceBusy !== false}
                          onClick={() => setSettingsConfirmKind('caches')}
                        >
                          <i className="fa-solid fa-broom" aria-hidden />
                          {settingsMaintenanceBusy === 'caches' ? 'Working…' : 'Clear all caches'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger settings-btn-icon"
                          disabled={settingsMaintenanceBusy !== false}
                          onClick={() => setSettingsConfirmKind('models')}
                        >
                          <i className="fa-solid fa-trash-can" aria-hidden />
                          {settingsMaintenanceBusy === 'models' ? 'Deleting…' : 'Delete all models'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger settings-btn-icon"
                          disabled={settingsMaintenanceBusy !== false}
                          onClick={() => setSettingsConfirmKind('factory')}
                        >
                          <i className="fa-solid fa-rotate-left" aria-hidden />
                          {settingsMaintenanceBusy === 'factory' ? 'Resetting…' : 'Reset settings to defaults'}
                        </button>
                      </div>
                      {settingsMaintenanceMessage ? (
                        <p className="settings-action-success" role="status">
                          <i className="fa-solid fa-circle-check" aria-hidden style={{ marginRight: 8 }} />
                          {settingsMaintenanceMessage}
                        </p>
                      ) : null}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
