import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactElement
} from 'react'
import type { AppBlockingIssue } from '@shared/appBlockingIssues'
import type {
  CodebaseAnalysisSnapshot,
  DmsConnectionSummary,
  DmsFolderSummary,
  DmsImportRootSummary,
  DmsProvider,
  DmsSyncProgress,
  DownloadRow,
  DomainModelVersion,
  DomainProfile,
  HardwareSummary,
  DeepLearnExplorePath,
  EvidenceCard,
  IntegrationModelActivityEvent,
  KbDomainOption,
  KbIngestFileProgress,
  HfModelDetail,
  HfModelSummary,
  KbSearchHit,
  KbImportConfidence,
  KnowledgeGraphPayload,
  OntologyEntityDetails,
  OntologyQueryRequest,
  OntologyStats,
  OntologySubgraphPayload,
  MetricsSnapshot,
  PluginIntegrationReport,
  RuntimeLoadProgress,
  RuntimeStatus,
  WikiChatHighlightTerm,
  WikiKeywordCandidate,
  WikiGlossaryEntry,
  WikiPassageSummary,
  WikiReanalyzeProgress,
  WikiReanalyzeResult,
  WikiRelatedSource,
  WikiTopic,
  WikiSourceKind,
  PromptDomainRow,
  KbSource,
  TrainJob,
  MessageRow,
  MessageAppendResponse
} from '@shared/types'
import type { AppUpdateStatusPayload } from '@shared/appUpdate'
import type { KnowledgeGraphAnalysisResult } from '@shared/knowledgeGraphAnalysis'
import { MAX_PROMPT_DOMAIN_SUFFIX_CHARS } from '@shared/promptDomains'
import { hfResolveRevision, pickPrimaryHubWeightFile } from '@shared/hfGgufPick'
import { hubWeightDownloadPathSet } from '@shared/hfDownloadBundle'
import { DEFAULT_OLLAMA_MODEL_TAG } from '@shared/defaultRuntimeModel'
import {
  clampLlamaContextTokens,
  LLAMA_CONTEXT_TOKENS_DEFAULT,
  LLAMA_CONTEXT_TOKENS_MAX,
  LLAMA_CONTEXT_TOKENS_MIN
} from '@shared/llamaContext'
import {
  AGENT_PLANNER_MAX_TOKENS,
  AGENT_WORKER_MAX_TOKENS,
  buildAgentPlannerSystemPrompt,
  buildSynthesisMessages,
  buildWorkerMessages,
  parseAgentPlanFromModelReply
} from '@shared/agenticChat'
import type { ColorSchemeId } from '@shared/colorScheme'
import {
  COLOR_SCHEME_IDS,
  COLOR_SCHEME_LABELS,
  DEFAULT_COLOR_SCHEME,
  parseColorScheme
} from '@shared/colorScheme'
import {
  DEFAULT_TYPOGRAPHY_COMFORT,
  TYPOGRAPHY_COMFORT_IDS,
  TYPOGRAPHY_COMFORT_LABELS,
  parseTypographyComfort,
  type TypographyComfortId
} from '@shared/typographyComfort'
import {
  DEFAULT_TYPOGRAPHY_FONT_FAMILY,
  DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM,
  DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR,
  DEFAULT_TYPOGRAPHY_WORD_SPACING_EM,
  TYPOGRAPHY_FONT_FAMILY_IDS,
  TYPOGRAPHY_FONT_FAMILY_LABELS,
  TYPOGRAPHY_LETTER_EXTRA_EM_MAX,
  TYPOGRAPHY_LETTER_EXTRA_EM_MIN,
  TYPOGRAPHY_LINE_HEIGHT_FACTOR_MAX,
  TYPOGRAPHY_LINE_HEIGHT_FACTOR_MIN,
  TYPOGRAPHY_WORD_SPACING_EM_MAX,
  clampTypographyLetterSpacingExtraEm,
  clampTypographyLineHeightFactor,
  clampTypographyWordSpacingEm,
  parseTypographyFontFamily,
  parseTypographyLetterSpacingExtraEm,
  parseTypographyLineHeightFactor,
  parseTypographyWordSpacingEm,
  type TypographyFontFamilyId
} from '@shared/typographyTune'
import { applyTypographyFineTuneToDocument } from './typographyTuneDom'
import { applyColorSchemeToDocument } from './colorSchemeDom'
import {
  appendJournalTexts,
  CHAT_MINIMAL_SYSTEM_PROMPT,
  defaultModelProfile,
  loadModelProfile,
  mergePersonalityPatches,
  MODEL_PROFILE_SYSTEM_PROMPT,
  RAG_GROUNDING_INSTRUCTION,
  profileStorageKey,
  saveModelProfile,
  stripChatAssistantVisibleMarkers,
  stripModelProfileMarkers,
  stripPartialProfileStreamTail,
  userMessageInvitesModelPersonality,
  type ModelProfile,
  type ModelPersonalityVibe
} from '@shared/modelPersonality'
import {
  chatHistoryMaxMessagesFromConfig,
  estimatePromptTokensFromChars,
  promptLikelyExceedsContext,
  ragReplyMissingSnippetCitations,
  sliceChatHistoryMessages
} from '@shared/chatContextBudget'
import { postProcessAssistantChatMarkdown } from '@shared/chatResponsePostProcess'
import { parseDeepLearnIntent } from '@shared/deepLearnIntent'
import { DownloadProgressBar, downloadRowProgressPct, fileNameFromPath, formatBytes } from './downloadProgressUi'
import { ActivityPinnedWidget, type ActivityChatTokens } from './ActivityPinnedWidget'
import type { ActivityTokenHistoryPoint } from './ActivityTokenSessionChart'
import { ChatRichContent } from './ChatRichContent'
import { DownloadsPinnedWidget } from './DownloadsPinnedWidget'
import { FloatingDots } from './FloatingDots'
import { ModelPresenceBackdrop } from './ModelPresenceBackdrop'
import { PresenceWakeOverlay } from './PresenceWakeOverlay'
import { touchPresenceSessionHidden } from './presenceSession'
import { MetricsTimeSeries } from './MetricsTimeSeries'
import { IssuesPinnedWidget } from './IssuesPinnedWidget'
import { MetricsPinnedWidget } from './MetricsPinnedWidget'
import { KnowledgeGraphView } from './KnowledgeGraphView'
import { OntologyView } from './OntologyView'
import { HfModelBrowserDrawer } from './components/HfModelBrowserDrawer'
import { buildWikiTocGroupsFromRoot, WikiArticleTocNav, type WikiTocGroup } from './WikiArticleToc'
import { ElectronDevDashboard } from './ElectronDevDashboard'
import { ReleaseReadinessView, defaultReleaseFeatureSet, normalizeReleaseFeatureSet } from './ReleaseReadinessView'
import { TrainMainView } from './TrainMainView'
import { ArchitectureRepositoryView } from './ArchitectureRepositoryView'
import { CodebaseFormalSettingsSection } from './CodebaseFormalSettingsSection'
import { CodebaseLandscapeView } from './CodebaseLandscapeView'
import { ViewToastRegion } from './ViewToastRegion'
import { notifyWhenBackground, setViewToastNavigation } from './viewToastBus'
import { SetupRoleTour, type SetupTourFinishPayload } from './SetupRoleTour'
import {
  ActionDock,
  ContextRail,
  PrimaryWork,
  RoleWorkspaceShell,
  UnifiedCommandSurfaceButton
} from './RoleWorkspaceShell'
import { WIKI_KIND_LABELS, WIKI_KIND_ORDER, groupWikiTopicsByKind, wikiSidebarRowsForKind } from '@shared/wikiSourceGroups'
import { defaultIdeJourneyChecklist, mergeIdeJourneyChecklist, type IdeJourneyChecklist } from '@shared/ideJourney'
import {
  WELCOME_GUIDE_LATEST,
  SETUP_TOUR_LATEST,
  DEFAULT_UI_ROLE,
  WORKSPACE_DENSITY_IDS,
  parseWorkspaceDensity,
  parseUiRole,
  parseUiRoleOrDefault,
  roleLayout,
  layoutDefaultMainArea,
  devShellChromeVisible,
  clampMainViewForLayout,
  APP_MAIN_VIEW_COPY,
  isAdvancedMainView,
  type UiRole,
  type AppMainView,
  type WorkspaceDensity,
  type WorkspaceStatusLabel,
  type SettingsSectionId,
  type SetupTourAction,
  type ToolDrawerId,
  UI_ROLE_CARD_BLURBS,
  UI_ROLE_IDS,
  UI_ROLE_LABELS
} from '@shared/uiRole'

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

/** One kind bucket in the wiki sidebar: chat notes with the same keyword render as a nested group. */
function WikiLibraryKindRows(props: {
  kind: WikiSourceKind
  topics: WikiTopic[]
  compact?: boolean
  wikiSelectedId: string | null
  onOpenPage: (sourceId: string) => void
  onRequestRemove: (id: string, title: string) => void
}): ReactElement {
  const rows = wikiSidebarRowsForKind(props.kind, props.topics)
  const groupMod = props.compact ? ' wiki-sidebar-note-group--compact' : ''

  return (
    <>
      {rows.map((row) =>
        row.rowKind === 'topic' ? (
          <div key={row.topic.id} className="wiki-library-entry">
            <button
              type="button"
              className={`wiki-topic-btn ${props.wikiSelectedId === row.topic.id ? 'active' : ''}`}
              onClick={() => props.onOpenPage(row.topic.id)}
            >
              {row.topic.title}
              <span className="wiki-topic-meta">{row.topic.chunkCount} sections indexed</span>
            </button>
            <WikiEntryRemoveButton
              ariaLabel={`Remove ${row.topic.title} from wiki`}
              onPress={() => props.onRequestRemove(row.topic.id, row.topic.title)}
            />
          </div>
        ) : (
          <details key={row.groupKey} className={`wiki-sidebar-note-group${groupMod}`} open>
            <summary className="wiki-sidebar-note-group-summary">
              <span className="wiki-sidebar-note-group-title">{row.label}</span>
              <span className="wiki-topic-meta">{row.topics.length} notes</span>
            </summary>
            <div
              className="wiki-sidebar-note-group-entries"
              role="group"
              aria-label={`${row.label}: ${row.topics.length} chat notes`}
            >
              {row.topics.map((t, i) => (
                <div key={t.id} className="wiki-library-entry wiki-library-entry--nested">
                  <button
                    type="button"
                    className={`wiki-topic-btn ${props.wikiSelectedId === t.id ? 'active' : ''}`}
                    onClick={() => props.onOpenPage(t.id)}
                    aria-label={`${row.label}, note ${i + 1} of ${row.topics.length}, ${t.chunkCount} sections indexed`}
                  >
                    <span className="wiki-sidebar-note-index">#{i + 1}</span>
                    <span className="wiki-topic-meta">{t.chunkCount} sections indexed</span>
                  </button>
                  <WikiEntryRemoveButton
                    ariaLabel={`Remove ${row.label} (note ${i + 1} of ${row.topics.length}) from wiki`}
                    onPress={() => props.onRequestRemove(t.id, t.title)}
                  />
                </div>
              ))}
            </div>
          </details>
        )
      )}
    </>
  )
}

const PRESENCE_WAKE_SHOWN_SESSION_KEY = 'localLlm:presenceWakeShown:v1'
const AUTO_RESUME_ONCE_SESSION_KEY = 'localLlm:autoResumeOnce:v1'

const LLAMA_LOAD_LOG_MAX_CHARS = 250_000
const LS_LLAMA_CONSOLE_EXPANDED = 'llamaLoadConsoleExpanded'
const LS_LLAMA_CONSOLE_HEIGHT_PX = 'llamaLoadConsoleHeightPx'
const LLAMA_CONSOLE_H_MIN = 64
const LLAMA_CONSOLE_H_DEFAULT = 168
const LLAMA_CONSOLE_H_MAX_CAP = 560

function clampLlamaConsoleHeight(h: number): number {
  const max = Math.min(LLAMA_CONSOLE_H_MAX_CAP, Math.floor(window.innerHeight * 0.62))
  const lo = Math.min(LLAMA_CONSOLE_H_MIN, max)
  if (!Number.isFinite(h)) return Math.min(LLAMA_CONSOLE_H_DEFAULT, max)
  return Math.min(max, Math.max(lo, Math.round(h)))
}

const COMPOSER_INLINE_SUGGEST_SYSTEM =
  'You complete a chat message the user is typing to an AI assistant. Output ONLY the immediate continuation: the next few words or one short sentence. Do not repeat text they already wrote. No quotes, markdown, labels, roleplay, or explanation. If no sensible continuation exists, output a single period.'

function normalizeComposerSuggestion(raw: string, draft: string): string {
  let s = raw.replace(/\r\n/g, '\n').trim()
  if (!s || s === '.' || s === '。') return ''
  const fence = /^```(?:\w*\n)?([\s\S]*?)```$/m.exec(s)
  if (fence) s = fence[1].trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  const lowerStart = s.toLowerCase()
  for (const prefix of ['continuation:', 'suffix:', 'completion:']) {
    if (lowerStart.startsWith(prefix)) {
      s = s.slice(prefix.length).trimStart()
      break
    }
  }
  const d = draft.replace(/\r\n/g, '\n')
  const dTrim = d.trimEnd()
  if (dTrim.length > 0) {
    const dl = dTrim.toLowerCase()
    const sl = s.toLowerCase()
    if (sl.startsWith(dl) && s.length >= dTrim.length) {
      s = s.slice(dTrim.length).trimStart()
    }
    const lastLine = d.split('\n').pop() ?? d
    const ll = lastLine.trimEnd()
    if (ll.length > 0) {
      const sll = s.toLowerCase()
      if (sll.startsWith(ll.toLowerCase()) && s.length > ll.length) {
        s = s.slice(ll.length).trimStart()
      }
    }
  }
  const para = (s.split(/\n\n/, 2)[0] ?? s).trim()
  s = para
  if (s.length > 600) s = s.slice(0, 600)
  return s
}

const METRICS_REFRESH_PRESETS_MS = [
  1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 3_600_000
] as const

/** Poll interval for ambient backdrop metrics; intentionally conservative to minimize overhead. */
const BACKDROP_METRICS_MS = 5000

function clampMetricsRefreshMs(ms: number): number {
  return Math.min(3_600_000, Math.max(500, Math.floor(ms)))
}

function formatRefreshLabel(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function applyTypographyComfortToDocument(id: TypographyComfortId): void {
  if (id === DEFAULT_TYPOGRAPHY_COMFORT) {
    document.documentElement.removeAttribute('data-typography-comfort')
  } else {
    document.documentElement.setAttribute('data-typography-comfort', id)
  }
}

type MainView = AppMainView
type ToolDrawer = 'hf' | 'runtime' | 'train' | 'metrics' | 'settings' | null
type WikiSubview = 'article' | 'knowledgeGraph'

type SettingsNavId = SettingsSectionId
type HfLibraryMode = 'recommended' | 'search'

/** Models drawer: browse Hub vs manage installed entries. */
type HfHubSubview = 'store' | 'installed'
type HfModelSortKey = 'downloads' | 'likes' | 'size'
type PinnedWidgetsSide = 'left' | 'right' | 'top' | 'bottom'

const HF_RECOMMENDED_FETCH_LIMIT = 72

const LS_SLIDE_CONV_W = 'slideConvWidthPx'
const LS_SLIDE_KB_W = 'slideKbWidthPx'
const LS_SLIDE_CONV_EDGE = 'slideConvEdge'
const LS_SLIDE_KB_EDGE = 'slideKbEdge'
const LS_KB_CHAT_COLLAPSED = 'kbChatPanelCollapsed'
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

function readKbChatCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(LS_KB_CHAT_COLLAPSED) === '1'
  } catch {
    return false
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
/** Enough room for chrome (title, pins, dock) plus at least one widget without clipping. */
const PINNED_H_MIN = 300
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
const CHAT_MAX_TOKENS_DEFAULT = 4096

function clampChatMaxTokens(n: number): number {
  if (!Number.isFinite(n)) return CHAT_MAX_TOKENS_DEFAULT
  return Math.min(CHAT_MAX_TOKENS_MAX, Math.max(CHAT_MAX_TOKENS_MIN, Math.floor(n)))
}

const INTEGRATION_PORT_DEFAULT = 17373

function clampIntegrationPort(n: number): number {
  if (!Number.isFinite(n)) return INTEGRATION_PORT_DEFAULT
  return Math.min(65535, Math.max(1024, Math.floor(n)))
}

const OLLAMA_BASE_DEFAULT = 'http://127.0.0.1:11434'
const LLAMA_PORT_DEFAULT = 8080

function clampLlamaPort(n: number): number {
  if (!Number.isFinite(n)) return LLAMA_PORT_DEFAULT
  return Math.min(65535, Math.max(1024, Math.floor(n)))
}

function humanizeChatError(raw: string): string {
  const stripped = raw
    .replace(/^Error:\s*Error invoking remote method 'runtime:chat':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  if (/^runtime not started/i.test(stripped)) {
    return 'Your AI is not running yet. Pick a model in the top bar, press the play button, and wait until loading finishes. Open Run in the sidebar if you need help installing or choosing a model.'
  }
  if (/nothing is listening/i.test(stripped)) {
    return 'The AI engine did not answer. Make sure the model is started (play button) and wait until it is ready. Open Run to check setup.'
  }
  if (/exceed_context_size_error|exceeds the available context size/i.test(stripped)) {
    return 'The prompt is larger than llama-server’s context window. Open Settings → Data → llama.cpp server, increase “Context size (tokens)”, then stop and start the model in Run (or shorten the chat / RAG snippets).'
  }
  if (stripped.length > 0 && stripped.length < 420) return stripped
  return raw
}

const SETTINGS_NAV_ITEMS: { id: SettingsNavId; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'fa-sliders' },
  { id: 'appearance', label: 'Appearance', icon: 'fa-palette' },
  { id: 'chat', label: 'Chat & knowledge', icon: 'fa-comments' },
  { id: 'runtime', label: 'AI engine', icon: 'fa-microchip' },
  { id: 'integrations', label: 'Integrations', icon: 'fa-plug' },
  { id: 'widgets', label: 'Widgets & metrics', icon: 'fa-gauge-high' },
  { id: 'data', label: 'Files & paths', icon: 'fa-hard-drive' },
  { id: 'maintenance', label: 'Maintenance', icon: 'fa-triangle-exclamation' }
]

function settingsPluginKindLabel(kind: PluginIntegrationReport['kind']): string {
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
    case 'agent_step':
      return 'IDE agent step'
    case 'agent_stop':
      return 'IDE agent stop'
    case 'workspace_seen':
      return 'IDE workspace'
    default:
      return kind
  }
}

type IdePromptMonitorState = {
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

const PINNED_WIDGETS_BAR_COLLAPSED_W = 40
const PINNED_WIDGETS_BAR_COLLAPSED_H = 40

function pinnedWidgetsAsideStyle(
  narrowStack: boolean,
  side: PinnedWidgetsSide,
  widthPx: number,
  heightPx: number,
  barCollapsed: boolean
): React.CSSProperties {
  if (barCollapsed) {
    if (narrowStack && (side === 'left' || side === 'right')) {
      return {
        width: '100%',
        minHeight: PINNED_WIDGETS_BAR_COLLAPSED_H,
        maxHeight: PINNED_WIDGETS_BAR_COLLAPSED_H
      }
    }
    if (side === 'left' || side === 'right') {
      return {
        width: PINNED_WIDGETS_BAR_COLLAPSED_W,
        minWidth: PINNED_WIDGETS_BAR_COLLAPSED_W,
        maxWidth: PINNED_WIDGETS_BAR_COLLAPSED_W
      }
    }
    return {
      width: '100%',
      height: PINNED_WIDGETS_BAR_COLLAPSED_H,
      minHeight: PINNED_WIDGETS_BAR_COLLAPSED_H,
      maxHeight: PINNED_WIDGETS_BAR_COLLAPSED_H
    }
  }
  if (narrowStack && (side === 'left' || side === 'right')) {
    const h = clampPinnedHeight(heightPx)
    return { width: '100%', minHeight: h, maxHeight: h }
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

/** Chevron direction for the collapsed strip: points where the panel expands into. */
function pinnedWidgetsExpandChevronClass(narrowStack: boolean, side: PinnedWidgetsSide): string {
  if (narrowStack && (side === 'left' || side === 'right')) return 'fa-chevron-down'
  switch (side) {
    case 'left':
      return 'fa-chevron-right'
    case 'right':
      return 'fa-chevron-left'
    case 'top':
      return 'fa-chevron-down'
    case 'bottom':
      return 'fa-chevron-up'
    default:
      return 'fa-chevron-right'
  }
}

function pinnedWidgetsCollapseChevron(side: PinnedWidgetsSide): string {
  switch (side) {
    case 'left':
      return 'fa-chevron-left'
    case 'right':
      return 'fa-chevron-right'
    case 'top':
      return 'fa-chevron-up'
    case 'bottom':
      return 'fa-chevron-down'
    default:
      return 'fa-chevron-left'
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
  binaryValid: boolean
  validateError: string | null
}

type OllamaHostStatus = {
  reachable: boolean
  baseUrl: string
}

/** Hub paths that are not `owner/repo` model pages. */
const HF_URL_NON_MODEL_ROOTS = new Set([
  'datasets',
  'spaces',
  'organizations',
  'collections',
  'docs',
  'blog',
  'tasks',
  'papers',
  'login',
  'join',
  'oauth'
])

/**
 * If `raw` is a Hugging Face model URL (or scheme-less `huggingface.co/...`), returns `namespace/repo`.
 * Strips `/tree/...`, `/blob/...`, query strings, and fragments.
 */
function parseHuggingFaceRepoIdFromInput(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null

  const isHfHost = (host: string): boolean => {
    const h = host.toLowerCase()
    return h === 'huggingface.co' || h === 'www.huggingface.co' || h === 'hf.co'
  }

  try {
    let pathname: string | null = null
    if (/^https?:\/\//i.test(t)) {
      const u = new URL(t)
      if (isHfHost(u.hostname)) pathname = u.pathname
    } else if (/^(https?:\/\/)?(www\.)?huggingface\.co\//i.test(t) || /^(https?:\/\/)?hf\.co\//i.test(t)) {
      const normalized = /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`
      pathname = new URL(normalized).pathname
    }
    if (!pathname) return null
    const parts = pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const owner = parts[0]!
    const repo = parts[1]!
    if (HF_URL_NON_MODEL_ROOTS.has(owner.toLowerCase())) return null
    return `${owner}/${repo}`
  } catch {
    return null
  }
}

function hfDetailToBrowseSummary(d: HfModelDetail): HfModelSummary {
  return {
    id: d.id,
    author: d.author,
    downloads: d.downloads,
    likes: d.likes,
    tags: d.tags,
    pipeline_tag: d.pipeline_tag,
    private: d.private,
    description: d.description,
    totalSizeBytes: d.totalSizeBytes,
    ollamaLibraryName: d.ollamaLibraryName
  }
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
  return 'right'
}

type PinnedWidgetKind = 'metrics' | 'downloads' | 'activity' | 'issues'

const PINNED_WIDGET_WEIGHT_DEFAULT: Record<PinnedWidgetKind, number> = {
  metrics: 1,
  downloads: 1,
  activity: 1,
  issues: 1
}

function clampPinnedWidgetWeights(raw: unknown): Record<PinnedWidgetKind, number> {
  const d = PINNED_WIDGET_WEIGHT_DEFAULT
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const one = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 1
    return Math.min(100, Math.max(0.05, v))
  }
  return {
    metrics: one(o.metrics),
    downloads: one(o.downloads),
    activity: one(o.activity),
    issues: one(o.issues)
  }
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

type UserPromptReceipt = { delivered: boolean; responseStarted: boolean; failed?: boolean }

function userMessageReceiptKey(cid: string | null, m: ChatMessageVm): string | undefined {
  if (!cid || m.role !== 'user') return undefined
  const suffix =
    m.id ??
    (typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? `t:${m.createdAt}` : '')
  if (!suffix) return undefined
  return `${cid}:${suffix}`
}

function UserPromptReceiptMarks(props: { receipt: UserPromptReceipt | undefined }): ReactElement | null {
  const r = props.receipt
  if (!r) return null
  const label = r.failed
    ? 'The model did not finish a reply for this prompt.'
    : r.delivered && r.responseStarted
      ? 'Prompt reached the model and the reply has started.'
      : r.delivered
        ? 'Prompt reached the model; waiting for the first reply tokens.'
        : 'Sending prompt to the model…'
  return (
    <span className="msg-prompt-receipts" role="status" aria-label={label}>
      <i
        className={`fa-solid fa-check msg-prompt-receipt${r.delivered && !r.failed ? ' msg-prompt-receipt--on' : ''}`}
        aria-hidden
      />
      <i
        className={`fa-solid fa-check msg-prompt-receipt${r.responseStarted && !r.failed ? ' msg-prompt-receipt--on' : ''}`}
        aria-hidden
      />
    </span>
  )
}

function userMessageShowsRetry(
  m: ChatMessageVm,
  index: number,
  messages: ChatMessageVm[],
  receipt: UserPromptReceipt | undefined,
  chatSending: boolean
): boolean {
  if (m.role !== 'user' || chatSending) return false
  if (receipt?.failed) return true
  if (messages[index + 1]?.role === 'assistant') return false
  return index === messages.length - 1
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

/** Derive how to start the runtime from the selected model string (Ollama tag vs local weight path). */
function inferRuntimeKindForModelSelection(
  sel: string,
  localPaths: readonly string[],
  winPlatform: boolean
): 'ollama' | 'llamacpp' {
  const t = sel.trim()
  if (!t) return 'ollama'
  if (localPaths.some((p) => localModelPathsEqual(p, t, winPlatform))) return 'llamacpp'
  if (looksLikeLocalModelFilePath(t)) return 'llamacpp'
  if (/\.(gguf|safetensors?)$/i.test(t)) return 'llamacpp'
  return 'ollama'
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

/** Ollama library entry that matches a Hub preset tag (for delete / display). */
function ollamaInstalledTagMatch(tags: readonly string[], preset: string): string | undefined {
  const w = preset.trim()
  if (!w) return undefined
  return tags.find((name) => {
    const base = name.split(':')[0] ?? ''
    return name === w || name.startsWith(`${w}:`) || base === w
  })
}

const HF_HUB_STORE_PAGE_SIZE = 18
const HF_HUB_INSTALLED_PAGE_SIZE = 12

const HF_DOWNLOAD_LABEL_MAX = 240

function clampDownloadDisplayLabel(s: string): string {
  const t = s.trim()
  if (t.length <= HF_DOWNLOAD_LABEL_MAX) return t
  return `${t.slice(0, HF_DOWNLOAD_LABEL_MAX - 1)}…`
}

/** Stored as `chat_display_name` / `chatDisplayName` so the UI can show repo + file, not only the local filename. */
function hubWeightDownloadDisplayName(d: HfModelDetail, hfFilename: string): string {
  const repo = d.id.trim() || 'model'
  const fileSeg = hfFilename.replace(/\\/g, '/').trim() || 'weights'
  let out = `${repo} · ${fileSeg}`
  const pipe = d.pipeline_tag?.trim()
  if (pipe) {
    const extra = ` (${pipe})`
    if (out.length + extra.length <= HF_DOWNLOAD_LABEL_MAX) out += extra
  }
  return out
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

/** Bytes for column sort: installed list prefers summed completed download sizes when present. */
function hfSizeBytesForTableSort(
  m: HfModelSummary,
  localDownloads: readonly DownloadRow[],
  installedList: boolean
): number {
  if (installedList) {
    const rows = localDownloads.filter((r) => r.repo_id === m.id && r.status === 'complete')
    const sum = rows.reduce((acc, r) => acc + (Number(r.bytes_total) || 0), 0)
    if (sum > 0) return sum
  }
  const b = m.totalSizeBytes
  return b != null && b > 0 ? b : -1
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

/** Top-bar / lists: prefer saved Hub label for this file path when the download registry has a row. */
function localModelOptionLabel(
  absPath: string,
  downloads: readonly DownloadRow[],
  winPlatform: boolean
): string {
  const base = fileNameFromPath(absPath)
  for (const d of downloads) {
    if (!localModelPathsEqual(d.local_path, absPath, winPlatform)) continue
    const dn = d.chat_display_name?.trim()
    if (dn) return dn
  }
  return base
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
  /** Same label persisted as `chat_display_name` for this job. */
  displayName?: string
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
  const displayRaw = o.chatDisplayName ?? o.chat_display_name
  const displayName =
    typeof displayRaw === 'string' && displayRaw.trim() ? displayRaw.trim() : undefined
  return { jobId: id, progress, bytesReceived, bytesTotal, status, displayName }
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

const DMS_PROVIDER_LABELS: Record<DmsProvider, string> = {
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint'
}

const DMS_DEFAULT_OAUTH_REDIRECT_URI = 'http://localhost:3344/callback'

export default function App(): React.ReactElement {
  const [mainView, setMainView] = useState<MainView>('chat')
  const [drawer, setDrawer] = useState<ToolDrawer>(null)

  const [paths, setPaths] = useState<Awaited<ReturnType<typeof window.api.getPaths>> | null>(null)
  const [appUpdateLine, setAppUpdateLine] = useState<string | null>(null)
  const [appUpdateBusy, setAppUpdateBusy] = useState(false)
  const winPlatform = paths?.platform === 'win32'
  const [hfQuery, setHfQuery] = useState('llama gguf')
  const [hfResults, setHfResults] = useState<HfModelSummary[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [detail, setDetail] = useState<HfModelDetail | null>(null)
  const [destDir, setDestDir] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(false)
  const [setupTourOpen, setSetupTourOpen] = useState(false)
  const [setupTourOnStartup, setSetupTourOnStartup] = useState(true)
  const [animatedBackdropEnabled, setAnimatedBackdropEnabled] = useState(true)
  const [uiRole, setUiRole] = useState<UiRole>(DEFAULT_UI_ROLE)
  const uiRoleResolved = useMemo(() => parseUiRoleOrDefault(uiRole), [uiRole])
  const isBuilderAdminRole = uiRoleResolved === 'builder_admin'
  const [workspaceDensity, setWorkspaceDensity] = useState<WorkspaceDensity>('standard')
  const [releaseFeatureSet, setReleaseFeatureSet] = useState<Record<string, boolean>>(defaultReleaseFeatureSet())
  const [presentationModeEnabled, setPresentationModeEnabled] = useState(true)
  const [showAdvancedSurfaces, setShowAdvancedSurfaces] = useState(false)
  const [settingsShowAdvanced, setSettingsShowAdvanced] = useState(false)
  const [showElectronDevMainView, setShowElectronDevMainView] = useState(false)
  const roleLayoutResolved = useMemo(() => roleLayout(uiRoleResolved), [uiRoleResolved])
  const devShellChrome = useMemo(
    () => devShellChromeVisible(uiRoleResolved, showElectronDevMainView),
    [uiRoleResolved, showElectronDevMainView]
  )
  const advancedSurfacesVisible = !presentationModeEnabled || showAdvancedSurfaces
  const visibleRoleTasks = useMemo(
    () =>
      roleLayoutResolved.taskNav.filter((task) => {
        if (!task.mainView) return true
        return advancedSurfacesVisible || !isAdvancedMainView(task.mainView)
      }),
    [roleLayoutResolved.taskNav, advancedSurfacesVisible]
  )
  const visibleToolDrawers = useMemo(
    () => (advancedSurfacesVisible ? roleLayoutResolved.toolDrawers : roleLayoutResolved.toolDrawers.filter((id) => id !== 'hf')),
    [advancedSurfacesVisible, roleLayoutResolved.toolDrawers]
  )
  const openTrainSurface = useCallback(() => {
    if (roleLayoutResolved.mainViews.includes('train')) {
      setDrawer(null)
      setMainView('train')
    } else {
      setDrawer('train')
    }
  }, [roleLayoutResolved.mainViews])
  const settingsAdvancedVisible = settingsShowAdvanced || roleLayoutResolved.advancedSettingsByDefault === true
  const visibleSettingsNavItems = useMemo(() => {
    const advancedSections = new Set<SettingsNavId>(['maintenance', 'data', 'integrations'])
    return SETTINGS_NAV_ITEMS.filter(
      (item) =>
        roleLayoutResolved.settingsSections.includes(item.id) &&
        (settingsAdvancedVisible || !advancedSections.has(item.id))
    )
  }, [roleLayoutResolved.settingsSections, settingsAdvancedVisible])
  const [presenceWakeConfigReady, setPresenceWakeConfigReady] = useState(false)
  const [presenceWakeOpen, setPresenceWakeOpen] = useState(false)
  const [wakeBackdropIntensity, setWakeBackdropIntensity] = useState(0)
  const [wakeChromeReveal, setWakeChromeReveal] = useState(false)
  const [resumeRuntimeOnLaunch, setResumeRuntimeOnLaunch] = useState(false)

  const [runtimeKind, setRuntimeKind] = useState<'llamacpp' | 'ollama'>('ollama')
  const [modelPath, setModelPath] = useState(DEFAULT_OLLAMA_MODEL_TAG)
  const [llamaBin, setLlamaBin] = useState('')
  const [llamaConvertScriptPath, setLlamaConvertScriptPath] = useState('')
  const [llamaPythonPath, setLlamaPythonPath] = useState('')
  const [llamaEnv, setLlamaEnv] = useState<LlamaEnvInfo | null>(null)
  const [ollamaHost, setOllamaHost] = useState<OllamaHostStatus | null>(null)
  const [ollamaInstallBusy, setOllamaInstallBusy] = useState(false)
  const [ollamaInstallNote, setOllamaInstallNote] = useState<string | null>(null)
  const [ollamaInstallNoteKind, setOllamaInstallNoteKind] = useState<'success' | 'info' | 'error' | null>(null)
  const [ollamaInstallLog, setOllamaInstallLog] = useState<string[]>([])
  const ollamaInstallLogRef = useRef<HTMLPreElement>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const presentationStarterToastShownRef = useRef(false)
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

  const inferredModelRuntimeKind = useMemo(
    () => inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform),
    [modelPath, localModelFilePaths, winPlatform]
  )

  /** Include the runtime’s model when it isn’t in the scanned folder list yet. */
  const topBarLlamaModelPathOptions = useMemo(() => {
    const base = localModelFilePaths
    const loaded =
      runtimeStatus?.running &&
      runtimeStatus?.kind === 'llamacpp' &&
      runtimeStatus.modelPath?.trim()
        ? runtimeStatus.modelPath.trim()
        : ''
    if (!loaded) return base
    if (base.some((p) => localModelPathsEqual(p, loaded, winPlatform))) return base
    return [loaded, ...base]
  }, [localModelFilePaths, runtimeStatus?.running, runtimeStatus?.kind, runtimeStatus?.modelPath, winPlatform])

  /** Include the loaded Ollama tag when it isn’t returned by list yet, and the draft tag (e.g. default fallback). */
  const topBarOllamaModelOptions = useMemo(() => {
    const base = ollamaChatTags
    const loaded =
      runtimeStatus?.running &&
      runtimeStatus?.kind === 'ollama' &&
      runtimeStatus.modelPath?.trim()
        ? runtimeStatus.modelPath.trim()
        : ''
    const draft =
      !runtimeStatus?.running &&
      modelPath.trim() &&
      inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform) === 'ollama'
        ? modelPath.trim()
        : ''
    let out = [...base]
    if (loaded && !out.includes(loaded)) out = [loaded, ...out]
    if (draft && !out.includes(draft)) out = [draft, ...out]
    return out
  }, [
    modelPath,
    localModelFilePaths,
    winPlatform,
    ollamaChatTags,
    runtimeStatus?.kind,
    runtimeStatus?.modelPath,
    runtimeStatus?.running
  ])

  const runtimeOn = Boolean(runtimeStatus?.running)

  const topBarModelSelectValue = useMemo(() => {
    if (runtimeOn && runtimeStatus?.modelPath?.trim()) {
      const mp = runtimeStatus.modelPath.trim()
      if (runtimeStatus.kind === 'llamacpp') {
        for (const p of topBarLlamaModelPathOptions) {
          if (localModelPathsEqual(p, mp, winPlatform)) return p
        }
        return mp
      }
      return mp
    }
    const cur = modelPath.trim()
    if (!cur) return ''
    if (topBarOllamaModelOptions.includes(cur)) return cur
    if (matchedLocalModelPath) return matchedLocalModelPath
    if (topBarLlamaModelPathOptions.some((p) => localModelPathsEqual(p, cur, winPlatform))) return cur
    return ''
  }, [
    matchedLocalModelPath,
    modelPath,
    runtimeOn,
    runtimeStatus?.kind,
    runtimeStatus?.modelPath,
    topBarLlamaModelPathOptions,
    topBarOllamaModelOptions,
    winPlatform
  ])

  useEffect(() => {
    const k = inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform)
    setRuntimeKind((prev) => (prev === k ? prev : k))
  }, [modelPath, localModelFilePaths, winPlatform])

  useEffect(() => {
    setLocalGgufDeleteMarks([])
    setOllamaDeleteMarks([])
  }, [runtimeKind])

  const localModelDefaultSyncRef = useRef<{ kind: 'ollama' | 'llamacpp'; localLen: number }>({
    kind: 'ollama',
    localLen: 0
  })

  useEffect(() => {
    const kind = inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform)
    const prev = localModelDefaultSyncRef.current
    const switchedToLlama = prev.kind !== 'llamacpp' && kind === 'llamacpp'
    const listBecameAvailable = prev.localLen === 0 && localModelFilePaths.length > 0
    localModelDefaultSyncRef.current = {
      kind,
      localLen: localModelFilePaths.length
    }

    if (kind !== 'llamacpp') return
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
  }, [modelPath, localModelFilePaths, paths?.platform, runtimeStatus?.running, winPlatform])

  useEffect(() => {
    if (inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform) !== 'ollama') return
    if (ollamaChatTagsLoading) return

    const tags = ollamaChatTags
    const cur = modelPath.trim()
    const loaded = runtimeStatus?.running ? runtimeStatus.modelPath?.trim() ?? '' : ''

    if (tags.length === 0) {
      if (!runtimeStatus?.running && !cur) setModelPath(DEFAULT_OLLAMA_MODEL_TAG)
      return
    }

    if (!cur) return
    if (tags.includes(cur)) return
    if (loaded && cur === loaded) return
    if (runtimeStatus?.running) return
    setModelPath(tags[0])
  }, [
    localModelFilePaths,
    winPlatform,
    ollamaChatTags,
    ollamaChatTagsLoading,
    modelPath,
    runtimeStatus?.running,
    runtimeStatus?.modelPath
  ])

  /** Keep the model field aligned with the running server so the top-bar list shows the loaded model. */
  useEffect(() => {
    if (!runtimeStatus?.running || !runtimeStatus.modelPath?.trim()) return
    if (runtimeStatus.kind !== 'ollama' && runtimeStatus.kind !== 'llamacpp') return
    const mp = runtimeStatus.modelPath.trim()
    const cur = modelPath.trim()
    if (runtimeStatus.kind === 'llamacpp') {
      if (localModelPathsEqual(cur, mp, winPlatform)) return
    } else if (cur === mp) {
      return
    }
    setModelPath(mp)
  }, [runtimeStatus?.running, runtimeStatus?.modelPath, runtimeStatus?.kind, modelPath, winPlatform])

  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null)
  const [deleteConvRemoveKb, setDeleteConvRemoveKb] = useState(false)
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [saveChatKbBusy, setSaveChatKbBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessageVm[]>([])
  const [draft, setDraft] = useState('')
  const [composerGhostSuffix, setComposerGhostSuffix] = useState('')
  const [composerSuggestBusy, setComposerSuggestBusy] = useState(false)
  const [ragQuery, setRagQuery] = useState('')
  const [ragSnippets, setRagSnippets] = useState<string[]>([])
  const [ragLayerEnabled, setRagLayerEnabled] = useState(true)
  const [ragLoading, setRagLoading] = useState(false)
  const [ragSuggestHits, setRagSuggestHits] = useState<KbSearchHit[]>([])
  const [ragSuggestFocused, setRagSuggestFocused] = useState(false)
  const [ragSuggestActive, setRagSuggestActive] = useState(-1)
  const ragSuggestSeqRef = useRef(0)
  const composerSuggestGenRef = useRef(0)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerMirrorInnerRef = useRef<HTMLDivElement | null>(null)

  const [wikiTopics, setWikiTopics] = useState<WikiTopic[]>([])
  const [promptDomains, setPromptDomains] = useState<PromptDomainRow[]>([])
  const [promptDomainSuffixDrafts, setPromptDomainSuffixDrafts] = useState<Record<string, string>>({})
  const [wikiHighlightTerms, setWikiHighlightTerms] = useState<WikiChatHighlightTerm[]>([])
  const [wikiBody, setWikiBody] = useState('')
  const [wikiImportConfidence, setWikiImportConfidence] = useState<KbImportConfidence | null>(null)
  const [wikiTitle, setWikiTitle] = useState('')
  const [wikiGlossary, setWikiGlossary] = useState<WikiGlossaryEntry[]>([])
  const [wikiRelated, setWikiRelated] = useState<WikiRelatedSource[]>([])
  const [wikiPassages, setWikiPassages] = useState<WikiPassageSummary[]>([])
  const [wikiKeywordCandidates, setWikiKeywordCandidates] = useState<WikiKeywordCandidate[]>([])
  const [wikiSelectedPassageIds, setWikiSelectedPassageIds] = useState<Record<string, boolean>>({})
  const [wikiPassageFilterDraft, setWikiPassageFilterDraft] = useState('')
  const [wikiExtractKeywordDraft, setWikiExtractKeywordDraft] = useState('')
  const [wikiExtractBusy, setWikiExtractBusy] = useState(false)
  const [wikiCleanupBusy, setWikiCleanupBusy] = useState(false)
  const [wikiDomainOptions, setWikiDomainOptions] = useState<KbDomainOption[]>([])
  const [wikiDomainDraft, setWikiDomainDraft] = useState('')
  const [wikiDomainSaving, setWikiDomainSaving] = useState(false)
  const [wikiCleanupProgress, setWikiCleanupProgress] = useState(0)
  const [wikiCleanupLabel, setWikiCleanupLabel] = useState('Preparing cleanup…')
  const [wikiExtractStatus, setWikiExtractStatus] = useState<string | null>(null)
  const [wikiSelectedId, setWikiSelectedId] = useState<string | null>(null)
  const [wikiSubview, setWikiSubview] = useState<WikiSubview>('article')
  const [wikiDeletePending, setWikiDeletePending] = useState<{ id: string; title: string } | null>(null)
  const [wikiSearchQuery, setWikiSearchQuery] = useState('')
  const [wikiSearchHits, setWikiSearchHits] = useState<KbSearchHit[]>([])
  const [wikiSearchBusy, setWikiSearchBusy] = useState(false)
  const [wikiExportBusy, setWikiExportBusy] = useState(false)
  const [wikiUploadBusy, setWikiUploadBusy] = useState(false)
  const [wikiUploadProgress, setWikiUploadProgress] = useState<KbIngestFileProgress | null>(null)
  const [wikiUploadFormat, setWikiUploadFormat] = useState<'pdf' | 'text' | null>(null)
  const [wikiReanalyzeBusy, setWikiReanalyzeBusy] = useState(false)
  const [wikiReanalyzeProgress, setWikiReanalyzeProgress] = useState<WikiReanalyzeProgress | null>(null)
  const [wikiReanalyzeResult, setWikiReanalyzeResult] = useState<WikiReanalyzeResult | null>(null)
  const [wikiTocGroups, setWikiTocGroups] = useState<WikiTocGroup[]>([])
  const pendingWikiSectionOrdRef = useRef<number | null>(null)
  const [dmsConnections, setDmsConnections] = useState<DmsConnectionSummary[]>([])
  const [dmsImportRoots, setDmsImportRoots] = useState<DmsImportRootSummary[]>([])
  const [dmsSelectedProvider, setDmsSelectedProvider] = useState<DmsProvider>('google-drive')
  const [dmsConnectFormOpen, setDmsConnectFormOpen] = useState(false)
  const [dmsConnectMethod, setDmsConnectMethod] = useState<'oauth2' | 'token'>('oauth2')
  const [dmsAccessTokenDraft, setDmsAccessTokenDraft] = useState('')
  const [dmsOauthClientIdDraft, setDmsOauthClientIdDraft] = useState('')
  const [dmsOauthClientSecretDraft, setDmsOauthClientSecretDraft] = useState('')
  const [dmsOauthRedirectUriDraft, setDmsOauthRedirectUriDraft] = useState('')
  const [dmsOauthScopesDraft, setDmsOauthScopesDraft] = useState('')
  const [dmsOauthTenantIdDraft, setDmsOauthTenantIdDraft] = useState('')
  const [dmsOauthSiteIdDraft, setDmsOauthSiteIdDraft] = useState('')
  const [dmsOauthStateDraft, setDmsOauthStateDraft] = useState('')
  const [dmsOauthCodeDraft, setDmsOauthCodeDraft] = useState('')
  const [dmsOauthCallbackUrlDraft, setDmsOauthCallbackUrlDraft] = useState('')
  const [dmsConnectDisplayName, setDmsConnectDisplayName] = useState('')
  const [dmsConnecting, setDmsConnecting] = useState(false)
  const [dmsFolderOptions, setDmsFolderOptions] = useState<DmsFolderSummary[]>([])
  const [dmsFoldersBusyForConnectionId, setDmsFoldersBusyForConnectionId] = useState<string | null>(null)
  const [dmsSelectedConnectionId, setDmsSelectedConnectionId] = useState<string | null>(null)
  const [dmsSelectedFolderId, setDmsSelectedFolderId] = useState('')
  const [dmsSyncBusyRootId, setDmsSyncBusyRootId] = useState<string | null>(null)
  const [dmsSyncProgress, setDmsSyncProgress] = useState<DmsSyncProgress | null>(null)
  const [dmsSyncStatusLine, setDmsSyncStatusLine] = useState<string | null>(null)
  const wikiSearchSeqRef = useRef(0)
  const wikiMainSearchInputRef = useRef<HTMLInputElement>(null)
  const [kgPayload, setKgPayload] = useState<KnowledgeGraphPayload | null>(null)
  const [kgLoading, setKgLoading] = useState(false)
  const [kgAnalysisBusy, setKgAnalysisBusy] = useState(false)
  const [kgAnalysisError, setKgAnalysisError] = useState<string | null>(null)
  const [kgAnalysisSummary, setKgAnalysisSummary] = useState<string | null>(null)
  const [kgAnalysisMarkdown, setKgAnalysisMarkdown] = useState<string | null>(null)
  const [kgAnalysisIngestedId, setKgAnalysisIngestedId] = useState<string | null>(null)
  const [kgAnalysisResult, setKgAnalysisResult] = useState<KnowledgeGraphAnalysisResult | null>(null)
  const [ontologyPayload, setOntologyPayload] = useState<OntologySubgraphPayload | null>(null)
  const [ontologyStats, setOntologyStats] = useState<OntologyStats | null>(null)
  const [ontologyLoading, setOntologyLoading] = useState(false)
  const [ontologyDetails, setOntologyDetails] = useState<OntologyEntityDetails | null>(null)
  const [ontologyDetailLoading, setOntologyDetailLoading] = useState(false)
  const [codebaseAnalysisSnapshots, setCodebaseAnalysisSnapshots] = useState<CodebaseAnalysisSnapshot[]>([])

  const [metricsBundle, setMetricsBundle] = useState<{
    snapshot: unknown
    history: MetricsSnapshot[]
  } | null>(null)
  const [recommendedModels, setRecommendedModels] = useState<HfModelSummary[]>([])
  const [recommendedLoading, setRecommendedLoading] = useState(false)
  const [hfLibraryMode, setHfLibraryMode] = useState<HfLibraryMode>('recommended')
  const [hfHubSubview, setHfHubSubview] = useState<HfHubSubview>('store')
  const [hfSearchLoading, setHfSearchLoading] = useState(false)
  const [hfSortBy, setHfSortBy] = useState<HfModelSortKey>('downloads')
  const [hfSortDir, setHfSortDir] = useState<'asc' | 'desc'>('desc')
  const [hfFilterMinLikes, setHfFilterMinLikes] = useState('')
  const [hfFilterMinDownloads, setHfFilterMinDownloads] = useState('')
  const [hfFilterMaxSizeGb, setHfFilterMaxSizeGb] = useState('')
  const [quickDownloadRepo, setQuickDownloadRepo] = useState<string | null>(null)
  const [hfInstalledListPage, setHfInstalledListPage] = useState(1)
  const [hfAvailableListPage, setHfAvailableListPage] = useState(1)
  const [hfHubDeleteRepoBusy, setHfHubDeleteRepoBusy] = useState<string | null>(null)
  const [hfOllamaPullRepoId, setHfOllamaPullRepoId] = useState<string | null>(null)
  const [hfOllamaPullBusy, setHfOllamaPullBusy] = useState(false)
  const [hfOllamaPullProgress, setHfOllamaPullProgress] = useState<RuntimeLoadProgress | null>(null)
  const [trainJobs, setTrainJobs] = useState<TrainJob[]>([])
  const [trainBase, setTrainBase] = useState('')
  const [trainDataset, setTrainDataset] = useState('')
  const [trainKbSources, setTrainKbSources] = useState<KbSource[]>([])
  const [trainKbSelected, setTrainKbSelected] = useState<Record<string, boolean>>({})
  const [trainDisplayName, setTrainDisplayName] = useState('')
  const [trainStartBusy, setTrainStartBusy] = useState(false)
  const [trainDomainProfiles, setTrainDomainProfiles] = useState<DomainProfile[]>([])
  const [trainSelectedDomainId, setTrainSelectedDomainId] = useState('')
  const [trainReviewQueue, setTrainReviewQueue] = useState<EvidenceCard[]>([])
  const [trainManifestPreviewMarkdown, setTrainManifestPreviewMarkdown] = useState<string | null>(null)
  const [trainDomainModelVersions, setTrainDomainModelVersions] = useState<DomainModelVersion[]>([])
  const [hfTokenInput, setHfTokenInput] = useState('')
  const [colorScheme, setColorScheme] = useState<ColorSchemeId>(DEFAULT_COLOR_SCHEME)
  const [typographyComfort, setTypographyComfort] = useState<TypographyComfortId>(DEFAULT_TYPOGRAPHY_COMFORT)
  const [typographyFontFamily, setTypographyFontFamily] =
    useState<TypographyFontFamilyId>(DEFAULT_TYPOGRAPHY_FONT_FAMILY)
  const [typographyLineHeightFactor, setTypographyLineHeightFactor] = useState(
    DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR
  )
  const [typographyLetterSpacingExtraEm, setTypographyLetterSpacingExtraEm] = useState(
    DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM
  )
  const [typographyWordSpacingEm, setTypographyWordSpacingEm] = useState(DEFAULT_TYPOGRAPHY_WORD_SPACING_EM)
  /** Live values for persisting sliders on `pointerup` (avoids stale React state in the same gesture). */
  const typographyFontLiveRef = useRef<TypographyFontFamilyId>(DEFAULT_TYPOGRAPHY_FONT_FAMILY)
  const typographyLineHeightLiveRef = useRef(DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR)
  const typographyLetterExtraLiveRef = useRef(DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM)
  const typographyWordSpacingLiveRef = useRef(DEFAULT_TYPOGRAPHY_WORD_SPACING_EM)
  const [chatMaxTokensDraft, setChatMaxTokensDraft] = useState(String(CHAT_MAX_TOKENS_DEFAULT))
  const [wikiAutoExtract, setWikiAutoExtract] = useState(true)
  const [chatResponsePostProcess, setChatResponsePostProcess] = useState(true)
  const [deepLearnEnabled, setDeepLearnEnabled] = useState(true)
  const [deepLearnMaxRoundsDraft, setDeepLearnMaxRoundsDraft] = useState('5')
  const [deepLearnMaxFetchBytesDraft, setDeepLearnMaxFetchBytesDraft] = useState('1500000')
  type DeepLearnPanelState = {
    jobId: string
    label: string
    awaiting?: {
      paths: DeepLearnExplorePath[]
      roundCompleted: number
      maxRounds: number
      canContinueMore: boolean
      modelSuggestsDone: boolean
    }
  }
  const [deepLearnUi, setDeepLearnUi] = useState<DeepLearnPanelState | null>(null)
  const [agenticWorkersEnabled, setAgenticWorkersEnabled] = useState(false)
  const [agentRemoteOllamaUrlDraft, setAgentRemoteOllamaUrlDraft] = useState('')
  const [integrationListenEnabled, setIntegrationListenEnabled] = useState(false)
  const [intellijPluginZipSaving, setIntellijPluginZipSaving] = useState(false)
  const [integrationPortDraft, setIntegrationPortDraft] = useState(String(INTEGRATION_PORT_DEFAULT))
  const [integrationTokenDraft, setIntegrationTokenDraft] = useState('')
  const [architectureRepositoryScanRoot, setArchitectureRepositoryScanRoot] = useState<string | null>(null)
  const [ideJourneyChecklist, setIdeJourneyChecklist] = useState<IdeJourneyChecklist>(defaultIdeJourneyChecklist())
  const [ideJourneyAutoChecklist, setIdeJourneyAutoChecklist] = useState(false)
  const ideJourneyAutoMarkRef = useRef(0)
  const [modelsInstallPathDraft, setModelsInstallPathDraft] = useState('')
  const [modelsDirSaveErr, setModelsDirSaveErr] = useState<string | null>(null)
  const [settingsMaintenanceBusy, setSettingsMaintenanceBusy] = useState<
    false | 'caches' | 'models' | 'factory' | 'wikiReset'
  >(false)
  const [settingsMaintenanceMessage, setSettingsMaintenanceMessage] = useState<string | null>(null)
  const [settingsConfirmKind, setSettingsConfirmKind] = useState<
    null | 'caches' | 'models' | 'factory' | 'wikiReset'
  >(null)
  const [settingsNav, setSettingsNav] = useState<SettingsNavId>('general')
  const [ollamaBaseUrlDraft, setOllamaBaseUrlDraft] = useState(OLLAMA_BASE_DEFAULT)
  const [llamaPortDraft, setLlamaPortDraft] = useState(String(LLAMA_PORT_DEFAULT))
  const [llamaContextTokensDraft, setLlamaContextTokensDraft] = useState(
    String(LLAMA_CONTEXT_TOKENS_DEFAULT)
  )
  /** Empty string = use global Chat → Max response tokens for llama.cpp. */
  const [llamaChatMaxTokensDraft, setLlamaChatMaxTokensDraft] = useState('')
  const [chatHistoryMaxMessagesDraft, setChatHistoryMaxMessagesDraft] = useState('80')
  const [chatDomainEnhancement, setChatDomainEnhancement] = useState(false)
  const [llamaRagGrounding, setLlamaRagGrounding] = useState(false)
  const [ontologyEnabled, setOntologyEnabled] = useState(true)
  const [ontologyMaxTriplesDraft, setOntologyMaxTriplesDraft] = useState('40')
  const [ontologyContextTokensDraft, setOntologyContextTokensDraft] = useState('512')
  const [llamaTemperatureDraft, setLlamaTemperatureDraft] = useState('0.8')
  const [llamaTopPDraft, setLlamaTopPDraft] = useState('0.95')
  const [llamaFrequencyPenaltyDraft, setLlamaFrequencyPenaltyDraft] = useState('0')
  const [llamaPresencePenaltyDraft, setLlamaPresencePenaltyDraft] = useState('0')
  /** Non-blocking notices for this send (context budget, history trim, RAG citations). */
  const [chatTurnNotice, setChatTurnNotice] = useState<string | null>(null)
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
  const [kbChatPanelCollapsed, setKbChatPanelCollapsed] = useState(readKbChatCollapsed)
  const [slidePanelResizing, setSlidePanelResizing] = useState<null | 'conv' | 'kb'>(null)
  const [pinnedBarResizing, setPinnedBarResizing] = useState(false)
  const convWRef = useRef(slideConvWidthPx)
  const kbWRef = useRef(slideKbWidthPx)
  const slideConvEdgeRef = useRef(slideConvEdge)
  const slideKbEdgeRef = useRef(slideKbEdge)
  const pinnedWRef = useRef(PINNED_W_DEFAULT)
  const pinnedHRef = useRef(PINNED_H_DEFAULT)
  const pinnedWidgetsSideRef = useRef<PinnedWidgetsSide>('right')
  const narrowForPinnedRef = useRef(false)
  const pinnedBarResizeRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
  } | null>(null)
  const pinnedWidgetsBodyRef = useRef<HTMLDivElement>(null)
  const [pinnedWidgetSplitResizing, setPinnedWidgetSplitResizing] = useState(false)
  const pinnedWidgetWeightsRef = useRef(PINNED_WIDGET_WEIGHT_DEFAULT)
  const widgetSplitDragRef = useRef<{
    a: PinnedWidgetKind
    b: PinnedWidgetKind
    startA: number
    startB: number
    startClient: number
    visible: PinnedWidgetKind[]
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
  const [pinnedWidgetWeights, setPinnedWidgetWeights] = useState(() => ({
    ...PINNED_WIDGET_WEIGHT_DEFAULT
  }))

  useEffect(() => {
    pinnedWidgetWeightsRef.current = pinnedWidgetWeights
  }, [pinnedWidgetWeights])

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
      setLlamaLoadConsoleHeightPx((h) => clampLlamaConsoleHeight(h))
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

  useEffect(() => {
    if (!pinnedWidgetSplitResizing) return
    const onMove = (e: PointerEvent): void => {
      const r = widgetSplitDragRef.current
      const body = pinnedWidgetsBodyRef.current
      if (!r || !body) return
      const side = pinnedWidgetsSideRef.current
      const inRow =
        (side === 'top' || side === 'bottom') && !narrowForPinnedRef.current
      const L = inRow ? body.clientWidth : body.clientHeight
      if (L < 48) return
      const deltaClient = inRow ? e.clientX - r.startClient : e.clientY - r.startClient
      const w = { ...pinnedWidgetWeightsRef.current }
      const sVis = r.visible.reduce((acc, k) => acc + w[k], 0)
      if (sVis <= 0) return
      const sumPair = r.startA + r.startB
      const d = (deltaClient / L) * sVis
      const minPx = 72
      const waMin = (minPx / L) * sVis
      const waMax = sumPair - (minPx / L) * sVis
      if (waMin > waMax) return
      let wa = r.startA + d
      wa = Math.min(Math.max(wa, waMin), waMax)
      const wb = sumPair - wa
      w[r.a] = wa
      w[r.b] = wb
      pinnedWidgetWeightsRef.current = w
      setPinnedWidgetWeights({ ...w })
    }
    const onUp = (): void => {
      void window.api.setConfig({ pinnedWidgetWeights: { ...pinnedWidgetWeightsRef.current } })
      setPinnedWidgetSplitResizing(false)
      widgetSplitDragRef.current = null
    }
    const side = pinnedWidgetsSideRef.current
    const inRow = (side === 'top' || side === 'bottom') && !narrowForPinnedRef.current
    const cursor = inRow ? 'ew-resize' : 'ns-resize'
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
  }, [pinnedWidgetSplitResizing])

  const [metricsPinned, setMetricsPinned] = useState(false)
  const [downloadsPinned, setDownloadsPinned] = useState(false)
  const [activityPinned, setActivityPinned] = useState(false)
  const [issuesPinned, setIssuesPinned] = useState(false)
  const [pinnedWidgetsBarCollapsed, setPinnedWidgetsBarCollapsed] = useState(true)
  const [runtimeLoadProgress, setRuntimeLoadProgress] = useState<RuntimeLoadProgress | null>(null)
  const [runtimeLoadLog, setRuntimeLoadLog] = useState('')
  const [llamaLoadConsoleExpanded, setLlamaLoadConsoleExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(LS_LLAMA_CONSOLE_EXPANDED) !== '0'
    } catch {
      return true
    }
  })
  const [llamaLoadConsoleHeightPx, setLlamaLoadConsoleHeightPx] = useState(() => {
    try {
      const raw = window.localStorage.getItem(LS_LLAMA_CONSOLE_HEIGHT_PX)
      const n = raw ? parseInt(raw, 10) : LLAMA_CONSOLE_H_DEFAULT
      return clampLlamaConsoleHeight(n)
    } catch {
      return clampLlamaConsoleHeight(LLAMA_CONSOLE_H_DEFAULT)
    }
  })
  const [llamaConsoleResizing, setLlamaConsoleResizing] = useState(false)
  const llamaConsoleResizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const llamaLoadConsoleRef = useRef<HTMLPreElement | null>(null)
  const [runtimeStarting, setRuntimeStarting] = useState(false)
  const [chatSending, setChatSending] = useState(false)
  const [userPromptReceipts, setUserPromptReceipts] = useState<
    Record<string, UserPromptReceipt>
  >({})
  const chatStreamSawFirstTokenRef = useRef(false)
  const [streamingReplyStartedAt, setStreamingReplyStartedAt] = useState<number | null>(null)
  const [chatStreamBuffer, setChatStreamBuffer] = useState('')
  const [activityChatTokens, setActivityChatTokens] = useState<ActivityChatTokens | null>(null)
  const activityChatTokensRef = useRef<ActivityChatTokens | null>(null)
  const [activityTokenHistory, setActivityTokenHistory] = useState<ActivityTokenHistoryPoint[]>([])
  const [integrationPluginReports, setIntegrationPluginReports] = useState<PluginIntegrationReport[]>([])
  const [idePromptMonitor, setIdePromptMonitor] = useState<IdePromptMonitorState>({
    modelState: 'idle',
    requestId: null,
    source: null,
    startedAt: null,
    promptPreview: '',
    generatedResponse: '',
    actions: [],
    error: null,
    updatedAt: null
  })
  const [pinnedWidgetsSide, setPinnedWidgetsSide] = useState<PinnedWidgetsSide>('right')

  useEffect(() => {
    pinnedWidgetsSideRef.current = pinnedWidgetsSide
  }, [pinnedWidgetsSide])

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

  useEffect(() => {
    setUserPromptReceipts({})
  }, [convId])

  useEffect(() => {
    const generation = ++composerSuggestGenRef.current
    setComposerGhostSuffix('')

    if (!runtimeStatus?.running || !convId || chatSending) {
      setComposerSuggestBusy(false)
      return
    }
    const trimmed = draft.trim()
    if (trimmed.length < 12 || draft.length > 6000) {
      setComposerSuggestBusy(false)
      return
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        if (generation !== composerSuggestGenRef.current) return
        setComposerSuggestBusy(true)
        try {
          const historyForSuggest = messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          const msgs = [
            { role: 'system' as const, content: COMPOSER_INLINE_SUGGEST_SYSTEM },
            ...historyForSuggest,
            {
              role: 'user' as const,
              content: `Continue this draft with only the suffix — the very next words (do not repeat existing text):\n\n${draft}`
            }
          ]
          const reply = await window.api.runtimeChat(msgs, '', { maxTokens: 96 })
          if (generation !== composerSuggestGenRef.current) return
          const normalized = normalizeComposerSuggestion(reply, draft)
          if (generation !== composerSuggestGenRef.current) return
          setComposerGhostSuffix(normalized)
        } catch {
          if (generation !== composerSuggestGenRef.current) return
          setComposerGhostSuffix('')
        } finally {
          if (generation === composerSuggestGenRef.current) setComposerSuggestBusy(false)
        }
      })()
    }, 480)

    return () => window.clearTimeout(timer)
  }, [draft, messages, convId, runtimeStatus?.running, chatSending])

  useLayoutEffect(() => {
    const ta = composerTextareaRef.current
    const inner = composerMirrorInnerRef.current
    if (ta && inner) {
      inner.style.transform = `translateY(${-ta.scrollTop}px)`
    }
  }, [draft, composerGhostSuffix])

  const refreshPaths = useCallback(async () => {
    const p = await window.api.getPaths()
    setPaths(p)
    setDestDir((d) => d || p.modelsDefault)
  }, [])

  const runCheckForUpdates = useCallback(async () => {
    setAppUpdateBusy(true)
    try {
      const r = await window.api.checkForUpdates()
      if (!r.ok) {
        setAppUpdateLine(r.error ?? 'Could not check for updates.')
      }
    } finally {
      setAppUpdateBusy(false)
    }
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
    const h3s = [...root.querySelectorAll('h3')]
    for (const [idx, h] of h3s.entries()) {
      const id = h.getAttribute('id')
      if (!id) h.setAttribute('id', `wiki-passage-${idx + 1}`)
    }
    setWikiTocGroups(buildWikiTocGroupsFromRoot(root))
    const sectionOrd = pendingWikiSectionOrdRef.current
    if (sectionOrd != null) {
      const target = h3s[sectionOrd] ?? null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        target.classList.add('wiki-passage-focus')
        window.setTimeout(() => target.classList.remove('wiki-passage-focus'), 1400)
      }
      pendingWikiSectionOrdRef.current = null
    }
  }, [])

  const refreshPromptDomains = useCallback(async () => {
    try {
      setPromptDomains(await window.api.promptDomainsList())
    } catch {
      setPromptDomains([])
    }
  }, [])

  const loadDmsConnectionsAndRoots = useCallback(async () => {
    try {
      const [connections, roots] = await Promise.all([
        window.api.dmsConnectionsList(),
        window.api.dmsImportRootsList()
      ])
      setDmsConnections(connections)
      setDmsImportRoots(roots)
      if (connections.length === 0) {
        setDmsSelectedConnectionId(null)
      } else if (!connections.some((c) => c.id === dmsSelectedConnectionId)) {
        setDmsSelectedConnectionId(connections[0]?.id ?? null)
      }
    } catch {
      setDmsConnections([])
      setDmsImportRoots([])
    }
  }, [dmsSelectedConnectionId])

  const loadWiki = useCallback(async () => {
    setWikiTopics(await window.api.kbWikiTopics())
    try {
      setWikiDomainOptions(await window.api.kbDomainsList(200))
    } catch {
      setWikiDomainOptions([])
    }
    try {
      setWikiHighlightTerms(await window.api.kbWikiHighlightTerms())
    } catch {
      setWikiHighlightTerms([])
    }
    await loadDmsConnectionsAndRoots()
    await refreshPromptDomains()
  }, [refreshPromptDomains, loadDmsConnectionsAndRoots])
  const openKnowledgeLibrary = useCallback(() => {
    setDrawer(null)
    setMainView('wiki')
    setWikiSubview('article')
    void loadWiki()
  }, [loadWiki])

  useEffect(() => {
    if (drawer === 'settings' && settingsNav === 'chat') {
      void refreshPromptDomains()
    }
  }, [drawer, settingsNav, refreshPromptDomains])

  useEffect(() => {
    setPromptDomainSuffixDrafts((prev) => {
      const n = { ...prev }
      for (const d of promptDomains) {
        if (!(d.id in n)) n[d.id] = d.systemSuffix
      }
      return n
    })
  }, [promptDomains])

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
    if (mainView !== 'wiki' || wikiSubview !== 'article' || wikiTitle.trim().length > 0) return
    const id = window.requestAnimationFrame(() => wikiMainSearchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [mainView, wikiSubview, wikiTitle])

  useEffect(() => {
    // Keyword suggestions for subpage extraction were replaced by direct in-text term clicks.
    setWikiKeywordCandidates([])
  }, [wikiSelectedId, wikiPassages, wikiSelectedPassageIds])

  useEffect(() => {
    const off = window.api.onDmsSyncProgress((ev) => {
      setDmsSyncProgress(ev)
      if (ev.kind === 'started') {
        setDmsSyncStatusLine(ev.message)
      } else if (ev.kind === 'scan' || ev.kind === 'file' || ev.kind === 'analysis') {
        setDmsSyncStatusLine(ev.message)
      } else if (ev.kind === 'done') {
        setDmsSyncStatusLine(
          `Sync done: ${ev.importedCount} imported, ${ev.updatedCount} updated, ${ev.removedCount} removed.`
        )
      } else if (ev.kind === 'error') {
        setDmsSyncStatusLine(ev.message)
      }
    })
    return () => off()
  }, [])

  useEffect(() => {
    setDmsOauthStateDraft('')
    setDmsOauthCodeDraft('')
    setDmsOauthCallbackUrlDraft('')
    setDmsOauthTenantIdDraft('')
    setDmsOauthSiteIdDraft('')
  }, [dmsSelectedProvider])

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

  const loadKnowledgeGraph = useCallback(async (opts?: { keepAnalysis?: boolean }) => {
    setKgLoading(true)
    if (!opts?.keepAnalysis) {
      setKgAnalysisError(null)
      setKgAnalysisSummary(null)
      setKgAnalysisMarkdown(null)
      setKgAnalysisIngestedId(null)
      setKgAnalysisResult(null)
    }
    try {
      const d = await window.api.kbKnowledgeGraph()
      setKgPayload(d)
    } catch {
      setKgPayload(null)
    } finally {
      setKgLoading(false)
    }
  }, [])

  const loadOntology = useCallback(async (request?: OntologyQueryRequest) => {
    setOntologyLoading(true)
    try {
      const [graph, stats] = await Promise.all([
        window.api.ontologyQuerySubgraph(request),
        window.api.ontologyStats()
      ])
      setOntologyPayload(graph)
      setOntologyStats(stats)
    } catch {
      setOntologyPayload(null)
      setOntologyStats(null)
    } finally {
      setOntologyLoading(false)
    }
  }, [])

  const loadOntologyEntityDetails = useCallback(async (iri: string) => {
    setOntologyDetailLoading(true)
    try {
      const d = await window.api.ontologyEntityDetails(iri, 80)
      setOntologyDetails(d)
    } catch {
      setOntologyDetails(null)
    } finally {
      setOntologyDetailLoading(false)
    }
  }, [])

  const rebuildOntologySnapshot = useCallback(async () => {
    try {
      await window.api.ontologyRebuild()
      await loadOntology()
    } catch {
      /* ignore */
    }
  }, [loadOntology])

  const exportOntologyJsonLd = useCallback(async () => {
    try {
      const payload = await window.api.ontologyExport()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `ontology-export-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
    } catch {
      /* ignore */
    }
  }, [])

  const loadCodebaseAnalyses = useCallback(async () => {
    try {
      setCodebaseAnalysisSnapshots(await window.api.codebaseWikiAnalysisLatest())
    } catch {
      setCodebaseAnalysisSnapshots([])
    }
  }, [])

  const runKnowledgeGraphAnalysis = useCallback(
    async (opts: { ingestReport: boolean }) => {
      setKgAnalysisBusy(true)
      setKgAnalysisError(null)
      if (!opts.ingestReport) {
        setKgAnalysisIngestedId(null)
      }
      try {
        const r = await window.api.kbGraphAnalysisRun(opts)
        if (!r.ok) {
          setKgAnalysisError(r.error)
          setKgAnalysisResult(null)
          return
        }
        setKgAnalysisSummary(r.result.summary)
        setKgAnalysisMarkdown(r.markdown)
        setKgAnalysisResult(r.result)
        setKgAnalysisIngestedId(r.ingestedSourceId ?? null)
        if (opts.ingestReport && r.ingestedSourceId) {
          await loadWiki()
          await loadKnowledgeGraph({ keepAnalysis: true })
        }
      } catch (e) {
        setKgAnalysisError(e instanceof Error ? e.message : String(e))
      } finally {
        setKgAnalysisBusy(false)
      }
    },
    [loadKnowledgeGraph, loadWiki]
  )

  const openKnowledgeGraph = useCallback(() => {
    setMainView('wiki')
    setWikiSubview('knowledgeGraph')
    void loadKnowledgeGraph()
  }, [loadKnowledgeGraph])

  useEffect(() => {
    if (mainView === 'architectureRepository' || ((mainView === 'wiki' || mainView === 'knowledgeGraph') && wikiSubview === 'knowledgeGraph')) {
      void loadKnowledgeGraph()
      void loadCodebaseAnalyses()
    }
    if (mainView === 'ontology') {
      void loadOntology()
    }
  }, [mainView, wikiSubview, wikiTopics.length, loadKnowledgeGraph, loadCodebaseAnalyses, loadOntology])

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

  useEffect(() => {
    if (typeof window.api.onKbIngestFileProgress !== 'function') return
    return window.api.onKbIngestFileProgress((payload) => {
      setWikiUploadProgress(payload)
      if (payload.kind === 'reading') {
        setWikiUploadFormat(payload.format)
      }
      if (payload.kind === 'done' || payload.kind === 'error' || payload.kind === 'cancelled') {
        setWikiUploadBusy(false)
        setWikiUploadFormat(null)
      }
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onWikiReanalyzeProgress !== 'function') return
    return window.api.onWikiReanalyzeProgress((payload) => {
      setWikiReanalyzeProgress(payload)
      if (payload.kind === 'done') {
        setWikiReanalyzeBusy(false)
        setWikiReanalyzeResult(payload.summary)
      }
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onWikiArticleCleanupProgress !== 'function') return
    return window.api.onWikiArticleCleanupProgress((payload) => {
      if (!wikiSelectedId || payload.sourceId !== wikiSelectedId) return
      if (payload.kind === 'started') {
        setWikiCleanupBusy(true)
        setWikiCleanupProgress(2)
        setWikiCleanupLabel('Preparing cleanup…')
        return
      }
      if (payload.kind === 'progress') {
        setWikiCleanupProgress(Math.max(0, Math.min(100, payload.progress)))
        setWikiCleanupLabel(payload.label || 'Cleaning article…')
        return
      }
      if (payload.kind === 'done') {
        setWikiCleanupProgress(100)
        setWikiCleanupLabel('Cleanup complete')
        setWikiCleanupBusy(false)
        return
      }
      if (payload.kind === 'error') {
        setWikiCleanupBusy(false)
      }
    })
  }, [wikiSelectedId])

  const refreshRuntimeStatus = useCallback(async () => {
    const s = await window.api.runtimeStatus()
    setRuntimeStatus(s)
  }, [])

  const applyRuntimeInstallPaths = useCallback(
    (c: Awaited<ReturnType<typeof window.api.runtimeInstallPath>>) => {
      setLlamaEnv({
        detected: c.llamaDetected,
        resolvedPath: c.llamaResolvedPath || '',
        configuredValid: c.llamaConfiguredPathValid,
        binaryValid: c.llamaBinaryValid ?? false,
        validateError: c.llamaValidateError ?? null
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
      const md = (paths?.modelsDefault ?? '').trim()
      const dt = destDir.trim()
      const extra: string[] = []
      if (dt) {
        if (md && !localModelPathsEqual(dt, md, winPlatform)) extra.push(dt)
        else if (!md) extra.push(dt)
      }
      const r = await window.api.listLocalModelsInDownloadDir(extra.length > 0 ? extra : undefined)
      setLocalModelFilePaths(r.paths)
    } catch {
      setLocalModelFilePaths([])
    }
  }, [paths?.modelsDefault, destDir, winPlatform])

  /** Top-bar “Files on my PC” list used to refresh only when Run was opened; load once paths (models dir) are known. */
  useEffect(() => {
    if (!paths) return
    void refreshLocalModelFiles()
  }, [paths, destDir, refreshLocalModelFiles])

  const refreshRunDrawer = useCallback(async () => {
    await refreshRunDrawerQuick()
    await refreshLocalModelFiles()
  }, [refreshRunDrawerQuick, refreshLocalModelFiles])

  const openSettings = useCallback((section: SettingsNavId = 'general') => {
    const allowed = visibleSettingsNavItems.map((x) => x.id)
    const target = allowed.includes(section) ? section : (allowed[0] ?? 'general')
    setSettingsNav(target)
    setDrawer('settings')
  }, [visibleSettingsNavItems])

  const openTrainChatForAugment = useCallback(() => {
    setMainView('chat')
    setKbChatPanelCollapsed(false)
  }, [])

  const openTrainWiki = useCallback(() => {
    setMainView('wiki')
    void loadWiki()
  }, [loadWiki])

  const openTrainPromptDomainSettings = useCallback(() => {
    openSettings('chat')
  }, [openSettings])

  const patchIdeJourneyChecklist = useCallback(async (patch: Partial<IdeJourneyChecklist>) => {
    setIdeJourneyChecklist((prev) => mergeIdeJourneyChecklist(prev, patch))
    const r = await window.api.setConfig({ ideJourneyChecklist: patch })
    if (!r.ok) setErr(r.error ?? 'Could not save checklist')
  }, [])

  const setIdeJourneyAutoChecklistPersist = useCallback(async (value: boolean) => {
    setIdeJourneyAutoChecklist(value)
    const r = await window.api.setConfig({ ideJourneyAutoChecklist: value })
    if (!r.ok) setErr(r.error ?? 'Could not save preferences')
  }, [])

  const markWelcomeGuideSeen = useCallback(async () => {
    const r = await window.api.setConfig({ welcomeGuideVersion: WELCOME_GUIDE_LATEST })
    if (!r.ok) {
      setErr(r.error ?? 'Could not save preferences')
      return
    }
    setWelcomeModalOpen(false)
  }, [])

  const applySetupTourAction = useCallback(
    (action: SetupTourAction) => {
      if (action.mainView === 'wiki') {
        setMainView('wiki')
        setWikiSubview('article')
        void loadWiki()
      } else if (action.mainView === 'knowledgeGraph') {
        setMainView('wiki')
        setWikiSubview('knowledgeGraph')
        void loadWiki()
        void loadKnowledgeGraph()
      } else if (action.mainView === 'ontology') {
        setMainView('ontology')
        void loadOntology()
      } else if (action.mainView === 'train') {
        openTrainSurface()
      } else if (action.mainView) {
        setMainView(action.mainView)
      }
      if (action.openDrawer === 'settings') {
        openSettings(action.settingsSection ?? 'general')
      } else {
        setDrawer(action.openDrawer)
      }
    },
    [loadKnowledgeGraph, loadOntology, loadWiki, openSettings, openTrainSurface]
  )

  const onWelcomeApplyAction = useCallback(
    async (action: SetupTourAction) => {
      if (action.openDrawer === 'runtime') setRuntimeKind('ollama')
      const configPatch: Record<string, unknown> = { welcomeGuideVersion: WELCOME_GUIDE_LATEST }
      if (action.openDrawer === 'runtime') configPatch.runtimeKind = 'ollama'
      const r = await window.api.setConfig(configPatch)
      if (!r.ok) {
        setErr(r.error ?? 'Could not save preferences')
        return
      }
      setWelcomeModalOpen(false)
      applySetupTourAction(action)
      if (action.openDrawer === 'runtime') void refreshRunDrawerQuick()
    },
    [applySetupTourAction, refreshRunDrawerQuick]
  )

  const showWelcomeGuideAgain = useCallback(async () => {
    const r = await window.api.setConfig({ welcomeGuideVersion: 0 })
    if (!r.ok) {
      setErr(r.error ?? 'Could not save preferences')
      return
    }
    setWelcomeModalOpen(true)
  }, [])

  const chooseArchitectureRepositoryScanRoot = useCallback(async () => {
    const p = await window.api.pickArchitectureRepositoryRoot()
    if (!p) return
    const r = await window.api.setConfig({ architectureRepositoryScanRoot: p })
    if (!r.ok) {
      setErr(r.error ?? 'Could not save Architecture Repository scan root')
      return
    }
    setArchitectureRepositoryScanRoot(p)
  }, [])

  const clearArchitectureRepositoryScanRoot = useCallback(async () => {
    const r = await window.api.setConfig({ architectureRepositoryScanRoot: null })
    if (!r.ok) {
      setErr(r.error ?? 'Could not clear Architecture Repository scan root')
      return
    }
    setArchitectureRepositoryScanRoot(null)
  }, [])

  const onSetupTourComplete = useCallback(
    async (p: SetupTourFinishPayload) => {
      const lay = roleLayout(p.uiRole)
      const pin = lay.defaultPinnedWidgets ?? {}
      const density = lay.defaultDensity
      const r = await window.api.setConfig({
        uiRole: p.uiRole,
        colorScheme: p.colorScheme,
        workspaceDensity: density,
        setupTourVersion: SETUP_TOUR_LATEST,
        setupTourOnStartup: p.showOnStartup,
        welcomeGuideVersion: WELCOME_GUIDE_LATEST,
        ...pin
      })
      if (!r.ok) {
        setErr(r.error ?? 'Could not save setup')
        return
      }
      setUiRole(p.uiRole)
      setWorkspaceDensity(density)
      setColorScheme(p.colorScheme)
      applyColorSchemeToDocument(p.colorScheme)
      setSetupTourOnStartup(p.showOnStartup)
      setSetupTourOpen(false)
      const target: MainView = p.mainView ?? layoutDefaultMainArea(lay)
      if (target === 'wiki') {
        setMainView('wiki')
        setWikiSubview('article')
        void loadWiki()
      } else if (target === 'knowledgeGraph') {
        setMainView('wiki')
        setWikiSubview('knowledgeGraph')
        void loadWiki()
        void loadKnowledgeGraph()
      } else {
        setMainView(target)
      }
      if (p.openDrawer) setDrawer(p.openDrawer)
      else setDrawer(null)
    },
    [loadKnowledgeGraph, loadWiki]
  )

  const rerunSetupTour = useCallback(async () => {
    const r = await window.api.setConfig({ setupTourVersion: 0 })
    if (!r.ok) {
      setErr(r.error ?? 'Could not save preferences')
      return
    }
    setWelcomeModalOpen(false)
    setSetupTourOpen(true)
  }, [])

  const saveLlamaBinaryFromSettings = useCallback(async () => {
    await window.api.setConfig({ llamaBinaryPath: llamaBin.trim() })
    await refreshRunDrawerQuick()
  }, [llamaBin, refreshRunDrawerQuick])

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
    const ok = await window.api.confirmDestructive({
      message: `Permanently delete ${toDelete.length} file(s)?`,
      detail: `${lines}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete'
    })
    if (!ok) return
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
    const ok = await window.api.confirmDestructive({
      message: `Remove ${toRemove.length} model(s) from Ollama?`,
      detail: `${lines}\n\nThis frees disk space in Ollama's store.`,
      confirmLabel: 'Remove'
    })
    if (!ok) return
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

  const persistLlamaConsoleExpanded = useCallback((open: boolean) => {
    setLlamaLoadConsoleExpanded(open)
    try {
      window.localStorage.setItem(LS_LLAMA_CONSOLE_EXPANDED, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    return window.api.onRuntimeLoadProgress((p) => {
      if (p.phase === 'load_log' && p.message) {
        setRuntimeLoadLog((prev) => {
          const next = prev + p.message
          return next.length > LLAMA_LOAD_LOG_MAX_CHARS
            ? next.slice(-LLAMA_LOAD_LOG_MAX_CHARS)
            : next
        })
        return
      }
      setRuntimeLoadProgress(p)
    })
  }, [])

  useEffect(() => {
    if (!runtimeLoadLog || !llamaLoadConsoleRef.current) return
    const el = llamaLoadConsoleRef.current
    el.scrollTop = el.scrollHeight
  }, [runtimeLoadLog, llamaLoadConsoleExpanded])

  useEffect(() => {
    if (!llamaConsoleResizing) return
    const onMove = (e: PointerEvent): void => {
      const r = llamaConsoleResizeRef.current
      if (!r) return
      const next = clampLlamaConsoleHeight(r.startH + (e.clientY - r.startY))
      setLlamaLoadConsoleHeightPx(next)
    }
    const onUp = (): void => {
      setLlamaLoadConsoleHeightPx((h) => {
        const c = clampLlamaConsoleHeight(h)
        try {
          window.localStorage.setItem(LS_LLAMA_CONSOLE_HEIGHT_PX, String(c))
        } catch {
          /* ignore */
        }
        return c
      })
      setLlamaConsoleResizing(false)
      llamaConsoleResizeRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [llamaConsoleResizing])

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

  const runResetWikiAndKeywords = useCallback(async () => {
    setSettingsConfirmKind(null)
    setSettingsMaintenanceMessage(null)
    setErr(null)
    setSettingsMaintenanceBusy('wikiReset')
    try {
      if (typeof window.api.kbResetWikiAndKeywords !== 'function') {
        setErr('Reset wiki is unavailable. Rebuild the app so preload includes kbResetWikiAndKeywords.')
        return
      }
      const r = await window.api.kbResetWikiAndKeywords()
      setWikiSelectedId(null)
      setWikiTitle('')
      setWikiBody('')
      setWikiGlossary([])
      setWikiRelated([])
      setWikiPassages([])
      setWikiKeywordCandidates([])
      setWikiSelectedPassageIds({})
      setWikiPassageFilterDraft('')
      setWikiExtractKeywordDraft('')
      setWikiExtractStatus(null)
      setWikiSearchQuery('')
      setWikiSearchHits([])
      setPromptDomains([])
      setPromptDomainSuffixDrafts({})
      setRagSnippets([])
      setRagQuery('')
      setTrainKbSelected({})
      await loadWiki()
      void window.api.promptDomainsList().then(setPromptDomains).catch(() => {})
      void loadKnowledgeGraph()
      setSettingsMaintenanceMessage(
        `Removed ${r.sourcesRemoved} knowledge source${r.sourcesRemoved === 1 ? '' : 's'} (wiki entries, chunks, and search index) and cleared ${r.promptDomainsRemoved} prompt domain${r.promptDomainsRemoved === 1 ? '' : 's'} (including all domain–message links). Chats and model files were not changed.`
      )
    } catch (e) {
      setErr(String(e))
    } finally {
      setSettingsMaintenanceBusy(false)
    }
  }, [loadKnowledgeGraph, loadWiki])

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
      if (typeof c.issuesPinned === 'boolean') setIssuesPinned(c.issuesPinned)
      if (typeof c.pinnedWidgetsBarCollapsed === 'boolean') setPinnedWidgetsBarCollapsed(c.pinnedWidgetsBarCollapsed)
      setPinnedWidgetsSide(parsePinnedWidgetsSide(c.pinnedWidgetsSide))
      if (typeof c.pinnedWidgetsWidthPx === 'number') {
        setPinnedWidgetsWidthPx(clampPinnedWidth(c.pinnedWidgetsWidthPx))
      }
      if (typeof c.pinnedWidgetsHeightPx === 'number') {
        setPinnedWidgetsHeightPx(clampPinnedHeight(c.pinnedWidgetsHeightPx))
      }
      if (c.pinnedWidgetWeights !== undefined) {
        const next = clampPinnedWidgetWeights(c.pinnedWidgetWeights)
        setPinnedWidgetWeights(next)
        pinnedWidgetWeightsRef.current = next
      }
      if (typeof c.metricsRefreshMs === 'number') {
        const ms = clampMetricsRefreshMs(c.metricsRefreshMs)
        setMetricsRefreshMs(ms)
        setMetricsRefreshCustomMode(!(METRICS_REFRESH_PRESETS_MS as readonly number[]).includes(ms))
      }
      const scheme = parseColorScheme(c.colorScheme)
      setColorScheme(scheme)
      applyColorSchemeToDocument(scheme)
      const comfort = parseTypographyComfort(c.typographyComfort)
      setTypographyComfort(comfort)
      applyTypographyComfortToDocument(comfort)
      const font = parseTypographyFontFamily(c.typographyFontFamily)
      const lh = parseTypographyLineHeightFactor(c.typographyLineHeightFactor)
      const le = parseTypographyLetterSpacingExtraEm(c.typographyLetterSpacingExtraEm)
      const ws = parseTypographyWordSpacingEm(c.typographyWordSpacingEm)
      typographyFontLiveRef.current = font
      typographyLineHeightLiveRef.current = lh
      typographyLetterExtraLiveRef.current = le
      typographyWordSpacingLiveRef.current = ws
      setTypographyFontFamily(font)
      setTypographyLineHeightFactor(lh)
      setTypographyLetterSpacingExtraEm(le)
      setTypographyWordSpacingEm(ws)
      if (typeof c.chatMaxTokens === 'number') {
        setChatMaxTokensDraft(String(clampChatMaxTokens(c.chatMaxTokens)))
      }
      setWikiAutoExtract(c.wikiAutoExtract !== false)
      setChatResponsePostProcess(c.chatResponsePostProcess !== false)
      setDeepLearnEnabled(c.deepLearnEnabled !== false)
      if (typeof c.deepLearnMaxRounds === 'number' && Number.isFinite(c.deepLearnMaxRounds)) {
        setDeepLearnMaxRoundsDraft(String(Math.min(24, Math.max(1, Math.floor(c.deepLearnMaxRounds)))))
      }
      if (typeof c.deepLearnMaxFetchBytes === 'number' && Number.isFinite(c.deepLearnMaxFetchBytes)) {
        setDeepLearnMaxFetchBytesDraft(
          String(Math.min(8_000_000, Math.max(4096, Math.floor(c.deepLearnMaxFetchBytes))))
        )
      }
      if (typeof c.agenticWorkersEnabled === 'boolean') setAgenticWorkersEnabled(c.agenticWorkersEnabled)
      if (typeof c.agentRemoteOllamaUrl === 'string') setAgentRemoteOllamaUrlDraft(c.agentRemoteOllamaUrl)
      if (typeof c.integrationListenEnabled === 'boolean') setIntegrationListenEnabled(c.integrationListenEnabled)
      if (typeof c.integrationPort === 'number') {
        setIntegrationPortDraft(String(clampIntegrationPort(c.integrationPort)))
      }
      if (typeof c.integrationToken === 'string') setIntegrationTokenDraft(c.integrationToken)
      {
        const ar =
          typeof c.architectureRepositoryScanRoot === 'string' ? c.architectureRepositoryScanRoot.trim() : ''
        setArchitectureRepositoryScanRoot(ar.length > 0 ? ar : null)
      }
      setIdeJourneyChecklist(mergeIdeJourneyChecklist(c.ideJourneyChecklist, {}))
      if (typeof c.ideJourneyAutoChecklist === 'boolean') setIdeJourneyAutoChecklist(c.ideJourneyAutoChecklist)
      const lrPath = typeof c.lastRuntimeModelPath === 'string' ? c.lastRuntimeModelPath.trim() : ''
      const lrKind =
        c.lastRuntimeModelKind === 'ollama' || c.lastRuntimeModelKind === 'llamacpp'
          ? c.lastRuntimeModelKind
          : null
      if (lrPath) setModelPath(lrPath)
      if (lrKind) setRuntimeKind(lrKind)
      else if (c.runtimeKind === 'ollama' || c.runtimeKind === 'llamacpp') setRuntimeKind(c.runtimeKind)
      setResumeRuntimeOnLaunch(c.resumeRuntimeOnLaunch === true)
      setUiRole(parseUiRoleOrDefault(c.uiRole))
      setWorkspaceDensity(parseWorkspaceDensity(c.workspaceDensity))
      setReleaseFeatureSet(normalizeReleaseFeatureSet(c.releaseFeatureSet))
      setPresentationModeEnabled(c.presentationModeEnabled !== false)
      setShowAdvancedSurfaces(c.showAdvancedSurfaces === true)
      setShowElectronDevMainView(c.showElectronDevMainView === true)
      const setupTourPref = c.setupTourOnStartup !== false
      setSetupTourOnStartup(setupTourPref)
      setAnimatedBackdropEnabled(c.animatedBackdropEnabled !== false)
      const stv = typeof c.setupTourVersion === 'number' ? c.setupTourVersion : 0
      const needSetupTour = stv < SETUP_TOUR_LATEST && setupTourPref
      setSetupTourOpen(needSetupTour)
      const wv = c.welcomeGuideVersion
      const welcomeSeen = typeof wv === 'number' && wv >= WELCOME_GUIDE_LATEST
      if (needSetupTour) setWelcomeModalOpen(false)
      else if (!welcomeSeen) setWelcomeModalOpen(true)
      if (typeof c.ollamaBaseUrl === 'string' && c.ollamaBaseUrl.trim()) {
        setOllamaBaseUrlDraft(c.ollamaBaseUrl.trim())
      } else {
        setOllamaBaseUrlDraft(OLLAMA_BASE_DEFAULT)
      }
      if (typeof c.llamaPort === 'number') {
        setLlamaPortDraft(String(clampLlamaPort(c.llamaPort)))
      } else {
        setLlamaPortDraft(String(LLAMA_PORT_DEFAULT))
      }
      if (typeof c.llamaContextTokens === 'number') {
        setLlamaContextTokensDraft(String(clampLlamaContextTokens(c.llamaContextTokens)))
      } else {
        setLlamaContextTokensDraft(String(LLAMA_CONTEXT_TOKENS_DEFAULT))
      }
      if (typeof c.llamaChatMaxTokens === 'number') {
        setLlamaChatMaxTokensDraft(String(clampChatMaxTokens(c.llamaChatMaxTokens)))
      } else {
        setLlamaChatMaxTokensDraft('')
      }
      if (typeof c.chatHistoryMaxMessages === 'number') {
        setChatHistoryMaxMessagesDraft(String(chatHistoryMaxMessagesFromConfig(c.chatHistoryMaxMessages)))
      } else {
        setChatHistoryMaxMessagesDraft(String(chatHistoryMaxMessagesFromConfig(undefined)))
      }
      setChatDomainEnhancement(c.chatDomainEnhancement === true)
      setLlamaRagGrounding(c.llamaRagGrounding === true)
      setOntologyEnabled(c.ontologyEnabled !== false)
      if (typeof c.ontologyMaxTriples === 'number' && Number.isFinite(c.ontologyMaxTriples)) {
        setOntologyMaxTriplesDraft(String(Math.min(200, Math.max(5, Math.floor(c.ontologyMaxTriples)))))
      } else {
        setOntologyMaxTriplesDraft('40')
      }
      if (typeof c.ontologyContextTokens === 'number' && Number.isFinite(c.ontologyContextTokens)) {
        setOntologyContextTokensDraft(String(Math.min(3000, Math.max(64, Math.floor(c.ontologyContextTokens)))))
      } else {
        setOntologyContextTokensDraft('512')
      }
      if (typeof c.llamaTemperature === 'number') setLlamaTemperatureDraft(String(c.llamaTemperature))
      if (typeof c.llamaTopP === 'number') setLlamaTopPDraft(String(c.llamaTopP))
      if (typeof c.llamaFrequencyPenalty === 'number') {
        setLlamaFrequencyPenaltyDraft(String(c.llamaFrequencyPenalty))
      }
      if (typeof c.llamaPresencePenalty === 'number') {
        setLlamaPresencePenaltyDraft(String(c.llamaPresencePenalty))
      }
      if (typeof c.llamaConvertScriptPath === 'string') setLlamaConvertScriptPath(c.llamaConvertScriptPath)
      if (typeof c.llamaPythonPath === 'string') setLlamaPythonPath(c.llamaPythonPath)
    })
      .finally(() => {
        setPresenceWakeConfigReady(true)
      })
  }, [refreshPaths, loadConversations, loadWiki, refreshRuntimeStatus, applyRuntimeInstallPaths])

  useEffect(() => {
    return window.api.onAppUpdateStatus((p: AppUpdateStatusPayload) => {
      if (p.phase === 'idle') {
        setAppUpdateLine(null)
        return
      }
      if (p.phase === 'checking') {
        setAppUpdateLine('Checking for updates…')
        return
      }
      if (p.phase === 'not_available') {
        setAppUpdateLine(`You're up to date (v${p.currentVersion}).`)
        return
      }
      if (p.phase === 'available') {
        setAppUpdateLine(`Update v${p.version} is available; downloading…`)
        return
      }
      if (p.phase === 'downloading') {
        setAppUpdateLine(`Downloading update… ${Math.round(p.percent)}%`)
        return
      }
      if (p.phase === 'downloaded') {
        setAppUpdateLine(`Update v${p.version} is ready. Confirm the restart dialog to finish installing.`)
        return
      }
      if (p.phase === 'error') {
        setAppUpdateLine(p.message)
      }
    })
  }, [])

  useEffect(() => {
    const next = clampMainViewForLayout(mainView, roleLayoutResolved, devShellChrome)
    if (next !== mainView) setMainView(next)
  }, [mainView, roleLayoutResolved, devShellChrome])

  useEffect(() => {
    if (advancedSurfacesVisible) return
    if (!isAdvancedMainView(mainView)) return
    setMainView(layoutDefaultMainArea(roleLayoutResolved))
    setDrawer(null)
  }, [advancedSurfacesVisible, mainView, roleLayoutResolved])

  useEffect(() => {
    const allowed = visibleSettingsNavItems.map((x) => x.id)
    if (allowed.length === 0) return
    if (!allowed.includes(settingsNav)) setSettingsNav(allowed[0] ?? 'general')
  }, [visibleSettingsNavItems, settingsNav])

  useEffect(() => {
    // Each role starts with its preferred density; users can still override from Settings.
    setWorkspaceDensity(roleLayoutResolved.defaultDensity)
  }, [roleLayoutResolved.defaultDensity, uiRole])

  useEffect(() => {
    setSettingsShowAdvanced(roleLayoutResolved.advancedSettingsByDefault === true)
  }, [roleLayoutResolved.advancedSettingsByDefault, uiRole])

  useLayoutEffect(() => {
    setViewToastNavigation({ activeMainView: mainView, openDrawer: drawer })
  }, [mainView, drawer])

  useLayoutEffect(() => {
    applyTypographyFineTuneToDocument({
      fontFamily: typographyFontFamily,
      lineHeightFactor: typographyLineHeightFactor,
      letterSpacingExtraEm: typographyLetterSpacingExtraEm,
      wordSpacingEm: typographyWordSpacingEm
    })
  }, [typographyFontFamily, typographyLineHeightFactor, typographyLetterSpacingExtraEm, typographyWordSpacingEm])

  useEffect(() => {
    if (workspaceDensity === 'standard') document.documentElement.removeAttribute('data-workspace-density')
    else document.documentElement.setAttribute('data-workspace-density', workspaceDensity)
  }, [workspaceDensity])

  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') touchPresenceSessionHidden()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!presenceWakeConfigReady || welcomeModalOpen || setupTourOpen) return
    try {
      if (sessionStorage.getItem(PRESENCE_WAKE_SHOWN_SESSION_KEY)) return
    } catch {
      return
    }
    setPresenceWakeOpen(true)
  }, [presenceWakeConfigReady, welcomeModalOpen, setupTourOpen])

  useEffect(() => {
    if (!presenceWakeConfigReady || welcomeModalOpen || setupTourOpen) return
    if (!resumeRuntimeOnLaunch) return
    if (!modelPath.trim()) return
    if (runtimeStarting || runtimeStatus?.running) return
    const kind = inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform)
    if (kind === 'ollama' && ollamaChatTagsLoading) return
    try {
      if (sessionStorage.getItem(AUTO_RESUME_ONCE_SESSION_KEY)) return
      sessionStorage.setItem(AUTO_RESUME_ONCE_SESSION_KEY, '1')
    } catch {
      return
    }
    void startRuntime()
  }, [
    presenceWakeConfigReady,
    welcomeModalOpen,
    setupTourOpen,
    resumeRuntimeOnLaunch,
    modelPath,
    runtimeStarting,
    runtimeStatus?.running,
    localModelFilePaths,
    winPlatform,
    ollamaChatTagsLoading
  ])

  useEffect(() => {
    if (presentationStarterToastShownRef.current) return
    if (!presenceWakeConfigReady || !presentationModeEnabled) return
    if (welcomeModalOpen || setupTourOpen || presenceWakeOpen) return
    presentationStarterToastShownRef.current = true
    notifyWhenBackground({
      origin: 'global',
      title: 'Presentation workflow ready',
      message: runtimeOn
        ? 'Continue with Knowledge -> Train -> Release Readiness.'
        : 'Start the runtime first, then continue with Knowledge -> Train -> Release Readiness.',
      action: runtimeOn
        ? {
            label: 'Open Knowledge',
            onClick: () => openKnowledgeLibrary()
          }
        : {
            label: 'Open Run',
            onClick: () => setDrawer('runtime')
          }
    })
  }, [
    openKnowledgeLibrary,
    presenceWakeConfigReady,
    presentationModeEnabled,
    welcomeModalOpen,
    setupTourOpen,
    presenceWakeOpen,
    runtimeOn
  ])

  useEffect(() => {
    const cap = 15
    void window.api.integrationPluginReportsList().then((list) => {
      setIntegrationPluginReports(list.slice(-cap))
    })
    const off = window.api.onIntegrationPluginReport((r) => {
      setIntegrationPluginReports((prev) => [...prev, r].slice(-cap))
      setIdePromptMonitor((prev) => {
        if (prev.modelState !== 'processing') return prev
        const line = [settingsPluginKindLabel(r.kind), r.message?.trim(), r.meta ? JSON.stringify(r.meta) : '']
          .filter((x) => Boolean(x))
          .join(' · ')
          .slice(0, 320)
        if (!line) return prev
        return {
          ...prev,
          actions: [...prev.actions, line].slice(-8),
          updatedAt: Date.now()
        }
      })
    })
    return off
  }, [])

  useEffect(() => {
    return window.api.onIntegrationModelActivity((evt: IntegrationModelActivityEvent) => {
      setIdePromptMonitor((prev) => {
        if (evt.kind === 'started') {
          return {
            modelState: 'processing',
            requestId: evt.requestId,
            source: evt.source,
            startedAt: evt.receivedAt,
            promptPreview: (evt.promptPreview ?? '').trim(),
            generatedResponse: '',
            actions: [],
            error: null,
            updatedAt: evt.receivedAt
          }
        }
        if (prev.requestId !== evt.requestId) return prev
        if (evt.kind === 'token') {
          const nextText = `${prev.generatedResponse}${evt.tokenText ?? ''}`.slice(0, 16_000)
          return { ...prev, generatedResponse: nextText, updatedAt: evt.receivedAt }
        }
        if (evt.kind === 'completed') {
          return {
            ...prev,
            modelState: 'idle',
            generatedResponse: (evt.responseText ?? prev.generatedResponse).slice(0, 16_000),
            error: null,
            updatedAt: evt.receivedAt
          }
        }
        if (evt.kind === 'error') {
          return {
            ...prev,
            modelState: 'idle',
            error: evt.error?.slice(0, 400) ?? 'Unknown error',
            updatedAt: evt.receivedAt
          }
        }
        return prev
      })
    })
  }, [])

  useEffect(() => {
    if (!ideJourneyAutoChecklist || ideJourneyChecklist.firstIdeChat) return
    const list = integrationPluginReports
    if (list.length === 0) return
    const last = list[list.length - 1]
    if (last.kind !== 'chat_completed') return
    if (last.receivedAt <= ideJourneyAutoMarkRef.current) return
    ideJourneyAutoMarkRef.current = last.receivedAt
    void patchIdeJourneyChecklist({ firstIdeChat: true })
  }, [ideJourneyAutoChecklist, ideJourneyChecklist.firstIdeChat, integrationPluginReports, patchIdeJourneyChecklist])

  useEffect(() => {
    if (inferredModelRuntimeKind !== 'llamacpp' || !llamaEnv?.detected || !llamaEnv.resolvedPath) return
    if (llamaBin.trim()) return
    setLlamaBin(llamaEnv.resolvedPath)
  }, [inferredModelRuntimeKind, llamaEnv?.detected, llamaEnv?.resolvedPath, llamaBin])

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
    if (!setupTourOpen) return
    void refreshRunDrawerQuick()
    const id = window.setInterval(() => void refreshRunDrawerQuick(), 2000)
    return () => window.clearInterval(id)
  }, [setupTourOpen, refreshRunDrawerQuick])

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
          const mergedDisplay = st.displayName ?? cur.displayName
          if (
            cur.progress !== st.progress ||
            cur.bytesReceived !== st.bytesReceived ||
            cur.bytesTotal !== st.bytesTotal ||
            cur.status !== st.status ||
            cur.displayName !== mergedDisplay
          ) {
            next[repoId] = {
              jobId: cur.jobId,
              progress: st.progress,
              bytesReceived: st.bytesReceived,
              bytesTotal: st.bytesTotal,
              status: st.status,
              displayName: mergedDisplay
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
      issuesPinned?: boolean
      metricsRefreshMs?: number
      pinnedWidgetsBarCollapsed?: boolean
      pinnedWidgetsSide?: PinnedWidgetsSide
      pinnedWidgetWeights?: Record<PinnedWidgetKind, number>
    }) => {
      const body: Record<string, unknown> = {}
      if (patch.metricsPinned !== undefined) body.metricsPinned = patch.metricsPinned
      if (patch.downloadsPinned !== undefined) body.downloadsPinned = patch.downloadsPinned
      if (patch.activityPinned !== undefined) body.activityPinned = patch.activityPinned
      if (patch.issuesPinned !== undefined) body.issuesPinned = patch.issuesPinned
      if (patch.metricsRefreshMs !== undefined) body.metricsRefreshMs = clampMetricsRefreshMs(patch.metricsRefreshMs)
      if (patch.pinnedWidgetsBarCollapsed !== undefined) body.pinnedWidgetsBarCollapsed = patch.pinnedWidgetsBarCollapsed
      if (patch.pinnedWidgetsSide !== undefined) body.pinnedWidgetsSide = patch.pinnedWidgetsSide
      if (patch.pinnedWidgetWeights !== undefined) {
        body.pinnedWidgetWeights = clampPinnedWidgetWeights(patch.pinnedWidgetWeights)
      }
      await window.api.setConfig(body)
    },
    []
  )

  const saveReleaseFeatureSet = useCallback((next: Record<string, boolean>) => {
    setReleaseFeatureSet(next)
    void window.api.setConfig({ releaseFeatureSet: next }).then((r) => {
      if (!r.ok) setErr(r.error ?? 'Could not save release feature set')
    })
  }, [])

  const saveColorScheme = useCallback(async (id: ColorSchemeId) => {
    setColorScheme(id)
    applyColorSchemeToDocument(id)
    await window.api.setConfig({ colorScheme: id })
  }, [])

  const saveTypographyComfort = useCallback(async (id: TypographyComfortId) => {
    setTypographyComfort(id)
    applyTypographyComfortToDocument(id)
    await window.api.setConfig({ typographyComfort: id })
  }, [])

  const persistTypographyTuneConfig = useCallback(() => {
    void window.api.setConfig({
      typographyFontFamily: typographyFontLiveRef.current,
      typographyLineHeightFactor: typographyLineHeightLiveRef.current,
      typographyLetterSpacingExtraEm: typographyLetterExtraLiveRef.current,
      typographyWordSpacingEm: typographyWordSpacingLiveRef.current
    })
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
    const active = animatedBackdropEnabled && (Boolean(runtimeStatus?.running) || runtimeStarting || chatSending)
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
  }, [animatedBackdropEnabled, runtimeStatus?.running, runtimeStarting, chatSending])

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

  const resetInteractionBaseline = useCallback(async () => {
    const ok = await window.api.confirmDestructive({
      message: 'Reset chat interaction to baseline?',
      detail:
        'Clears mood/journal for this model file, turns off “Domain-enhanced prompts”, and restores default llama sampling (temperature, top-p, penalties). Chat history is kept. If you loaded a merged fine-tune, switch back to your base GGUF in Run when you want original weights.',
      confirmLabel: 'Reset to baseline'
    })
    if (!ok) return
    clearModelProfileStorage()
    setChatDomainEnhancement(false)
    setLlamaTemperatureDraft('0.8')
    setLlamaTopPDraft('0.95')
    setLlamaFrequencyPenaltyDraft('0')
    setLlamaPresencePenaltyDraft('0')
    await window.api.setConfig({
      chatDomainEnhancement: false,
      llamaTemperature: 0.8,
      llamaTopP: 0.95,
      llamaFrequencyPenalty: 0,
      llamaPresencePenalty: 0
    })
    const curPath = (runtimeStatus?.modelPath ?? modelPath).trim()
    const norm = curPath.replace(/\\/g, '/').toLowerCase()
    if (norm.includes('/finetunes/')) {
      const r = await window.api.trainBaseForFinetunePath(curPath)
      if (r.baseModelPath) {
        setErr(
          `Baseline settings restored. This file is under finetunes — recorded base model path: ${r.baseModelPath}. Load it from Run for pre–fine-tune weights.`
        )
      } else {
        setErr(
          'Baseline settings restored. This file is under finetunes — load your original base GGUF from Run for pre–fine-tune weights (no matching train job was found).'
        )
      }
    } else {
      setErr(null)
    }
  }, [
    clearModelProfileStorage,
    modelPath,
    runtimeStatus?.modelPath,
    setErr,
    setChatDomainEnhancement
  ])

  const shellClassName = useMemo(() => {
    const parts = ['shell']
    if (presenceWakeOpen || wakeChromeReveal) parts.push('shell--boot-wake')
    if (wakeChromeReveal) parts.push('shell--boot-wake-reveal')
    return parts.join(' ')
  }, [presenceWakeOpen, wakeChromeReveal])

  const shellChromeClass = useMemo(() => {
    const parts = ['shell-chrome']
    if (presenceWakeOpen) parts.push('shell-chrome--wake-hidden')
    else if (wakeChromeReveal) parts.push('shell-chrome--wake-reveal')
    return parts.join(' ')
  }, [presenceWakeOpen, wakeChromeReveal])

  const onPresenceWakeIntensityChange = useCallback((n: number) => {
    setWakeBackdropIntensity(n)
  }, [])

  const onPresenceWakeDone = useCallback(() => {
    try {
      sessionStorage.setItem(PRESENCE_WAKE_SHOWN_SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
    setWakeBackdropIntensity(0)
    setPresenceWakeOpen(false)
    setWakeChromeReveal(true)
  }, [])

  useEffect(() => {
    if (!wakeChromeReveal) return
    const id = window.setTimeout(() => setWakeChromeReveal(false), 940)
    return () => window.clearTimeout(id)
  }, [wakeChromeReveal])

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

  const appBlockingIssues = useMemo((): AppBlockingIssue[] => {
    const out: AppBlockingIssue[] = []
    const inferred = inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform)
    if (inferred === 'ollama') {
      if (ollamaHost && !ollamaHost.reachable) {
        out.push({
          id: 'ollama-host',
          severity: 'error',
          message: `Ollama is not reachable at ${ollamaHost.baseUrl}. Start the Ollama app or change the base URL in Settings.`
        })
      }
      if (ollamaChatTagsErr?.trim()) {
        out.push({ id: 'ollama-list', severity: 'error', message: ollamaChatTagsErr.trim() })
      }
    }
    if (
      inferred === 'ollama' &&
      ollamaHost?.reachable &&
      !runtimeOn &&
      !ollamaChatTagsLoading &&
      !ollamaChatTagsErr &&
      ollamaChatTags.length === 0
    ) {
      out.push({
        id: 'ollama-no-models',
        severity: 'warning',
        message: 'No models are in your Ollama library yet. Pull one from Run or the Models hub.'
      })
    }
    return out
  }, [
    localModelFilePaths,
    modelPath,
    winPlatform,
    ollamaChatTags,
    ollamaChatTagsErr,
    ollamaChatTagsLoading,
    ollamaHost,
    runtimeOn
  ])

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
      <label className="metrics-widget-check" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={issuesPinned}
          onChange={(e) => {
            const v = e.target.checked
            setIssuesPinned(v)
            void saveMetricsWidgetConfig({ issuesPinned: v })
          }}
        />
        <span>
          <i className="fa-solid fa-triangle-exclamation" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
          Show blocking issues and warnings in the Pinned widgets panel
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
      <label className="metrics-widget-check" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={pinnedWidgetsBarCollapsed}
          onChange={(e) => {
            const v = e.target.checked
            setPinnedWidgetsBarCollapsed(v)
            void saveMetricsWidgetConfig({ pinnedWidgetsBarCollapsed: v })
          }}
        />
        <span>
          <i className="fa-solid fa-angles-left" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
          Keep the pinned widget bar collapsed (slim strip; click in the bar to expand)
        </span>
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
    if (drawer === 'train' || mainView === 'train') {
      void window.api.trainListJobs().then((j) => setTrainJobs(j as TrainJob[]))
      void window.api.kbSources().then((s) => setTrainKbSources((s as KbSource[]) ?? []))
      void window.api
        .kbWikiTopics()
        .then((t) => setWikiTopics((t as WikiTopic[]) ?? []))
        .catch(() => {})
      void window.api.promptDomainsList().then(setPromptDomains).catch(() => {})
      void window.api.trainReviewQueue({ limit: 120 }).then((rows) => setTrainReviewQueue(rows)).catch(() => {})
      void window.api.trainDomainProfilesList().then((rows) => setTrainDomainProfiles(rows)).catch(() => {})
      void window.api.trainDomainModelVersions().then((rows) => setTrainDomainModelVersions(rows)).catch(() => {})
      void refreshLocalModelFiles()
    }
    if (drawer === 'hf') {
      setHfLibraryMode('recommended')
      setHfResults([])
      setHfSearchLoading(false)
      setSelectedModel(null)
      setDetail(null)
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
  }, [drawer, mainView, refreshDownloadsList, refreshLocalModelFiles, refreshOllamaChatTags])

  useEffect(() => {
    if (!(drawer === 'train' || mainView === 'train')) return
    void window.api
      .trainReviewQueue({
        limit: 120,
        ...(trainSelectedDomainId ? { domainId: trainSelectedDomainId } : {})
      })
      .then((rows) => setTrainReviewQueue(rows))
      .catch(() => {})
    void window.api
      .trainDomainModelVersions(trainSelectedDomainId ? { domainId: trainSelectedDomainId } : {})
      .then((rows) => setTrainDomainModelVersions(rows))
      .catch(() => {})
  }, [drawer, mainView, trainSelectedDomainId])

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
    const fromOllama = hfDisplayModels.filter((m) =>
      ollamaRegistryTagInstalled(ollamaChatTags, m.ollamaLibraryName ?? '')
    )
    const fromFiles = hfDisplayModels.filter((m) =>
      localDownloads.some((r) => r.repo_id === m.id && r.status === 'complete')
    )
    const seen = new Set<string>()
    const merged: HfModelSummary[] = []
    for (const m of [...fromOllama, ...fromFiles]) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      merged.push(m)
    }
    const orphanRepoIds = new Set<string>()
    for (const r of localDownloads) {
      if (r.status !== 'complete') continue
      if (seen.has(r.repo_id)) continue
      orphanRepoIds.add(r.repo_id)
    }
    const extras: HfModelSummary[] = [...orphanRepoIds]
      .sort((a, b) => a.localeCompare(b))
      .map((repoId) => {
        const rows = localDownloads.filter((x) => x.repo_id === repoId && x.status === 'complete')
        const sum = rows.reduce((acc, x) => acc + (Number(x.bytes_total) || 0), 0)
        return {
          id: repoId,
          totalSizeBytes: sum > 0 ? sum : undefined
        }
      })
    return [...extras, ...merged]
  }, [hfDisplayModels, ollamaChatTags, localDownloads])

  const hfHubAvailableModels = useMemo(() => {
    return hfDisplayModels.filter((m) => {
      const inOllama = ollamaRegistryTagInstalled(ollamaChatTags, m.ollamaLibraryName ?? '')
      const inFiles = localDownloads.some((r) => r.repo_id === m.id && r.status === 'complete')
      return !inOllama && !inFiles
    })
  }, [hfDisplayModels, ollamaChatTags, localDownloads])

  const hfHubInstalledModelsSorted = useMemo(() => {
    const rows = hfHubInstalledModels.slice()
    rows.sort((a, b) => {
      const byName = a.id.localeCompare(b.id)
      if (byName !== 0) return byName
      const sa = hfSizeBytesForTableSort(a, localDownloads, true)
      const sb = hfSizeBytesForTableSort(b, localDownloads, true)
      return sa - sb
    })
    return rows
  }, [hfHubInstalledModels, localDownloads])

  /** Same order as `hfDisplayModels` (already sorted by filters panel sort). */
  const hfHubAvailableModelsSorted = useMemo(() => hfHubAvailableModels.slice(), [hfHubAvailableModels])

  useEffect(() => {
    setHfInstalledListPage(1)
    setHfAvailableListPage(1)
  }, [hfLibraryMode, hfHubInstalledModels.length, hfHubAvailableModels.length])

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(hfHubInstalledModels.length / HF_HUB_INSTALLED_PAGE_SIZE))
    setHfInstalledListPage((p) => (p > tp ? tp : p))
  }, [hfHubInstalledModels.length])

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(hfHubAvailableModels.length / HF_HUB_STORE_PAGE_SIZE))
    setHfAvailableListPage((p) => (p > tp ? tp : p))
  }, [hfHubAvailableModels.length])

  function backToRecommendations(): void {
    setHfLibraryMode('recommended')
    setHfResults([])
    setHfSearchLoading(false)
    setSelectedModel(null)
    setDetail(null)
    setHfInstalledListPage(1)
    setHfAvailableListPage(1)
  }

  async function runHfSearch(): Promise<void> {
    setErr(null)
    setHfLibraryMode('search')
    setHfSearchLoading(true)
    setSelectedModel(null)
    setDetail(null)
    const repoFromUrl = parseHuggingFaceRepoIdFromInput(hfQuery)
    const queryText = hfQuery.trim()
    const effectiveQuery = repoFromUrl ?? queryText
    if (repoFromUrl) {
      setHfQuery(repoFromUrl)
    }
    try {
      if (repoFromUrl) {
        try {
          const d = (await window.api.hfModelInfo(repoFromUrl)) as HfModelDetail
          setHfResults([hfDetailToBrowseSummary(d)])
          return
        } catch {
          /* not a model repo or network error — fall through to hub search */
        }
      }
      const r = await window.api.hfSearch(effectiveQuery, 40)
      setHfResults(r as HfModelSummary[])
    } catch (e) {
      setErr(String(e))
      setHfResults([])
    } finally {
      setHfSearchLoading(false)
      setHfInstalledListPage(1)
      setHfAvailableListPage(1)
    }
  }

  /**
   * Browse (Hub) single action: if the repo has a main GGUF or Safetensors file, download it from Hugging Face;
   * otherwise, when using Ollama and the model has a mapped library tag, pull that image instead.
   */
  async function installHubModelFromBrowse(repoId: string, primaryFilename?: string): Promise<void> {
    setErr(null)
    setQuickDownloadRepo(repoId)
    try {
      const d = (await window.api.hfModelInfo(repoId)) as HfModelDetail
      const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '')
      const want = primaryFilename?.trim()
      const filePath =
        want && (d.siblings ?? []).some((s) => normPath(s.path) === normPath(want))
          ? normPath(want)
          : pickPrimaryHubWeightFile(d.siblings ?? [])

      if (filePath) {
        const revision = hfResolveRevision(d, 'main')
        const paths = hubWeightDownloadPathSet(d.siblings ?? [], filePath)
        for (const filename of paths) {
          const displayName = clampDownloadDisplayLabel(hubWeightDownloadDisplayName(d, filename))
          const j = (await window.api.hfDownload({
            repoId,
            revision,
            filename,
            destDir: destDir.trim() || undefined,
            chatDisplayName: displayName
          })) as {
            id: string
            progress?: number
            bytesReceived?: number
            bytesTotal?: number
            status?: string
            chatDisplayName?: string
          }
          void refreshDownloadsList()
          setHfDownloadJobs((prev) => ({
            ...prev,
            [repoId]: {
              jobId: j.id,
              progress: typeof j.progress === 'number' ? j.progress : 0,
              bytesReceived: typeof j.bytesReceived === 'number' ? j.bytesReceived : 0,
              bytesTotal: typeof j.bytesTotal === 'number' ? j.bytesTotal : 0,
              status: typeof j.status === 'string' ? j.status : 'downloading',
              displayName: j.chatDisplayName?.trim() || displayName
            }
          }))
        }
        return
      }

      const tag = d.ollamaLibraryName?.trim()
      if (tag) {
        if (hfOllamaPullBusy) return
        setQuickDownloadRepo(null)
        await runOllamaPullForHub(repoId, tag)
        return
      }

      setErr(
        'No .gguf or .safetensors weight file found in this repository (or only auxiliary files such as mmproj). For models that exist only in the Ollama library, pick an Ollama-tagged card or pull by name from Run, then try again.'
      )
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
    } catch (e) {
      setErr(String(e))
      setDetail(null)
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

  async function deleteInstalledHubModel(m: HfModelSummary): Promise<void> {
    if (hfHubDeleteRepoBusy) return
    setErr(null)
    const preset = m.ollamaLibraryName?.trim() ?? ''
    const tagFromOllama =
      preset && ollamaRegistryTagInstalled(ollamaChatTags, preset)
        ? ollamaInstalledTagMatch(ollamaChatTags, preset) ?? preset
        : ''
    if (tagFromOllama) {
      const tag = tagFromOllama
      const ok = await window.api.confirmDestructive({
        message: `Remove “${tag}” from your Ollama library?`,
        detail: 'This frees disk space in Ollama’s store.',
        confirmLabel: 'Remove'
      })
      if (!ok) return
      setHfHubDeleteRepoBusy(m.id)
      try {
        await window.api.deleteOllamaModel(tag)
        try {
          localStorage.removeItem(profileStorageKey(tag))
        } catch {
          /* ignore */
        }
        const curTrim = modelPath.trim()
        if (curTrim === tag) setModelPath('')
        if (selectedModel === m.id) {
          setSelectedModel(null)
          setDetail(null)
        }
        await refreshOllamaChatTags()
        void refreshRunDrawerQuick()
      } catch (e) {
        setErr(String(e))
      } finally {
        setHfHubDeleteRepoBusy(null)
      }
      return
    }
    const rows = localDownloads.filter((r) => r.repo_id === m.id && r.status === 'complete')
    if (rows.length === 0) {
      setErr('No finished download found for this model.')
      return
    }
    const lines = rows.map((r) => fileNameFromPath(r.local_path)).join('\n')
    const ok = await window.api.confirmDestructive({
      message: `Permanently delete ${rows.length === 1 ? 'this file' : 'these files'}?`,
      detail: `${lines}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete'
    })
    if (!ok) return
    setHfHubDeleteRepoBusy(m.id)
    try {
      for (const r of rows) {
        await window.api.deleteLocalGgufModel(r.local_path)
        try {
          localStorage.removeItem(profileStorageKey(r.local_path))
        } catch {
          /* ignore */
        }
      }
      const curTrim = modelPath.trim()
      if (rows.some((r) => localModelPathsEqual(r.local_path, curTrim, winPlatform))) {
        setModelPath('')
      }
      if (selectedModel === m.id) {
        setSelectedModel(null)
        setDetail(null)
      }
      await refreshLocalModelFiles()
      void refreshDownloadsList()
      void refreshRunDrawerQuick()
    } catch (e) {
      setErr(String(e))
    } finally {
      setHfHubDeleteRepoBusy(null)
    }
  }

  function onHubLibraryRowActivate(m: HfModelSummary): void {
    if (selectedModel === m.id) {
      setSelectedModel(null)
      setDetail(null)
      return
    }
    void loadDetail(m.id)
  }

  async function startRuntime(): Promise<void> {
    if (runtimeStatus?.running || runtimeStarting) return
    setErr(null)
    setRuntimeStarting(true)
    setRuntimeLoadProgress(null)
    setRuntimeLoadLog('')
    const kind = inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform)
    setRuntimeKind(kind)
    if (kind === 'llamacpp') {
      persistLlamaConsoleExpanded(true)
    }
    try {
      const s = await window.api.runtimeStart({ kind, modelPath })
      setRuntimeStatus(s)
      const persist: Record<string, unknown> = {
        lastRuntimeModelPath: modelPath.trim(),
        lastRuntimeModelKind: kind,
        resumeRuntimeOnLaunch: true
      }
      if (kind === 'llamacpp') {
        const pathForStore = llamaBin.trim() || llamaEnv?.resolvedPath || ''
        persist.llamaBinaryPath = pathForStore
        persist.runtimeKind = kind
        await window.api.setConfig(persist)
        if (pathForStore) setLlamaBin(pathForStore)
      } else {
        persist.runtimeKind = kind
        await window.api.setConfig(persist)
      }
      void refreshRunDrawer()
    } catch (e) {
      setErr(String(e))
      setResumeRuntimeOnLaunch(false)
      try {
        sessionStorage.removeItem(AUTO_RESUME_ONCE_SESSION_KEY)
      } catch {
        /* ignore */
      }
      void window.api.setConfig({ resumeRuntimeOnLaunch: false }).catch(() => {
        /* ignore */
      })
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
      setResumeRuntimeOnLaunch(false)
      await window.api.setConfig({ resumeRuntimeOnLaunch: false })
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

  function deepLearnResume(jobId: string, action: 'continue' | 'finish', followUp?: string): void {
    void window.api.kbDeepLearnResume({ jobId, action, followUp })
    setDeepLearnUi((prev) =>
      prev && prev.jobId === jobId
        ? {
            ...prev,
            awaiting: undefined,
            label: action === 'finish' ? 'Finishing and saving…' : 'Continuing research…'
          }
        : prev
    )
  }

  async function sendChat(override?: { text?: string }): Promise<void> {
    const userText = typeof override?.text === 'string' ? override.text.trim() : draft.trim()
    if (!convId || !userText || chatSending) return
    const conversationId = convId
    if (!runtimeStatus?.running) {
      setErr(
        'Your AI is not running yet. In the top bar, choose a model and press the play button. When the dot turns green, try sending again — or open Run for setup help.'
      )
      return
    }
    if (agenticWorkersEnabled && runtimeStatus.kind !== 'ollama') {
      setErr(
        'Parallel multi-model agents need the Ollama runtime. Open Run, switch to Ollama, start a model — or turn off “Parallel agents” in Settings → Chat.'
      )
      return
    }
    setErr(null)
    setChatTurnNotice(null)
    setDraft('')
    const userRow = (await window.api.messageAppend(conversationId, 'user', userText)) as MessageAppendResponse
    const receiptKey = `${conversationId}:${userRow.id}`
    void window.api.promptDomainsList().then(setPromptDomains).catch(() => {})
    setMessages((prev) => [
      ...prev,
      {
        id: userRow.id,
        role: 'user',
        content: userText,
        createdAt: userRow.createdAt
      }
    ])
    setUserPromptReceipts((prev) => ({
      ...prev,
      [receiptKey]: { delivered: false, responseStarted: false, failed: false }
    }))
    const histMaxParsed = parseInt(chatHistoryMaxMessagesDraft.trim(), 10)
    const histCap = chatHistoryMaxMessagesFromConfig(Number.isFinite(histMaxParsed) ? histMaxParsed : undefined)
    const fullHistoryRows = messages.map((m) => ({ role: m.role, content: m.content }))
    const historyForApi = sliceChatHistoryMessages(fullHistoryRows, histCap)
    const historyDropped = fullHistoryRows.length - historyForApi.length

    const activeRagSnippets = ragLayerEnabled ? ragSnippets : []
    let context = userText
    if (activeRagSnippets.length) {
      context =
        'Use the following knowledge snippets when relevant:\n' +
        activeRagSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n') +
        '\n\nUser question:\n' +
        userText
      if (runtimeStatus.kind === 'llamacpp' && llamaRagGrounding) {
        context = `${context}\n\n${RAG_GROUNDING_INSTRUCTION}`
      }
    }

    const domainSuffix = (userRow.promptDomainSuffix ?? '').trim()
    const usePersonalityThisTurn = userMessageInvitesModelPersonality(userText)
    let systemPreamble = usePersonalityThisTurn
      ? MODEL_PROFILE_SYSTEM_PROMPT
      : CHAT_MINIMAL_SYSTEM_PROMPT
    if (domainSuffix) {
      systemPreamble = `${systemPreamble}\n\n--- Topic context (matched chat domain) ---\n${domainSuffix}`
    }

    const notices: string[] = []
    if (historyDropped > 0) {
      notices.push(
        `${historyDropped} older message(s) were not sent to the model (only the last ${histCap} user/assistant bubbles are included).`
      )
    }
    if (runtimeStatus.kind === 'llamacpp') {
      const ctxTok = clampLlamaContextTokens(
        parseInt(llamaContextTokensDraft.trim(), 10) || LLAMA_CONTEXT_TOKENS_DEFAULT
      )
      const histChars = historyForApi.reduce((a, m) => a + m.content.length, 0)
      const estTok = estimatePromptTokensFromChars(systemPreamble.length + histChars + context.length + 96)
      if (promptLikelyExceedsContext({ estimatedPromptTokens: estTok, contextTokens: ctxTok })) {
        notices.push(
          `Estimated prompt ~${estTok} tokens may exceed your llama.cpp context (${ctxTok}). Increase context in Settings → Data, lower “Chat history messages”, or shorten RAG.`
        )
      }
    }
    if (domainSuffix) {
      notices.push(
        `Domain context appended (~${domainSuffix.length} chars, max ${MAX_PROMPT_DOMAIN_SUFFIX_CHARS} per turn).`
      )
    }
    if (usePersonalityThisTurn) {
      notices.push(
        'This message matched an “opinion / personal stance” prompt — mood and journal markers are enabled for this reply only.'
      )
    }
    if (!ragLayerEnabled) {
      notices.push('RAG layer is off for this message — model receives your prompt without wiki snippets.')
    }
    setChatTurnNotice(notices.length > 0 ? notices.join(' ') : null)

    async function finishAssistantMessage(
      replyRaw: string,
      opts?: { skipWikiExtract?: boolean }
    ): Promise<void> {
      const { visible: replyVisible, patches: ambiancePatches, journalTexts } = stripModelProfileMarkers(replyRaw)
      const replyFinal =
        chatResponsePostProcess !== false ? postProcessAssistantChatMarkdown(replyVisible) : replyVisible
      const snap = activityChatTokensRef.current
      await window.api.messageAppend(
        conversationId,
        'assistant',
        replyFinal,
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
      if (persistKey && usePersonalityThisTurn && (ambiancePatches.length > 0 || journalTexts.length > 0)) {
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
      const m = await window.api.conversationMessages(conversationId)
      const reloaded = m as ChatMessageVm[]
      setMessages(reloaded)
      setUserPromptReceipts((prev) => {
        const next = { ...prev }
        delete next[receiptKey]
        return next
      })
      const convTitle = conversations.find((c) => c.id === conversationId)?.title
      if (!opts?.skipWikiExtract) {
        void window.api
          .kbWikiExtractTurn({
            conversationId: conversationId,
            conversationTitle: convTitle,
            userMessage: userText,
            assistantMessage: replyFinal
          })
          .then((r) => {
            if (r.ok && r.skipped === false && r.sourceId) void loadWiki()
          })
          .catch(() => {
            /* extraction is best-effort */
          })
      }
    }

    const deepIntent = parseDeepLearnIntent(userText)
    if (deepIntent.isDeepLearn && deepLearnEnabled) {
      const parsedRounds = parseInt(deepLearnMaxRoundsDraft.trim(), 10)
      const roundsCap = Math.min(24, Math.max(1, Number.isFinite(parsedRounds) ? parsedRounds : 5))
      const urlLines =
        deepIntent.candidateUrls.length > 0
          ? deepIntent.candidateUrls.map((u) => `• ${u}`).join('\n')
          : '(No http(s) links in this message — nothing will be downloaded.)'
      const detail = [
        `Topic: ${deepIntent.subject}`,
        '',
        `This runs up to ${roundsCap} research pass(es) on your local model (each pass uses completion tokens from Settings → Max response tokens).`,
        '',
        deepIntent.candidateUrls.length > 0
          ? 'The app will request these URLs from the main process only after you confirm. Localhost and private-network hosts are blocked.\n\n' + urlLines
          : urlLines
      ].join('\n')
      const startOk = await window.api.confirmDestructive({
        message: 'Start deep research and save a wiki article?',
        detail,
        confirmLabel: 'Start deep research'
      })
      if (startOk) {
        const jobId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        setChatSending(true)
        setStreamingReplyStartedAt(Date.now())
        setChatStreamBuffer('')
        setDeepLearnUi({ jobId, label: 'Starting deep research…' })
        activityChatTokensRef.current = null
        setActivityChatTokens(null)
        const offDl = window.api.onDeepLearnProgress((ev) => {
          if (ev.jobId !== jobId) return
          if (ev.kind === 'fetch') {
            setDeepLearnUi({ jobId, label: `Fetching ${ev.url}…`, awaiting: undefined })
          } else if (ev.kind === 'round') {
            setDeepLearnUi({
              jobId,
              label: `Research round ${ev.round}/${ev.maxRounds}…`,
              awaiting: undefined
            })
          } else if (ev.kind === 'roundAwaitChoice') {
            setDeepLearnUi({
              jobId,
              label: `Round ${ev.roundCompleted} complete${
                ev.modelSuggestsDone ? ' — model suggests wrapping up' : ''
              }. Choose how to proceed.`,
              awaiting: {
                paths: ev.explorePaths,
                roundCompleted: ev.roundCompleted,
                maxRounds: ev.maxRounds,
                canContinueMore: ev.canContinueMore,
                modelSuggestsDone: ev.modelSuggestsDone
              }
            })
          } else if (ev.kind === 'ingest') {
            setDeepLearnUi({ jobId, label: 'Saving to knowledge wiki…', awaiting: undefined })
          } else if (ev.kind === 'cancelled') {
            setDeepLearnUi({ jobId, label: 'Cancelled.', awaiting: undefined })
          }
        })
        try {
          const res = await window.api.kbDeepLearnRun({
            jobId,
            conversationId,
            subject: deepIntent.subject,
            userMessage: userText,
            approvedFetchUrls: deepIntent.candidateUrls
          })
          if (res.ok) {
            const fetchNote =
              res.fetchErrors && res.fetchErrors.length
                ? `\n\nSome URLs failed to download (see the **Fetch notes** section in the new wiki page):\n${res.fetchErrors.map((e) => `- ${e}`).join('\n')}`
                : ''
            const exploreNote =
              res.lastExplorePaths && res.lastExplorePaths.length > 0
                ? `\n\n**Suggested paths for your next message** (copy a line into the composer):\n${res.lastExplorePaths
                    .map((p) => `- Learn everything about **${p.label}**`)
                    .join('\n')}`
                : ''
            const assistantText = [
              `Deep research finished and saved **${res.title}** (${res.roundsUsed} model round(s)).`,
              'Open **Knowledge wiki** to read the full article; open **Graph** in the sidebar to see this source in the knowledge graph.',
              fetchNote,
              exploreNote
            ].join('\n')
            await finishAssistantMessage(assistantText, { skipWikiExtract: true })
            void loadWiki()
            void loadKnowledgeGraph()
          } else if (res.cancelled) {
            setErr('Deep research was cancelled.')
            setUserPromptReceipts((prev) => {
              const cur = prev[receiptKey] ?? { delivered: false, responseStarted: false }
              return { ...prev, [receiptKey]: { ...cur, failed: true } }
            })
          } else {
            setErr(res.error || 'Deep research failed.')
            setUserPromptReceipts((prev) => {
              const cur = prev[receiptKey] ?? { delivered: false, responseStarted: false }
              return { ...prev, [receiptKey]: { ...cur, failed: true } }
            })
          }
        } catch (e) {
          setErr(humanizeChatError(String(e)))
          setUserPromptReceipts((prev) => {
            const cur = prev[receiptKey] ?? { delivered: false, responseStarted: false }
            return { ...prev, [receiptKey]: { ...cur, failed: true } }
          })
        } finally {
          offDl()
          setDeepLearnUi(null)
          setChatSending(false)
          setStreamingReplyStartedAt(null)
          setChatStreamBuffer('')
        }
        return
      }
    }

    const useAgentic = agenticWorkersEnabled && runtimeStatus.kind === 'ollama'
    let agentHandled = false

    if (useAgentic) {
      chatStreamSawFirstTokenRef.current = false
      setChatSending(true)
      setStreamingReplyStartedAt(Date.now())
      setChatStreamBuffer('Planning parallel workers…')
      activityChatTokensRef.current = null
      setActivityChatTokens(null)
      try {
        const tagsRes = await window.api.ollamaListTags()
        const tagNames = tagsRes.names ?? []
        const hw = await window.api.hardwareSummary(paths?.modelsDefault)
        const remote = agentRemoteOllamaUrlDraft.trim()
        const plannerMsgs = [
          {
            role: 'system' as const,
            content: buildAgentPlannerSystemPrompt({
              localOllamaTags: tagNames,
              hardwareSummary: hw,
              remoteOllamaBaseUrl: remote || undefined,
              primaryModelName: (runtimeStatus.modelPath ?? modelPath).trim() || 'primary'
            })
          },
          { role: 'user' as const, content: `Decide worker routing for this request:\n\n${context}` }
        ]
        const planRaw = await window.api.runtimeChat(plannerMsgs, '', { maxTokens: AGENT_PLANNER_MAX_TOKENS })
        const plan = parseAgentPlanFromModelReply(planRaw, Boolean(remote))
        if (plan) {
          setUserPromptReceipts((prev) => {
            const cur = prev[receiptKey]
            if (!cur) return prev
            return { ...prev, [receiptKey]: { ...cur, delivered: true, responseStarted: true } }
          })
          const nTok = parseInt(chatMaxTokensDraft.trim(), 10)
          const workerMax = Math.min(
            AGENT_WORKER_MAX_TOKENS,
            clampChatMaxTokens(Number.isFinite(nTok) ? nTok : CHAT_MAX_TOKENS_DEFAULT)
          )
          setChatStreamBuffer(`Running ${plan.workers.length} specialist worker(s) in parallel…`)
          const workerResults = await Promise.all(
            plan.workers.map((spec) => {
              const wm = buildWorkerMessages({
                originalUser: userText,
                kbContext: context,
                spec
              })
              return window.api
                .runtimeChat(wm, '', {
                  maxTokens: workerMax,
                  ollamaModel: spec.model,
                  ollamaBaseUrl: spec.backend === 'remote' && remote ? remote : undefined
                })
                .then((text) => ({ spec, text }))
            })
          )
          const body = workerResults
            .map(
              (r) =>
                `### ${r.spec.focus} (${r.spec.model}${r.spec.backend === 'remote' ? ' · self-hosted Ollama' : ''})\n\n${r.text.trim()}`
            )
            .join('\n\n---\n\n')
          let replyRaw = body
          if (plan.synthesize) {
            const synRid =
              typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`
            const pair = buildSynthesisMessages(body, userText)
            const synSystemBase = userMessageInvitesModelPersonality(userText)
              ? MODEL_PROFILE_SYSTEM_PROMPT
              : CHAT_MINIMAL_SYSTEM_PROMPT
            const synMsgs = [
              {
                role: 'system' as const,
                content: `${synSystemBase}\n\n${pair[0].content}`
              },
              { role: 'user' as const, content: pair[1].content }
            ]
            const synChars = synMsgs.reduce((acc, m) => acc + m.content.length, 0)
            const synEst = Math.max(1, Math.ceil(synChars / 4))
            const initialSynTok: ActivityChatTokens = {
              prompt: synEst,
              completion: 0,
              promptIsEstimate: true,
              completionIsEstimate: true
            }
            activityChatTokensRef.current = initialSynTok
            setActivityChatTokens(initialSynTok)
            setChatStreamBuffer('')
            chatStreamSawFirstTokenRef.current = false
            const offSyn = window.api.onRuntimeChatProgress((p) => {
              if (p.requestId !== synRid) return
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
                      prompt: synEst,
                      completion: 0,
                      promptIsEstimate: true,
                      completionIsEstimate: true
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
              replyRaw = await window.api.runtimeChat(synMsgs, synRid, { maxTokens: workerMax })
            } finally {
              offSyn()
            }
          } else {
            setChatStreamBuffer(body)
          }
          await finishAssistantMessage(replyRaw)
          agentHandled = true
        } else {
          setChatStreamBuffer('')
          setErr(
            'The planner did not return usable worker JSON. Falling back to a normal single-model reply for this message.'
          )
        }
      } catch (e) {
        setErr(humanizeChatError(String(e)))
      } finally {
        if (!agentHandled) {
          setChatSending(false)
          setStreamingReplyStartedAt(null)
          setChatStreamBuffer('')
          activityChatTokensRef.current = null
          setActivityChatTokens(null)
        }
      }
      if (agentHandled) {
        setChatSending(false)
        setStreamingReplyStartedAt(null)
        setChatStreamBuffer('')
        activityChatTokensRef.current = null
        setActivityChatTokens(null)
        return
      }
    }

    const msgs = [
      { role: 'system' as const, content: systemPreamble },
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
      completionIsEstimate: true
    }
    activityChatTokensRef.current = initialTok
    setActivityChatTokens(initialTok)
    chatStreamSawFirstTokenRef.current = false
    const offChat = window.api.onRuntimeChatProgress((p) => {
      if (p.requestId !== requestId) return
      if (p.kind === 'started') {
        setUserPromptReceipts((prev) => {
          const cur = prev[receiptKey]
          if (!cur) return prev
          return { ...prev, [receiptKey]: { ...cur, delivered: true } }
        })
        return
      }
      if (p.kind === 'token' && p.text) {
        if (!chatStreamSawFirstTokenRef.current) {
          chatStreamSawFirstTokenRef.current = true
          setUserPromptReceipts((prev) => {
            const cur = prev[receiptKey]
            if (!cur) return prev
            return {
              ...prev,
              [receiptKey]: { delivered: true, responseStarted: true }
            }
          })
        }
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
              completionIsEstimate: true
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
      await finishAssistantMessage(reply)
      const replyForRagCheck = (() => {
        const v = stripModelProfileMarkers(reply).visible
        return chatResponsePostProcess !== false ? postProcessAssistantChatMarkdown(v) : v
      })()
      if (
        runtimeStatus.kind === 'llamacpp' &&
        llamaRagGrounding &&
        activeRagSnippets.length > 0 &&
        ragReplyMissingSnippetCitations(replyForRagCheck, activeRagSnippets.length)
      ) {
        setChatTurnNotice((prev) => {
          const extra =
            'RAG: reply did not cite snippet numbers like [1] — verify factual claims against your sources.'
          return prev ? `${prev} ${extra}` : extra
        })
      }
    } catch (e) {
      setErr(humanizeChatError(String(e)))
      setUserPromptReceipts((prev) => {
        const cur = prev[receiptKey] ?? { delivered: false, responseStarted: false }
        return { ...prev, [receiptKey]: { ...cur, failed: true } }
      })
    } finally {
      offChat()
      setChatSending(false)
      setStreamingReplyStartedAt(null)
      setChatStreamBuffer('')
      activityChatTokensRef.current = null
      setActivityChatTokens(null)
    }
  }

  async function retryUserPrompt(m: ChatMessageVm, index: number): Promise<void> {
    if (!convId || chatSending || m.role !== 'user') return
    const rk = userMessageReceiptKey(convId, m)
    const receipt = rk ? userPromptReceipts[rk] : undefined
    if (!userMessageShowsRetry(m, index, messages, receipt, chatSending)) return
    const id = m.id
    if (!id) {
      setErr('Cannot retry this prompt from here — copy the text into the composer and send again.')
      return
    }
    setErr(null)
    try {
      const { ok } = await window.api.messageDelete(convId, id)
      if (!ok) throw new Error('That message was not found.')
      if (rk) {
        setUserPromptReceipts((prev) => {
          const next = { ...prev }
          delete next[rk]
          return next
        })
      }
      const reloaded = (await window.api.conversationMessages(convId)) as ChatMessageVm[]
      setMessages(reloaded)
      await sendChat({ text: m.content.trim() })
    } catch (e) {
      setErr(String(e))
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
        setWikiPassages([])
        setWikiKeywordCandidates([])
        setWikiSelectedPassageIds({})
        setWikiPassageFilterDraft('')
        setWikiExtractKeywordDraft('')
        setWikiExtractStatus(null)
      }
    } catch (e) {
      setErr(String(e))
    }
  }

  async function connectDmsWithToken(): Promise<void> {
    if (!dmsAccessTokenDraft.trim()) {
      setErr('Enter an access token to connect a DMS provider.')
      return
    }
    setDmsConnecting(true)
    setErr(null)
    try {
      const res = await window.api.dmsConnectWithToken({
        provider: dmsSelectedProvider,
        accessToken: dmsAccessTokenDraft.trim(),
        displayName: dmsConnectDisplayName.trim() || undefined
      })
      if (!res.ok) {
        setErr(res.error)
        return
      }
      setDmsAccessTokenDraft('')
      setDmsConnectDisplayName('')
      setDmsConnectFormOpen(false)
      await loadDmsConnectionsAndRoots()
    } catch (e) {
      setErr(String(e))
    } finally {
      setDmsConnecting(false)
    }
  }

  function parseDmsScopes(raw: string): string[] {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function parseOauthCallbackDraft(raw: string): { code?: string; state?: string } {
    const t = raw.trim()
    if (!t) return {}
    try {
      const u = new URL(t)
      const code = u.searchParams.get('code')?.trim()
      const state = u.searchParams.get('state')?.trim()
      return {
        ...(code ? { code } : {}),
        ...(state ? { state } : {})
      }
    } catch {
      return {}
    }
  }

  async function startDmsOAuthConnect(): Promise<void> {
    if (!dmsOauthClientIdDraft.trim()) {
      setErr('Client ID is required for OAuth2 connect.')
      return
    }
    setDmsConnecting(true)
    setErr(null)
    try {
      const res = await window.api.dmsConnectStart({
        provider: dmsSelectedProvider,
        clientId: dmsOauthClientIdDraft.trim(),
        clientSecret: dmsOauthClientSecretDraft.trim() || undefined,
        redirectUri: dmsOauthRedirectUriDraft.trim() || DMS_DEFAULT_OAUTH_REDIRECT_URI,
        scopes: dmsOauthScopesDraft.trim() ? parseDmsScopes(dmsOauthScopesDraft) : undefined,
        tenantId: dmsOauthTenantIdDraft.trim() || undefined,
        siteId: dmsOauthSiteIdDraft.trim() || undefined
      })
      if (!res.ok) {
        setErr(res.error)
        return
      }
      setDmsOauthStateDraft(res.state)
      setDmsSyncStatusLine('OAuth started. Complete consent, then paste callback URL and press Complete OAuth2.')
      await window.api.openExternalUrl(res.authUrl)
    } catch (e) {
      setErr(String(e))
    } finally {
      setDmsConnecting(false)
    }
  }

  async function completeDmsOAuthConnect(): Promise<void> {
    const parsed = parseOauthCallbackDraft(dmsOauthCallbackUrlDraft)
    const code = (parsed.code ?? dmsOauthCodeDraft).trim()
    const state = (parsed.state ?? dmsOauthStateDraft).trim()
    if (!code || !state) {
      setErr('OAuth completion requires both code and state.')
      return
    }
    setDmsConnecting(true)
    setErr(null)
    try {
      const res = await window.api.dmsConnectComplete({
        code,
        state,
        displayName: dmsConnectDisplayName.trim() || undefined
      })
      if (!res.ok) {
        setErr(res.error)
        return
      }
      setDmsOauthCodeDraft('')
      setDmsOauthStateDraft('')
      setDmsOauthCallbackUrlDraft('')
      setDmsConnectDisplayName('')
      setDmsConnectFormOpen(false)
      await loadDmsConnectionsAndRoots()
      setDmsSyncStatusLine('OAuth connection created.')
    } catch (e) {
      setErr(String(e))
    } finally {
      setDmsConnecting(false)
    }
  }

  async function loadDmsFolders(connectionId: string): Promise<void> {
    setDmsFoldersBusyForConnectionId(connectionId)
    setErr(null)
    try {
      const folders = await window.api.dmsFoldersList(connectionId)
      setDmsFolderOptions(folders)
      if (folders.length > 0) {
        setDmsSelectedFolderId((prev) => prev || folders[0].id)
      }
    } catch (e) {
      setErr(String(e))
      setDmsFolderOptions([])
    } finally {
      setDmsFoldersBusyForConnectionId(null)
    }
  }

  async function registerDmsFolderImport(): Promise<void> {
    if (!dmsSelectedConnectionId || !dmsSelectedFolderId) {
      setErr('Choose a DMS connection and folder first.')
      return
    }
    const folder = dmsFolderOptions.find((f) => f.id === dmsSelectedFolderId)
    if (!folder) {
      setErr('Choose a valid folder to import.')
      return
    }
    setErr(null)
    const res = await window.api.dmsImportStart({
      connectionId: dmsSelectedConnectionId,
      folderId: folder.id,
      folderName: folder.name,
      folderPath: folder.path
    })
    if (!res.ok) {
      setErr(res.error)
      return
    }
    await loadDmsConnectionsAndRoots()
    setDmsSyncStatusLine(`Registered folder ${folder.name}. Click Sync now to ingest files.`)
  }

  async function runDmsManualSync(rootId: string): Promise<void> {
    setDmsSyncBusyRootId(rootId)
    setErr(null)
    setDmsSyncStatusLine('Running DMS sync…')
    try {
      const res = await window.api.dmsSyncRun({ rootId })
      if (!res.ok) {
        setErr(res.error)
        setDmsSyncStatusLine(res.error)
        return
      }
      setDmsSyncStatusLine(
        `Sync complete: ${res.importedCount} imported, ${res.updatedCount} updated, ${res.removedCount} removed.`
      )
      await loadWiki()
      void loadKnowledgeGraph({ keepAnalysis: true })
    } catch (e) {
      setErr(String(e))
    } finally {
      setDmsSyncBusyRootId(null)
    }
  }

  async function disconnectDmsConnection(connectionId: string): Promise<void> {
    setErr(null)
    try {
      const ok = await window.api.dmsDisconnect(connectionId)
      if (!ok.ok) {
        setErr('Could not disconnect DMS connection.')
        return
      }
      await loadDmsConnectionsAndRoots()
      setDmsFolderOptions([])
      setDmsSelectedFolderId('')
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
      const snippets =
        typeof window.api.kbSearchRetrieval === 'function'
          ? (await window.api.kbSearchRetrieval({ query: t, limit: 8 })).map((hit) => hit.snippet)
          : await window.api.kbSearch(t, 8)
      setRagSnippets(snippets)
    } finally {
      setRagLoading(false)
    }
  }

  async function runRag(): Promise<void> {
    await runRagWithQuery(ragQuery)
  }

  async function runWikiSearchAsChat(queryOverride?: string): Promise<void> {
    const q = (queryOverride ?? wikiSearchQuery).trim()
    if (!q || chatSending) return
    setMainView('chat')
    setDrawer(null)
    setRagLayerEnabled(true)
    setRagQuery(q)
    await runRagWithQuery(q)
    await sendChat({ text: q })
  }

  function onWikiSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return
    const q = wikiSearchQuery.trim()
    if (!q) return
    e.preventDefault()
    void runWikiSearchAsChat(q)
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

  async function openWikiPage(sourceId: string, opts?: { sectionOrd?: number | null }): Promise<void> {
    setWikiSubview('article')
    setWikiSelectedId(sourceId)
    pendingWikiSectionOrdRef.current =
      typeof opts?.sectionOrd === 'number' && Number.isFinite(opts.sectionOrd) ? Math.max(0, opts.sectionOrd) : null
    const p = await window.api.kbWikiPage(sourceId)
    setWikiTitle(p.title)
    setWikiBody(p.body)
    setWikiImportConfidence(p.confidence ?? null)
    setWikiGlossary(p.glossary)
    setWikiRelated(p.relatedSources)
    setWikiPassages(p.passages ?? [])
    setWikiKeywordCandidates(p.suggestedKeywords ?? [])
    const preselected = Object.fromEntries((p.passages ?? []).map((x) => [x.chunkId, true]))
    setWikiSelectedPassageIds(preselected)
    setWikiPassageFilterDraft('')
    setWikiExtractKeywordDraft(p.suggestedKeywords?.[0]?.keyword ?? p.title.split(/\s+/).slice(0, 3).join(' '))
    setWikiExtractStatus(null)
  }

  async function navigateChatKeywordToWiki(sourceId: string): Promise<void> {
    setMainView('wiki')
    setWikiSubview('article')
    await openWikiPage(sourceId)
  }

  async function handleWikiTermClick(sourceId: string, phrase: string): Promise<void> {
    const trimmedPhrase = phrase.trim()
    if (!trimmedPhrase) {
      await navigateChatKeywordToWiki(sourceId)
      return
    }
    try {
      const resolved = await window.api.kbWikiResolveTerm({
        term: trimmedPhrase,
        contextSourceId: wikiSelectedId ?? sourceId,
        contextSnippet: trimmedPhrase.slice(0, 220)
      })
      if (resolved.matched && resolved.sourceId) {
        await navigateChatKeywordToWiki(resolved.sourceId)
        return
      }
      setWikiExtractKeywordDraft(resolved.keyword || trimmedPhrase)
      setWikiExtractStatus(`No existing page found for "${trimmedPhrase}". Review selected passages and extract a new article.`)
    } catch {
      setWikiExtractKeywordDraft(trimmedPhrase)
      setWikiExtractStatus(`No existing page found for "${trimmedPhrase}". Review selected passages and extract a new article.`)
    }
  }

  async function runWikiManualExtraction(): Promise<void> {
    if (!wikiSelectedId || wikiExtractBusy) return
    const chunkIds = Object.entries(wikiSelectedPassageIds)
      .filter(([, on]) => on)
      .map(([id]) => id)
    const keyword = wikiExtractKeywordDraft.trim()
    if (!keyword || chunkIds.length === 0) {
      setWikiExtractStatus('Select at least one passage and a keyword.')
      return
    }
    setWikiExtractBusy(true)
    setWikiExtractStatus(null)
    setErr(null)
    try {
      const res = await window.api.kbWikiExtractArticle({
        sourceId: wikiSelectedId,
        keyword,
        chunkIds
      })
      await loadWiki()
      setWikiExtractStatus(`Created "${res.title}" from ${res.chunkCount} passage(s).`)
      await openWikiPage(res.sourceId)
    } catch (e) {
      const msg = String(e)
      setErr(msg)
      setWikiExtractStatus(msg)
    } finally {
      setWikiExtractBusy(false)
    }
  }

  async function runWikiArticleCleanup(): Promise<void> {
    if (!wikiSelectedId || wikiCleanupBusy) return
    if (typeof window.api.kbWikiCleanupArticle !== 'function') {
      setErr('Wiki article cleanup is unavailable. Rebuild the app so preload includes kbWikiCleanupArticle.')
      return
    }
    setWikiCleanupBusy(true)
    setWikiCleanupProgress(2)
    setWikiCleanupLabel('Preparing cleanup…')
    setErr(null)
    setWikiExtractStatus(null)
    try {
      const result = await window.api.kbWikiCleanupArticle(wikiSelectedId)
      await loadWiki()
      await openWikiPage(wikiSelectedId)
      const modeLabel = result.mode === 'llm' ? 'LLM' : 'heuristic'
      const fallback = result.fallbackReason ? ` (${result.fallbackReason.replace(/_/g, ' ')})` : ''
      setWikiExtractStatus(`Article cleanup complete via ${modeLabel}${fallback}.`)
    } catch (e) {
      const msg = String(e)
      setErr(msg)
      setWikiExtractStatus(msg)
    } finally {
      setWikiCleanupBusy(false)
    }
  }

  async function applyWikiDomainOverride(): Promise<void> {
    if (!wikiSelectedId || wikiDomainSaving) return
    const selected = wikiTopics.find((x) => x.id === wikiSelectedId)
    if (!selected || selected.kind !== 'document') return
    const domainTitle = wikiDomainDraft.replace(/\s+/g, ' ').trim()
    if (!domainTitle) {
      setWikiExtractStatus('Enter a domain name before applying.')
      return
    }
    setWikiDomainSaving(true)
    setErr(null)
    try {
      const res = await window.api.kbSourceSetDomain({ sourceId: wikiSelectedId, domainTitle })
      await loadWiki()
      await openWikiPage(wikiSelectedId)
      setWikiExtractStatus(`Assigned domain: ${res.domainTitle}.`)
    } catch (e) {
      const msg = String(e)
      setErr(msg)
      setWikiExtractStatus(msg)
    } finally {
      setWikiDomainSaving(false)
    }
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

  async function runWikiReanalysisAll(): Promise<void> {
    if (typeof window.api.kbWikiReanalyzeRun !== 'function') {
      setErr('Wiki reanalysis is unavailable. Rebuild the app so preload includes kbWikiReanalyzeRun.')
      return
    }
    if (wikiReanalyzeBusy) return
    setErr(null)
    setWikiReanalyzeBusy(true)
    setWikiReanalyzeProgress(null)
    setWikiReanalyzeResult(null)
    try {
      const result = await window.api.kbWikiReanalyzeRun()
      setWikiReanalyzeResult(result)
      if (!result.ok) {
        setErr(result.error ?? 'Wiki reanalysis failed.')
        return
      }
      await loadWiki()
      if (wikiSelectedId) {
        try {
          await openWikiPage(wikiSelectedId)
        } catch {
          setWikiSelectedId(null)
          setWikiTitle('')
          setWikiBody('')
          setWikiGlossary([])
          setWikiRelated([])
          setWikiPassages([])
          setWikiKeywordCandidates([])
          setWikiSelectedPassageIds({})
          setWikiPassageFilterDraft('')
          setWikiExtractKeywordDraft('')
          setWikiExtractStatus(null)
        }
      }
      void loadKnowledgeGraph({ keepAnalysis: true })
    } catch (e) {
      setErr(String(e))
    } finally {
      setWikiReanalyzeBusy(false)
    }
  }

  async function addWikiDocumentWithProgress(): Promise<void> {
    if (wikiUploadBusy) return
    setErr(null)
    setWikiUploadBusy(true)
    setWikiUploadProgress(null)
    setWikiUploadFormat(null)
    try {
      await window.api.kbIngestFile()
      await loadWiki()
      notifyWhenBackground({
        origin: 'wiki',
        variant: 'success',
        title: 'Wiki updated',
        message: 'A new document was added to your library.',
        action: {
          label: 'Open wiki',
          onClick: () => {
            openKnowledgeLibrary()
          }
        }
      })
    } catch (e) {
      setWikiUploadBusy(false)
      setErr(String(e))
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
        setWikiPassages([])
        setWikiKeywordCandidates([])
        setWikiSelectedPassageIds({})
        setWikiPassageFilterDraft('')
        setWikiExtractKeywordDraft('')
        setWikiExtractStatus(null)
      }
      await loadWiki()
      void loadKnowledgeGraph()
    } catch (e) {
      setErr(String(e))
    }
  }

  function onComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Tab' && !e.shiftKey && composerGhostSuffix) {
      e.preventDefault()
      setDraft((d) => d + composerGhostSuffix)
      setComposerGhostSuffix('')
      composerSuggestGenRef.current++
      return
    }
    if (e.key === 'Escape' && composerGhostSuffix) {
      e.preventDefault()
      setComposerGhostSuffix('')
      composerSuggestGenRef.current++
      return
    }
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
  const viewCopyKey: AppMainView =
    mainView === 'wiki' && wikiSubview === 'knowledgeGraph' ? 'knowledgeGraph' : mainView
  const viewCopy = APP_MAIN_VIEW_COPY[viewCopyKey] ?? APP_MAIN_VIEW_COPY.chat
  const topTitle = viewCopy.title
  const topSub = viewCopy.subtitle
  const workspaceStatusState: WorkspaceStatusLabel = runtimeStarting
    ? 'Running'
    : runtimeOn
      ? 'Ready'
      : modelPath.trim().length === 0
        ? 'Needs input'
        : 'Blocked'
  const workspaceStatusHint = runtimeStarting
    ? runtimeLoadProgress?.message ?? 'Model is starting.'
    : runtimeOn
      ? 'Model is ready. Open Knowledge to continue the presentation flow.'
      : modelPath.trim().length === 0
        ? 'Choose a model to begin the presentation flow.'
        : 'Start the model from Run or the play button, then open Knowledge.'
  const nextBestActionLabel = runtimeOn ? 'Continue workflow' : 'Start runtime'
  const nextBestActionTitle = runtimeOn
    ? 'Open Knowledge and continue the presentation workflow.'
    : 'Open Run and start your selected model.'
  const actionDockItems = useMemo(
    () => [
      { id: 'run', label: 'Run', icon: 'fa-play', onClick: () => setDrawer('runtime') },
      {
        id: 'knowledge',
        label: 'Knowledge',
        icon: 'fa-book-open',
        onClick: () => openKnowledgeLibrary()
      },
      { id: 'train', label: 'Train', icon: 'fa-flask', onClick: () => openTrainSurface() },
      ...(isBuilderAdminRole
        ? [{ id: 'readiness', label: 'Readiness', icon: 'fa-rocket', onClick: () => setMainView('releasePlanner') }]
        : [])
    ],
    [isBuilderAdminRole, openTrainSurface, openKnowledgeLibrary]
  )
  const integrationPortLive = (() => {
    const n = parseInt(integrationPortDraft.trim(), 10)
    return Number.isFinite(n) ? clampIntegrationPort(n) : INTEGRATION_PORT_DEFAULT
  })()

  const wikiSearchTrimmed = wikiSearchQuery.trim()
  const wikiHasSearch = wikiSearchTrimmed.length > 0
  const wikiSearchQLower = wikiSearchTrimmed.toLowerCase()
  const wikiUploadPercent = useMemo(() => {
    const p = wikiUploadProgress
    if (!p) return null
    if (p.kind === 'stage') return typeof p.progress === 'number' ? Math.round(p.progress * 100) : 0
    if (p.kind === 'selected') return 2
    if (p.kind === 'reading') return 12
    if (p.kind === 'chunking') return 46
    if (p.kind === 'indexing') {
      const ratio = p.total > 0 ? p.inserted / p.total : 0
      return Math.round(55 + Math.min(0.35, Math.max(0, ratio)) * 100)
    }
    if (p.kind === 'analysis') return 94
    if (p.kind === 'done') return 100
    return null
  }, [wikiUploadProgress])
  const wikiUploadStatusText = useMemo(() => {
    const p = wikiUploadProgress
    if (!p) return null
    if (p.kind === 'selected') return `Selected: ${p.filePath}`
    if (p.kind === 'stage') return p.stageLabel
    if (p.kind === 'reading') return `Reading ${p.format.toUpperCase()} file…`
    if (p.kind === 'chunking') {
      return wikiUploadFormat === 'pdf'
        ? `Preparing ${p.chunkCount} chunk${p.chunkCount === 1 ? '' : 's'} and generating passage titles…`
        : `Preparing ${p.chunkCount} chunk${p.chunkCount === 1 ? '' : 's'}…`
    }
    if (p.kind === 'indexing') return `Indexing chunks: ${p.inserted}/${p.total}`
    if (p.kind === 'analysis') {
      return `Context analysis complete: ${p.domainsDetected} domain${p.domainsDetected === 1 ? '' : 's'} detected.`
    }
    if (p.kind === 'done') return `Upload complete: ${p.title} (${p.chunkCount} chunks indexed).`
    if (p.kind === 'cancelled') return 'Upload cancelled.'
    return `Upload failed: ${p.message}`
  }, [wikiUploadProgress, wikiUploadFormat])
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
  const wikiSelectedPassageCount = useMemo(
    () => Object.values(wikiSelectedPassageIds).filter(Boolean).length,
    [wikiSelectedPassageIds]
  )
  const wikiSelectedPassages = useMemo(
    () => wikiPassages.filter((p) => wikiSelectedPassageIds[p.chunkId] !== false),
    [wikiPassages, wikiSelectedPassageIds]
  )
  const wikiPassageHeadingGroups = useMemo(() => {
    const by = new Map<string, { label: string; chunkIds: string[] }>()
    for (const p of wikiPassages) {
      const label = (p.heading?.trim() || p.title || 'Unsectioned').trim()
      if (!by.has(label)) by.set(label, { label, chunkIds: [] })
      by.get(label)!.chunkIds.push(p.chunkId)
    }
    return [...by.values()].sort((a, b) => b.chunkIds.length - a.chunkIds.length || a.label.localeCompare(b.label))
  }, [wikiPassages])
  const wikiPassageFilter = wikiPassageFilterDraft.trim().toLowerCase()
  const wikiFilteredPassages = useMemo(() => {
    if (!wikiPassageFilter) return wikiPassages
    return wikiPassages.filter((p) =>
      `${p.title} ${p.heading ?? ''} ${p.snippet}`.toLowerCase().includes(wikiPassageFilter)
    )
  }, [wikiPassages, wikiPassageFilter])
  const applyWikiPassageSelection = useCallback((chunkIds: readonly string[], selected: boolean) => {
    setWikiSelectedPassageIds((prev) => {
      const next = { ...prev }
      for (const id of chunkIds) next[id] = selected
      return next
    })
  }, [])
  const wikiSelectedPassageWordCount = useMemo(
    () => wikiSelectedPassages.reduce((acc, p) => acc + p.wordCount, 0),
    [wikiSelectedPassages]
  )

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
  const wikiDocumentDomains = useMemo(() => {
    const docs = wikiBrowseByKind.get('document') ?? []
    const by = new Map<string, WikiTopic[]>()
    for (const t of docs) {
      const key = (t.domainTitle?.trim() || 'Uncategorized').trim()
      if (!by.has(key)) by.set(key, [])
      by.get(key)!.push(t)
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }, [wikiBrowseByKind])
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
    if (!t) return null
    if (t.kind === 'document' && t.domainTitle?.trim()) return t.domainTitle.trim()
    return WIKI_KIND_LABELS[t.kind]
  }, [wikiSelectedId, wikiTopics])
  useEffect(() => {
    if (!wikiSelectedId) {
      setWikiDomainDraft('')
      return
    }
    const selected = wikiTopics.find((x) => x.id === wikiSelectedId)
    if (!selected || selected.kind !== 'document') {
      setWikiDomainDraft('')
      return
    }
    setWikiDomainDraft(selected.domainTitle?.trim() || '')
  }, [wikiSelectedId, wikiTopics])

  const backdropCtxPercent = useMemo(() => {
    const used = backdropSnap?.runtimeCtxUsed
    if (used == null || !Number.isFinite(used)) return undefined
    const n = parseInt(chatMaxTokensDraft.trim(), 10)
    const cap = clampChatMaxTokens(Number.isFinite(n) ? n : CHAT_MAX_TOKENS_DEFAULT)
    if (cap <= 0) return undefined
    return Math.min(100, Math.max(0, (used / cap) * 100))
  }, [backdropSnap?.runtimeCtxUsed, chatMaxTokensDraft])

  const llamaLoadConsoleBodyText = useMemo(() => {
    const log = runtimeLoadLog.trim()
    if (log) return log
    const startingLlama =
      runtimeStarting &&
      inferRuntimeKindForModelSelection(modelPath, localModelFilePaths, winPlatform) === 'llamacpp'
    if (!startingLlama) return ''
    const rp = runtimeLoadProgress
    const bits: string[] = []
    if (rp?.message?.trim()) bits.push(rp.message.trim())
    if (rp?.detail?.trim()) bits.push(rp.detail.trim())
    if (bits.length > 0) return bits.join('\n\n')
    return 'Starting llama-server…\n\nStatus lines will appear here (stdout, stderr, and health checks).'
  }, [runtimeLoadLog, runtimeStarting, modelPath, localModelFilePaths, winPlatform, runtimeLoadProgress])

  const trainGgufModelPaths = useMemo(
    () => localModelFilePaths.filter((p) => /\.gguf$/i.test(p)),
    [localModelFilePaths]
  )

  const setTrainReviewStatus = useCallback(async (cardId: string, status: 'pending' | 'approved' | 'rejected') => {
    await window.api.trainReviewSetStatus({ cardId, status })
    const rows = await window.api.trainReviewQueue({
      limit: 120,
      ...(trainSelectedDomainId ? { domainId: trainSelectedDomainId } : {})
    })
    setTrainReviewQueue(rows)
  }, [trainSelectedDomainId])

  const previewTrainManifest = useCallback(
    async (args: { baseModelPath: string; datasetPath: string; domainId?: string; sourceIds?: string[] }) => {
      const manifest = await window.api.trainManifestPreview({
        baseModelPath: args.baseModelPath,
        datasetPath: args.datasetPath,
        outputDir: 'pending-job-output',
        ...(args.domainId ? { domainId: args.domainId } : {}),
        ...(args.sourceIds ? { sourceIds: args.sourceIds } : {})
      })
      setTrainManifestPreviewMarkdown(manifest.previewMarkdown)
    },
    []
  )

  const validateTrainStart = useCallback(async (args: { baseModelPath: string }) => {
    return await window.api.trainValidateStart({ baseModelPath: args.baseModelPath })
  }, [])

  const createDomainProfileFromPromptDomain = useCallback(async (name: string, terms: string[]) => {
    const profile = await window.api.trainDomainProfileUpsert({
      name,
      terminology: terms.filter((t) => t.trim()).slice(0, 40),
      objective: `Refine model quality for ${name}`,
      allowedSources: ['electron', 'intellij-plugin'],
      retentionDays: 180
    })
    const list = await window.api.trainDomainProfilesList()
    setTrainDomainProfiles(list)
    setTrainSelectedDomainId(profile.id)
  }, [])

  const trainPanel = (
    <TrainMainView
      trainJobs={trainJobs}
      trainKbSources={trainKbSources}
      wikiTopics={wikiTopics}
      promptDomains={promptDomains}
      ragGroundingEnabled={llamaRagGrounding}
      trainGgufModelPaths={trainGgufModelPaths}
      comparePathsCaseInsensitive={winPlatform}
      onOpenChatForAugment={openTrainChatForAugment}
      onOpenWiki={openTrainWiki}
      onOpenPromptDomainSettings={openTrainPromptDomainSettings}
      trainKbSelected={trainKbSelected}
      setTrainKbSelected={setTrainKbSelected}
      trainBase={trainBase}
      setTrainBase={setTrainBase}
      trainDisplayName={trainDisplayName}
      setTrainDisplayName={setTrainDisplayName}
      trainDataset={trainDataset}
      setTrainDataset={setTrainDataset}
      trainStartBusy={trainStartBusy}
      setTrainStartBusy={setTrainStartBusy}
      setTrainJobs={setTrainJobs}
      domainProfiles={trainDomainProfiles}
      selectedDomainId={trainSelectedDomainId}
      setSelectedDomainId={setTrainSelectedDomainId}
      onCreateDomainProfile={createDomainProfileFromPromptDomain}
      reviewQueue={trainReviewQueue}
      onReviewSetStatus={setTrainReviewStatus}
      onManifestPreview={previewTrainManifest}
      onValidateStart={validateTrainStart}
      manifestPreviewMarkdown={trainManifestPreviewMarkdown}
      domainModelVersions={
        trainSelectedDomainId
          ? trainDomainModelVersions.filter((v) => v.domainId === trainSelectedDomainId)
          : trainDomainModelVersions
      }
      setErr={setErr}
    />
  )

  const openRoleTask = useCallback((task: (typeof roleLayoutResolved.taskNav)[number]) => {
    if (task.drawer === 'settings') {
      openSettings(task.settingsSection ?? 'general')
      return
    }
    if (task.drawer) {
      setDrawer(task.drawer)
      return
    }
    if (!task.mainView) return
    if (!advancedSurfacesVisible && isAdvancedMainView(task.mainView)) return
    if (task.mainView === 'train') {
      openTrainSurface()
      return
    }
    if (task.mainView === 'knowledgeGraph') {
      setDrawer(null)
      setMainView('wiki')
      setWikiSubview('knowledgeGraph')
      void loadWiki()
      void loadKnowledgeGraph()
      return
    }
    setDrawer(null)
    setMainView(task.mainView)
    if (task.mainView === 'wiki') {
      setWikiSubview('article')
      void loadWiki()
    }
    if (task.mainView === 'ontology') void loadOntology()
  }, [openSettings, openTrainSurface, loadKnowledgeGraph, loadOntology, loadWiki, advancedSurfacesVisible])

  return (
    <>
      <ViewToastRegion />
      <div className={shellClassName}>
      {animatedBackdropEnabled ? (
        <ModelPresenceBackdrop
          running={Boolean(runtimeStatus?.running)}
          starting={runtimeStarting}
          loadPercent={runtimeLoadProgress?.percent ?? null}
          chatBusy={chatSending}
          modelPath={runtimeStatus?.modelPath}
          tokensPerSec={backdropSnap?.runtimeTokensPerSec}
          cpuPercent={backdropSnap?.processCpuPercent}
          resourceLoadPercent={backdropSnap?.systemLoadPercent}
          bridgeStatusPositive={integrationListenEnabled}
          runtimeStatusPositive={Boolean(runtimeStatus?.running)}
          ctxPercent={backdropCtxPercent}
          personality={modelProfile.vibe}
          wakeIntensity={wakeBackdropIntensity}
        />
      ) : null}
      {presenceWakeOpen && (
        <PresenceWakeOverlay
          personality={modelProfile.vibe}
          runtimeStarting={runtimeStarting}
          setupRuntimeKind={inferredModelRuntimeKind}
          resumeRuntimeSession={resumeRuntimeOnLaunch}
          setupLiveDetail={
            runtimeStarting
              ? (runtimeLoadProgress?.message?.trim() ||
                  runtimeLoadProgress?.detail?.trim() ||
                  null)
              : null
          }
          appTitle="Local LLM Desktop"
          onIntensityChange={onPresenceWakeIntensityChange}
          onDone={onPresenceWakeDone}
        />
      )}
      <div className={shellChromeClass}>
      <aside className="nav-rail nav-rail--icons-only" aria-label="Primary navigation">
        <div className="nav-brand" title="Local LLM Desktop — private chat on your computer">
          <img
            src={`${import.meta.env.BASE_URL}app-icon.png`}
            alt=""
            width={44}
            height={44}
            decoding="async"
          />
        </div>
        <nav className="nav-main">
          {visibleRoleTasks.map((task) => {
            const active =
              (task.mainView === 'knowledgeGraph'
                ? (mainView === 'wiki' && wikiSubview === 'knowledgeGraph') || mainView === 'knowledgeGraph'
                : task.mainView === 'wiki'
                  ? mainView === 'wiki' && wikiSubview === 'article'
                  : task.mainView != null && mainView === task.mainView) ||
              (task.drawer != null && drawer === task.drawer) ||
              (task.drawer === 'settings' && drawer === 'settings')
            return (
              <button
                key={task.id}
                type="button"
                className={`nav-btn ${active ? 'active' : ''}`}
                onClick={() => openRoleTask(task)}
                title={task.hint}
                aria-label={`${task.label}: ${task.hint}`}
              >
                <i className={`fa-solid ${task.icon}`} aria-hidden />
                <span className="nav-btn-label">{task.label}</span>
              </button>
            )
          })}
          {advancedSurfacesVisible && devShellChrome && !visibleRoleTasks.some((task) => task.mainView === 'electronDev') ? (
            <button
              type="button"
              className={`nav-btn ${mainView === 'electronDev' ? 'active' : ''}`}
              onClick={() => setMainView('electronDev')}
              title="Developer hub — bridge, shortcuts, setup tour"
              aria-label="Develop: open Developer hub for bridge, shortcuts, and setup tour"
            >
              <i className="fa-solid fa-code" aria-hidden />
              <span className="nav-btn-label">Develop</span>
            </button>
          ) : null}
        </nav>
        <div className="nav-spacer" />
        <nav className="nav-tools" aria-label="Tools">
          {visibleToolDrawers.map((id: ToolDrawerId) => {
            if (id === 'hf') {
              return (
                <button
                  key={id}
                  type="button"
                  className="nav-btn"
                  onClick={() => setDrawer('hf')}
                  title="Browse and download models"
                  aria-label="Models: browse and download models"
                >
                  <IconBox />
                  <span className="nav-btn-label">Models</span>
                </button>
              )
            }
            if (id === 'runtime') {
              return (
                <button
                  key={id}
                  type="button"
                  className="nav-btn"
                  onClick={() => setDrawer('runtime')}
                  title="Run — turn your AI model on or off"
                  aria-label="Run: turn your AI model on or off"
                >
                  <IconCpu />
                  <span className="nav-btn-label">Run</span>
                </button>
              )
            }
            if (id === 'train') {
              return (
                <button
                  key={id}
                  type="button"
                  className="nav-btn"
                  onClick={() => openTrainSurface()}
                  title="Train"
                  aria-label="Train: open model tuning and training"
                >
                  <IconFlask />
                  <span className="nav-btn-label">Train</span>
                </button>
              )
            }
            return (
              <button
                key={id}
                type="button"
                className="nav-btn"
                onClick={() => setDrawer('metrics')}
                title="Metrics"
                aria-label="Metrics: open runtime and system metrics"
              >
                <IconActivity />
                <span className="nav-btn-label">Metrics</span>
              </button>
            )
          })}
          <button
            type="button"
            className="nav-btn"
            onClick={() => openSettings('general')}
            title="Settings"
            aria-label="Settings: open workspace preferences"
          >
            <IconGear />
            <span className="nav-btn-label">Settings</span>
          </button>
        </nav>
      </aside>

      <RoleWorkspaceShell className={`shell-content shell-content--pinned-${pinnedWidgetsSide}`}>
        <ContextRail
          className={[
            'pinned-widgets-aside',
            pinnedBarResizing || pinnedWidgetSplitResizing ? 'pinned-widgets-aside--resizing' : '',
            pinnedWidgetsBarCollapsed ? 'pinned-widgets-aside--collapsed' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="Pinned widgets"
          style={pinnedWidgetsAsideStyle(
            narrowSlideConv,
            pinnedWidgetsSide,
            pinnedWidgetsWidthPx,
            pinnedWidgetsHeightPx,
            pinnedWidgetsBarCollapsed
          )}
        >
          {pinnedWidgetsBarCollapsed ? (
            <div className="pinned-widgets-aside-collapsed">
              <button
                type="button"
                className="pinned-widgets-aside-expand-btn"
                title="Expand pinned widgets"
                aria-label="Expand pinned widgets"
                onClick={() => {
                  setPinnedWidgetsBarCollapsed(false)
                  void saveMetricsWidgetConfig({ pinnedWidgetsBarCollapsed: false })
                }}
              >
                <i
                  className={`fa-solid ${pinnedWidgetsExpandChevronClass(narrowSlideConv, pinnedWidgetsSide)} pinned-widgets-aside-expand-chevron`}
                  aria-hidden
                />
                <span className="visually-hidden">Expand pinned widgets</span>
              </button>
            </div>
          ) : (
            <>
          <div className="pinned-widgets-aside-header">
            <div className="pinned-widgets-aside-header-row pinned-widgets-aside-header-row--title">
              <span className="pinned-widgets-aside-title">Pinned widgets</span>
              <button
                type="button"
                className="pinned-widgets-bar-collapse-btn"
                title="Collapse widget bar"
                aria-label="Collapse widget bar"
                onClick={() => {
                  setPinnedWidgetsBarCollapsed(true)
                  void saveMetricsWidgetConfig({ pinnedWidgetsBarCollapsed: true })
                }}
              >
                <i className={`fa-solid ${pinnedWidgetsCollapseChevron(pinnedWidgetsSide)}`} aria-hidden />
              </button>
            </div>
            <div className="pinned-widgets-aside-header-row pinned-widgets-aside-header-row--controls">
              <div className="pinned-widgets-pin-group" role="group" aria-label="Pin widgets to this panel">
                <button
                  type="button"
                  className={`pinned-widgets-pin ${metricsPinned ? 'active' : ''}`}
                  title={metricsPinned ? 'Unpin metrics' : 'Pin live metrics here'}
                  aria-label={metricsPinned ? 'Unpin metrics' : 'Pin live metrics to this panel'}
                  aria-pressed={metricsPinned}
                  onClick={() => {
                    const next = !metricsPinned
                    setMetricsPinned(next)
                    void saveMetricsWidgetConfig({ metricsPinned: next })
                  }}
                >
                  <span className="pinned-widgets-pin-icon" aria-hidden>
                    <i className="fa-solid fa-chart-line" />
                  </span>
                </button>
                <button
                  type="button"
                  className={`pinned-widgets-pin ${downloadsPinned ? 'active' : ''}`}
                  title={downloadsPinned ? 'Unpin downloads' : 'Pin Hub download progress here'}
                  aria-label={downloadsPinned ? 'Unpin downloads' : 'Pin download progress to this panel'}
                  aria-pressed={downloadsPinned}
                  onClick={() => {
                    const next = !downloadsPinned
                    setDownloadsPinned(next)
                    void saveMetricsWidgetConfig({ downloadsPinned: next })
                  }}
                >
                  <span className="pinned-widgets-pin-icon" aria-hidden>
                    <i className="fa-solid fa-download" />
                  </span>
                </button>
                <button
                  type="button"
                  className={`pinned-widgets-pin ${activityPinned ? 'active' : ''}`}
                  title={
                    activityPinned ? 'Unpin activity' : 'Pin model load and reply progress here'
                  }
                  aria-label={
                    activityPinned ? 'Unpin activity' : 'Pin model load and reply progress to this panel'
                  }
                  aria-pressed={activityPinned}
                  onClick={() => {
                    const next = !activityPinned
                    setActivityPinned(next)
                    void saveMetricsWidgetConfig({ activityPinned: next })
                  }}
                >
                  <span className="pinned-widgets-pin-icon" aria-hidden>
                    <i className="fa-solid fa-bolt" />
                  </span>
                </button>
                <button
                  type="button"
                  className={`pinned-widgets-pin ${issuesPinned ? 'active' : ''}`}
                  title={issuesPinned ? 'Unpin issues' : 'Pin blocking issues and warnings here'}
                  aria-label={
                    issuesPinned ? 'Unpin issues' : 'Pin blocking issues and warnings to this panel'
                  }
                  aria-pressed={issuesPinned}
                  onClick={() => {
                    const next = !issuesPinned
                    setIssuesPinned(next)
                    void saveMetricsWidgetConfig({ issuesPinned: next })
                  }}
                >
                  <span className="pinned-widgets-pin-icon" aria-hidden>
                    <i className="fa-solid fa-triangle-exclamation" />
                  </span>
                </button>
              </div>
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
          </div>
          <div
            ref={pinnedWidgetsBodyRef}
            className={[
              'pinned-widgets-aside-body',
              !metricsPinned && !downloadsPinned && !activityPinned && !issuesPinned
                ? 'pinned-widgets-aside-body--empty'
                : '',
              [metricsPinned, downloadsPinned, activityPinned, issuesPinned].filter(Boolean).length >= 2
                ? 'pinned-widgets-aside-body--split'
                : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {!metricsPinned && !downloadsPinned && !activityPinned && !issuesPinned ? (
              <p className="pinned-widgets-aside-empty muted">
                Pin metrics, downloads, activity, or issues using the buttons above.
              </p>
            ) : null}
            {(() => {
              const items: { kind: PinnedWidgetKind; node: ReactElement }[] = []
              if (metricsPinned) {
                items.push({
                  kind: 'metrics',
                  node: (
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
                  )
                })
              }
              if (downloadsPinned) {
                items.push({
                  kind: 'downloads',
                  node: (
                    <DownloadsPinnedWidget
                      downloads={pinnedDownloadsSnapshot}
                      onUnpin={() => {
                        setDownloadsPinned(false)
                        void saveMetricsWidgetConfig({ downloadsPinned: false })
                      }}
                      onOpenRun={() => setDrawer('runtime')}
                      onCancelJob={cancelDownloadJob}
                    />
                  )
                })
              }
              if (activityPinned) {
                items.push({
                  kind: 'activity',
                  node: (
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
                  )
                })
              }
              if (issuesPinned) {
                items.push({
                  kind: 'issues',
                  node: (
                    <IssuesPinnedWidget
                      issues={appBlockingIssues}
                      onUnpin={() => {
                        setIssuesPinned(false)
                        void saveMetricsWidgetConfig({ issuesPinned: false })
                      }}
                      onOpenRun={() => setDrawer('runtime')}
                    />
                  )
                })
              }
              const inRow =
                (pinnedWidgetsSide === 'top' || pinnedWidgetsSide === 'bottom') && !narrowSlideConv
              const visibleKinds = items.map((x) => x.kind)
              return items.map((it, i) => (
                <Fragment key={it.kind}>
                  <div
                    className="pinned-widget-slot"
                    style={{
                      flex: `${pinnedWidgetWeights[it.kind]} 1 0%`,
                      minWidth: 0,
                      minHeight: 0
                    }}
                  >
                    {it.node}
                  </div>
                  {i < items.length - 1 ? (
                    <div
                      role="separator"
                      aria-orientation={inRow ? 'vertical' : 'horizontal'}
                      aria-label="Resize space between pinned widgets"
                      className={`pinned-widget-split-handle pinned-widget-split-handle--${inRow ? 'row' : 'col'}`}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const a = visibleKinds[i]!
                        const b = visibleKinds[i + 1]!
                        const w = pinnedWidgetWeightsRef.current
                        widgetSplitDragRef.current = {
                          a,
                          b,
                          startA: w[a],
                          startB: w[b],
                          startClient: inRow ? e.clientX : e.clientY,
                          visible: visibleKinds
                        }
                        setPinnedWidgetSplitResizing(true)
                      }}
                    />
                  ) : null}
                </Fragment>
              ))
            })()}
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
            </>
          )}
          </ContextRail>
        <PrimaryWork className="main-column">
        <header className="top-bar">
          <div className="top-bar-leading">
            <div className="top-bar-title">{topTitle}</div>
            {topSub ? <div className="top-bar-sub">{topSub}</div> : null}
            <div className="workspace-status-row" role="status" aria-live="polite">
              <span className={`workspace-status-chip workspace-status-chip--${workspaceStatusState.toLowerCase().replace(' ', '-')}`}>
                {workspaceStatusState}
              </span>
              <span className="workspace-status-hint">{workspaceStatusHint}</span>
            </div>
          </div>
          <div className="top-bar-runtime-wrap" aria-label="Model and runtime">
            <div className="top-bar-runtime-row">
              <select
                id="top-bar-runtime-model-select"
                className="select top-bar-runtime-model-select top-bar-runtime-model-select--unified"
                aria-label="Choose a local model (Ollama library or file on disk)"
                disabled={runtimeStarting || runtimeOn}
                value={topBarModelSelectValue}
                onChange={(e) => {
                  const v = e.target.value
                  setModelPath(v)
                  const k = inferRuntimeKindForModelSelection(v, localModelFilePaths, winPlatform)
                  setRuntimeKind(k)
                  void window.api.setConfig({ runtimeKind: k })
                }}
              >
                <option value="">
                  {ollamaChatTagsLoading
                    ? 'Loading models…'
                    : ollamaChatTagsErr
                      ? 'Could not list Ollama models'
                      : topBarOllamaModelOptions.length === 0 && topBarLlamaModelPathOptions.length === 0
                        ? 'No models found — add weights or install Ollama'
                        : 'Choose a model…'}
                </option>
                {topBarOllamaModelOptions.length > 0 ? (
                  <optgroup label="Ollama library">
                    {topBarOllamaModelOptions.map((tag) => {
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
                  </optgroup>
                ) : null}
                {topBarLlamaModelPathOptions.length > 0 ? (
                  <optgroup label="Files on this PC">
                    {topBarLlamaModelPathOptions.map((p) => {
                      const loadedMp = (runtimeOn ? runtimeStatus?.modelPath?.trim() : '') ?? ''
                      const loadedOnly =
                        Boolean(loadedMp) &&
                        localModelPathsEqual(p, loadedMp, winPlatform) &&
                        !localModelFilePaths.some((q) => localModelPathsEqual(q, loadedMp, winPlatform))
                      return (
                        <option key={p} value={p} title={p}>
                          {localModelOptionLabel(p, localDownloads, winPlatform)}
                          {loadedOnly ? ' · loaded' : ''}
                        </option>
                      )
                    })}
                  </optgroup>
                ) : null}
              </select>
              <button
                type="button"
                className={`top-bar-runtime-playstop ${runtimeOn ? 'btn-secondary' : 'btn-primary'}`}
                disabled={!runtimeOn && (runtimeStarting || !modelPath.trim())}
                title={
                  runtimeOn
                    ? 'Stop — unload model from memory'
                    : runtimeStarting
                      ? 'Starting your model…'
                      : !modelPath.trim()
                        ? 'Choose a model from the list first'
                        : 'Start — load model so you can chat'
                }
                aria-label={
                  runtimeOn
                    ? 'Stop and unload the model'
                    : runtimeStarting
                      ? 'Starting your model'
                      : !modelPath.trim()
                        ? 'Start AI (choose a model first)'
                        : 'Start AI model'
                }
                onClick={() => (runtimeOn ? void stopRuntime() : void startRuntime())}
              >
                <i className={`fa-solid ${runtimeOn ? 'fa-stop' : 'fa-play'}`} aria-hidden />
              </button>
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
            <div
              className="runtime-pill"
              title={
                runtimeOn
                  ? 'AI is on — click for details'
                  : 'AI is off — click for help starting a model'
              }
              aria-label={
                runtimeOn
                  ? 'AI model is running. Open Run for details.'
                  : 'AI model is off. Open Run to start.'
              }
              onClick={() => setDrawer('runtime')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDrawer('runtime')
                }
              }}
            >
              <span className={`runtime-pill-dot ${runtimeOn ? 'on' : ''}`} aria-hidden />
            </div>
            <UnifiedCommandSurfaceButton
              label={nextBestActionLabel}
              title={nextBestActionTitle}
              onClick={() => {
                if (runtimeOn) {
                  openKnowledgeLibrary()
                }
                else setDrawer('runtime')
              }}
            />
          </div>
        </header>
        <ActionDock items={actionDockItems} />

        {err && <div className="err-banner">{err}</div>}

        <SetupRoleTour
          open={setupTourOpen}
          initialRole={parseUiRoleOrDefault(uiRole)}
          initialColorScheme={colorScheme}
          initialShowOnStartup={setupTourOnStartup}
          runtime={{
            ollamaReachable: ollamaHost?.reachable ?? null,
            ollamaBaseUrl: ollamaHost?.baseUrl?.trim() || ollamaBaseUrlDraft.trim() || OLLAMA_BASE_DEFAULT,
            onRefreshProbe: () => void refreshRunDrawerQuick(),
            onInstallOllama: () => void runOllamaInstall(),
            installBusy: ollamaInstallBusy,
            installLog: ollamaInstallLog,
            installNote: ollamaInstallNote,
            installNoteKind: ollamaInstallNoteKind,
            llamaDetected: llamaEnv?.detected ?? false,
            llamaBinaryValid: llamaEnv?.binaryValid ?? false,
            llamaValidateError: llamaEnv?.validateError ?? null
          }}
          onComplete={onSetupTourComplete}
        />

        {welcomeModalOpen && (
          <div
            className="modal-overlay welcome-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-modal-title"
          >
            <div className="modal-box modal-box--welcome" onClick={(e) => e.stopPropagation()}>
              <h2 id="welcome-modal-title" className="modal-title">
                Welcome to Local LLM Desktop
              </h2>
              <p className="modal-text welcome-modal-lead">
                This workspace is tuned for <strong>{UI_ROLE_LABELS[parseUiRoleOrDefault(uiRole)]}</strong>. Follow this short
                checklist to get to your first role-specific outcome quickly.
              </p>
              <ol className="welcome-modal-steps">
                <li>
                  <strong>{roleLayoutResolved.tourChecklist.steps[0]}</strong>
                </li>
                <li>
                  <strong>{roleLayoutResolved.tourChecklist.steps[1]}</strong>
                </li>
                <li>
                  <strong>{roleLayoutResolved.tourChecklist.steps[2]}</strong>
                </li>
              </ol>
              <p className="welcome-modal-foot">
                {roleLayoutResolved.tourChecklist.footnote}
              </p>
              <div className="modal-actions welcome-modal-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void onWelcomeApplyAction(roleLayoutResolved.tourChecklist.primaryAction)}
                >
                  {roleLayoutResolved.tourChecklist.primaryAction.label}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void onWelcomeApplyAction(roleLayoutResolved.tourChecklist.secondaryAction)}
                >
                  {roleLayoutResolved.tourChecklist.secondaryAction.label}
                </button>
                <button type="button" className="btn-secondary" onClick={() => void markWelcomeGuideSeen()}>
                  I&apos;m ready
                </button>
              </div>
            </div>
          </div>
        )}

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

        <div className="workspace">
          {mainView === 'chat' && (
            <div
              className="chat-layout"
              data-slide-conv-edge={slideConvEdge}
              data-slide-kb-edge={slideKbEdge}
              data-kb-panel-collapsed={!narrowSlideKb && kbChatPanelCollapsed ? 'true' : undefined}
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
                      <h2>Start the presentation conversation</h2>
                      <p>
                        Press <strong>New chat</strong>, then start your model with the <strong>play button</strong> in the top
                        bar. When the green dot appears, ask your first Knowledge-focused prompt.
                      </p>
                      {!runtimeOn ? (
                        <p className="messages-empty-hint">
                          <button type="button" className="btn-secondary messages-empty-cta" onClick={() => setDrawer('runtime')}>
                            Open Run - start your model
                          </button>
                        </p>
                      ) : null}
                    </div>
                  )}
                  {convId && messages.length === 0 && (
                    <div className="messages-empty">
                      <h2>Ready for your first prompt</h2>
                      {!runtimeOn ? (
                        <>
                          <p>Start your model from the top bar (play button), then ask for a Knowledge summary.</p>
                          <p className="messages-empty-hint">
                            <button type="button" className="btn-secondary messages-empty-cta" onClick={() => setDrawer('runtime')}>
                              Open Run for setup help
                            </button>
                          </p>
                        </>
                      ) : (
                        <p>Messages save automatically. Next step: pull Knowledge snippets from the panel on the right.</p>
                      )}
                    </div>
                  )}
                  {messages.map((m, i) => {
                    const userRcKey = m.role === 'user' ? userMessageReceiptKey(convId, m) : undefined
                    const userReceipt = userRcKey ? userPromptReceipts[userRcKey] : undefined
                    const showUserRetry =
                      m.role === 'user' && userMessageShowsRetry(m, i, messages, userReceipt, chatSending)
                    return (
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
                            content={
                              m.role === 'assistant'
                                ? stripChatAssistantVisibleMarkers(m.content)
                                : m.content
                            }
                            wikiHighlightTerms={
                              m.role === 'assistant' ? wikiHighlightTerms : undefined
                            }
                            onWikiKeywordNavigate={(id, phrase) => void handleWikiTermClick(id, phrase)}
                          />
                          {m.role === 'user' ? (
                            (userRcKey != null && userReceipt != null) || showUserRetry ? (
                              <div className="msg-user-footer">
                                {userRcKey != null && userReceipt != null ? (
                                  <UserPromptReceiptMarks receipt={userReceipt} />
                                ) : null}
                                {showUserRetry ? (
                                  <button
                                    type="button"
                                    className="btn-secondary msg-prompt-retry"
                                    onClick={() => void retryUserPrompt(m, i)}
                                    disabled={chatSending}
                                    title="Remove this prompt from the thread and send it again"
                                  >
                                    Retry
                                  </button>
                                ) : null}
                                <div className="msg-token-foot msg-token-foot--user">{bubbleTokenLine(m)}</div>
                              </div>
                            ) : (
                              <div className="msg-token-foot">{bubbleTokenLine(m)}</div>
                            )
                          ) : (
                            <div className="msg-token-foot">{bubbleTokenLine(m)}</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {chatSending ? (
                    deepLearnUi ? (
                      <div className="msg-deep-learn-session">
                        <div className="msg-row assistant msg-row--deep-learn-stream">
                          <div className="msg-bubble msg-bubble--streaming msg-bubble--deep-learn">
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
                                <span className="msg-role-deep-learn-mark" aria-hidden>
                                  {' '}
                                  · deep research
                                </span>
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
                            <div className="msg-rich msg-bubble--deep-learn-status">
                              <p className="msg-bubble--deep-learn-status-line">{deepLearnUi.label}</p>
                              {!deepLearnUi.awaiting ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ marginTop: 8 }}
                                  onClick={() => void window.api.kbDeepLearnCancel({ jobId: deepLearnUi.jobId })}
                                >
                                  Cancel research
                                </button>
                              ) : null}
                            </div>
                            {activityChatTokens ? (
                              <div className="msg-token-foot">{streamingTokenFoot(activityChatTokens)}</div>
                            ) : null}
                          </div>
                        </div>
                        {deepLearnUi.awaiting ? (
                          <div className="deep-learn-continuation-wrap">
                            <div
                              className="deep-learn-continuation-blob"
                              role="region"
                              aria-label="Deep research: choose how to continue"
                            >
                              <p className="deep-learn-continuation-blob-head">Round complete — next steps</p>
                              <p className="muted deep-learn-continuation-hint">
                                Pick a suggested angle for the next model pass, continue without extra focus, or finish
                                and save the draft to your wiki.
                              </p>
                              {deepLearnUi.awaiting.paths.length > 0 ? (
                                <ul className="deep-learn-continuation-paths" aria-label="Suggested investigation paths">
                                  {deepLearnUi.awaiting.paths.map((p, idx) => (
                                    <li key={idx}>
                                      <button
                                        type="button"
                                        className="btn-secondary"
                                        title={p.prompt}
                                        onClick={() =>
                                          deepLearnResume(deepLearnUi.jobId, 'continue', p.prompt)
                                        }
                                      >
                                        {p.label}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              <div className="deep-learn-continuation-actions">
                                {deepLearnUi.awaiting.canContinueMore ? (
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => deepLearnResume(deepLearnUi.jobId, 'continue')}
                                  >
                                    Continue next round
                                  </button>
                                ) : (
                                  <span className="muted" style={{ fontSize: 12 }}>
                                    Max rounds reached for this run.
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="btn-send"
                                  onClick={() => deepLearnResume(deepLearnUi.jobId, 'finish')}
                                >
                                  Finish and save to wiki
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => void window.api.kbDeepLearnCancel({ jobId: deepLearnUi.jobId })}
                                >
                                  Cancel research
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
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
                              content={stripChatAssistantVisibleMarkers(
                                stripPartialProfileStreamTail(chatStreamBuffer)
                              )}
                              plainStreaming
                              wikiHighlightTerms={wikiHighlightTerms}
                              onWikiKeywordNavigate={(id, phrase) => void handleWikiTermClick(id, phrase)}
                            />
                          ) : (
                            <FloatingDots label="Generating reply" />
                          )}
                          {activityChatTokens ? (
                            <div className="msg-token-foot">{streamingTokenFoot(activityChatTokens)}</div>
                          ) : null}
                        </div>
                      </div>
                    )
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>

                <div className="composer-wrap">
                  {chatTurnNotice ? (
                    <div className="chat-turn-notice" role="status">
                      {chatTurnNotice}
                    </div>
                  ) : null}
                  {chatSending ? (
                    <div
                      className={`chat-generating-floater${deepLearnUi ? ' chat-generating-floater--deep-learn' : ''}`}
                      aria-live="polite"
                    >
                      <FloatingDots label={deepLearnUi ? deepLearnUi.label : 'Generating reply'} />
                      <span className="chat-generating-floater-label">
                        {deepLearnUi
                          ? deepLearnUi.label
                          : chatStreamBuffer
                            ? 'Streaming reply…'
                            : 'Waiting for reply…'}
                      </span>
                      {deepLearnUi?.awaiting ? (
                        <span className="chat-generating-floater-actions" style={{ marginLeft: 8 }}>
                          <button
                            type="button"
                            className="btn-send"
                            style={{ marginRight: 6 }}
                            onClick={() => deepLearnResume(deepLearnUi.jobId, 'finish')}
                          >
                            Finish
                          </button>
                          {deepLearnUi.awaiting.canContinueMore ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ marginRight: 6 }}
                              onClick={() => deepLearnResume(deepLearnUi.jobId, 'continue')}
                            >
                              Next round
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void window.api.kbDeepLearnCancel({ jobId: deepLearnUi.jobId })}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : deepLearnUi ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ marginLeft: 10 }}
                          onClick={() => void window.api.kbDeepLearnCancel({ jobId: deepLearnUi.jobId })}
                        >
                          Cancel
                        </button>
                      ) : null}
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
                      {ragSnippets.length > 0 && (
                        <span className="rag-badge">
                          {ragLayerEnabled ? `${ragSnippets.length} snippets active` : `${ragSnippets.length} snippets paused`}
                        </span>
                      )}
                      <label className="rag-layer-toggle" title="Disable to prompt the model without retrieved wiki snippets">
                        <input
                          type="checkbox"
                          checked={ragLayerEnabled}
                          onChange={(e) => setRagLayerEnabled(e.target.checked)}
                        />
                        <span>{ragLayerEnabled ? 'RAG on' : 'Model-only'}</span>
                      </label>
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
                  {runtimeStatus?.kind === 'ollama' && (
                    <label className="metrics-widget-check agentic-chat-toggle" style={{ margin: '0 0 8px' }}>
                      <input
                        type="checkbox"
                        checked={agenticWorkersEnabled}
                        onChange={(e) => {
                          const v = e.target.checked
                          setAgenticWorkersEnabled(v)
                          void window.api.setConfig({ agenticWorkersEnabled: v })
                        }}
                      />
                      <span>
                        <i className="fa-solid fa-diagram-project" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                        Parallel agents — planner + multi-model workers
                      </span>
                    </label>
                  )}
                  <div className="composer-box">
                    <div
                      className="composer-field"
                      aria-describedby={composerGhostSuffix ? 'composer-inline-hint' : undefined}
                    >
                      <div className="composer-mirror-backdrop" aria-hidden>
                        <div ref={composerMirrorInnerRef} className="composer-mirror-inner">
                          <span className="composer-mirror-draft">{draft}</span>
                          {composerGhostSuffix ? (
                            <span className="composer-mirror-ghost">{composerGhostSuffix}</span>
                          ) : null}
                        </div>
                      </div>
                      <textarea
                        ref={composerTextareaRef}
                        id="chat-composer-input"
                        className="composer-field-input"
                        placeholder={
                          convId
                            ? !runtimeStatus?.running
                              ? 'Start your AI with the play button above, then type here…'
                              : composerGhostSuffix
                                ? 'Message… (Tab accepts gray text, Esc dismisses)'
                                : 'Message… (Enter to send, Shift+Enter for line)'
                            : 'Pick or create a chat first'
                        }
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onScroll={(ev) => {
                          const inner = composerMirrorInnerRef.current
                          if (inner) inner.style.transform = `translateY(${-ev.currentTarget.scrollTop}px)`
                        }}
                        onKeyDown={onComposerKeyDown}
                        disabled={!convId || chatSending}
                        rows={2}
                        spellCheck
                        autoComplete="off"
                        aria-autocomplete={composerGhostSuffix ? 'inline' : undefined}
                      />
                      {composerGhostSuffix ? (
                        <span id="composer-inline-hint" className="visually-hidden">
                          Inline suggestion shown after your text. Press Tab to insert it, Escape to dismiss.
                        </span>
                      ) : null}
                      {composerSuggestBusy && !composerGhostSuffix ? (
                        <span className="composer-suggest-busy" aria-hidden>
                          …
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn-send"
                      disabled={!convId || !draft.trim() || chatSending || !runtimeStatus?.running}
                      onClick={() => void sendChat()}
                      title={
                        !runtimeStatus?.running && convId
                          ? 'Start your AI with the play button first'
                          : 'Send'
                      }
                    >
                      <IconSend />
                    </button>
                  </div>
                </div>
              </section>

              <aside
                id="kb-sidebar-panel"
                className={`kb-sidebar ${mobileKbOpen ? 'kb-sidebar--open' : ''} ${slidePanelResizing === 'kb' ? 'slide-panel--resizing' : ''}`}
                aria-label="Knowledge snippets"
                aria-hidden={!narrowSlideKb && kbChatPanelCollapsed ? true : undefined}
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
                    {narrowSlideKb ? (
                      <button
                        type="button"
                        className="kb-sidebar-close btn-ghost-sm"
                        aria-label="Close knowledge panel"
                        onClick={() => setMobileKbOpen(false)}
                      >
                        Done
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="kb-sidebar-collapse btn-ghost-sm"
                        aria-expanded={!kbChatPanelCollapsed}
                        aria-controls="kb-sidebar-panel"
                        title="Collapse knowledge panel"
                        onClick={() => {
                          setKbChatPanelCollapsed(true)
                          try {
                            localStorage.setItem(LS_KB_CHAT_COLLAPSED, '1')
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        <i className="fa-solid fa-chevron-right" aria-hidden />
                        <span className="visually-hidden">Collapse knowledge panel</span>
                      </button>
                    )}
                  </div>
                  <p>Pull wiki matches into your next message. This is step 2 in the presentation flow before training.</p>
                  <div className="kb-sidebar-graph-cta">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => void openKnowledgeGraph()}>
                      <i className="fa-solid fa-diagram-project" aria-hidden style={{ marginRight: 6, opacity: 0.75 }} />
                      Knowledge graph
                    </button>
                    <p className="muted kb-sidebar-graph-cta-hint">
                      Use Graph view to narrate evidence links before moving to Training.
                    </p>
                  </div>
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
              {!narrowSlideKb && kbChatPanelCollapsed ? (
                <button
                  type="button"
                  className="kb-sidebar-reopen"
                  aria-expanded={false}
                  aria-controls="kb-sidebar-panel"
                  aria-label="Show knowledge panel"
                  title="Show knowledge panel"
                  onClick={() => {
                    setKbChatPanelCollapsed(false)
                    try {
                      localStorage.setItem(LS_KB_CHAT_COLLAPSED, '0')
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <i className="fa-solid fa-book" aria-hidden />
                  <span className="kb-sidebar-reopen-text">Knowledge</span>
                </button>
              ) : null}
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
                      disabled={wikiUploadBusy}
                      onClick={() => void addWikiDocumentWithProgress()}
                    >
                      {wikiUploadBusy ? 'Uploading…' : '+ Add document'}
                    </button>
                  </div>
                  {wikiUploadProgress && (
                    <p className="muted" style={{ marginTop: 8 }}>
                      {typeof wikiUploadPercent === 'number'
                        ? `${Math.max(0, Math.min(100, wikiUploadPercent))}% · ${wikiUploadStatusText ?? ''}`
                        : (wikiUploadStatusText ?? '')}
                    </p>
                  )}
                </div>
                <div className="wiki-topic-list">
                  {wikiTopics.length === 0 && (
                    <p className="muted" style={{ padding: 12 }}>
                      No sources yet. Add a document.
                    </p>
                  )}
                  {wikiTopics.length > 0 && !wikiHasSearch &&
                    <div className="wiki-library-tree" role="tree" aria-label="Library navigation tree">
                      {WIKI_KIND_ORDER.map((kind) => {
                        const list = wikiBrowseByKind.get(kind) ?? []
                        if (list.length === 0) return null
                        if (kind === 'document') {
                          return (
                            <details key={kind} className="wiki-tree-kind" open>
                              <summary className="wiki-tree-kind-summary" role="treeitem" aria-level={1} aria-expanded>
                                <span className="wiki-topic-group-label wiki-topic-group-label--tree">Domains</span>
                                <span className="wiki-topic-meta">{list.length} items</span>
                              </summary>
                              <div className="wiki-topic-group-list wiki-tree-kind-children" role="group">
                                {wikiDocumentDomains.map(([domainTitle, domainTopics]) => (
                                  <details key={domainTitle} className="wiki-tree-domain" open>
                                    <summary className="wiki-tree-domain-summary" role="treeitem" aria-level={2} aria-expanded>
                                      <span>{domainTitle}</span>
                                      <span className="wiki-topic-meta">{domainTopics.length}</span>
                                    </summary>
                                    <div className="wiki-topic-group-list wiki-tree-domain-children" role="group">
                                      <WikiLibraryKindRows
                                        kind={kind}
                                        topics={domainTopics}
                                        wikiSelectedId={wikiSelectedId}
                                        onOpenPage={(id) => void openWikiPage(id)}
                                        onRequestRemove={(id, title) => setWikiDeletePending({ id, title })}
                                      />
                                    </div>
                                  </details>
                                ))}
                              </div>
                            </details>
                          )
                        }
                        return (
                          <details key={kind} className="wiki-tree-kind" open>
                            <summary className="wiki-tree-kind-summary" role="treeitem" aria-level={1} aria-expanded>
                              <span className="wiki-topic-group-label wiki-topic-group-label--tree">{WIKI_KIND_LABELS[kind]}</span>
                              <span className="wiki-topic-meta">{list.length} items</span>
                            </summary>
                            <div className="wiki-topic-group-list wiki-tree-kind-children" role="group">
                              <WikiLibraryKindRows
                                kind={kind}
                                topics={list}
                                wikiSelectedId={wikiSelectedId}
                                onOpenPage={(id) => void openWikiPage(id)}
                                onRequestRemove={(id, title) => setWikiDeletePending({ id, title })}
                              />
                            </div>
                          </details>
                        )
                      })}
                    </div>}
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
                                  <WikiLibraryKindRows
                                    kind={kind}
                                    topics={list}
                                    compact
                                    wikiSelectedId={wikiSelectedId}
                                    onOpenPage={(id) => void openWikiPage(id)}
                                    onRequestRemove={(id, title) => setWikiDeletePending({ id, title })}
                                  />
                                </div>
                              </div>
                            )
                          })
                        : (
                            <WikiLibraryKindRows
                              kind={wikiTitleMatchTopics[0]?.kind ?? 'other'}
                              topics={wikiTitleMatchTopics}
                              compact
                              wikiSelectedId={wikiSelectedId}
                              onOpenPage={(id) => void openWikiPage(id)}
                              onRequestRemove={(id, title) => setWikiDeletePending({ id, title })}
                            />
                          )}
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
              <div
                className={`wiki-main${wikiSubview === 'article' && !wikiTitle.trim() ? ' wiki-main--landing' : ''}`}
              >
                <div className="wiki-subview-switcher" role="tablist" aria-label="Wiki subviews">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wikiSubview === 'article'}
                    className={`wiki-subview-tab ${wikiSubview === 'article' ? 'wiki-subview-tab--active' : ''}`}
                    onClick={() => setWikiSubview('article')}
                  >
                    <i className="fa-solid fa-book-open" aria-hidden style={{ marginRight: 6, opacity: 0.8 }} />
                    Articles
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={wikiSubview === 'knowledgeGraph'}
                    className={`wiki-subview-tab ${wikiSubview === 'knowledgeGraph' ? 'wiki-subview-tab--active' : ''}`}
                    onClick={() => {
                      setWikiSubview('knowledgeGraph')
                      void loadKnowledgeGraph()
                    }}
                  >
                    <i className="fa-solid fa-diagram-project" aria-hidden style={{ marginRight: 6, opacity: 0.8 }} />
                    Knowledge graph
                  </button>
                </div>
                {wikiSubview === 'article' && !wikiTitle.trim() ? (
                  <div className="wiki-main-search-region">
                    <div className="wiki-main-search-bar">
                      <label htmlFor="wiki-main-search" className="wiki-main-search-label visually-hidden">
                        Search library
                      </label>
                      <input
                        ref={wikiMainSearchInputRef}
                        id="wiki-main-search"
                        type="search"
                        className="wiki-search-input wiki-search-input--main"
                        placeholder="Search titles and content…"
                        value={wikiSearchQuery}
                        onChange={(e) => setWikiSearchQuery(e.target.value)}
                        onKeyDown={onWikiSearchKeyDown}
                        autoComplete="off"
                        spellCheck={false}
                        aria-busy={wikiHasSearch && wikiSearchBusy}
                      />
                    </div>
                  </div>
                ) : null}
              {wikiSubview === 'article' ? (
              <article className={`wiki-article${wikiTitle.trim() ? '' : ' wiki-article--no-selection'}`}>
                {wikiTitle ? (
                  <>
                    {wikiCleanupBusy ? (
                      <div className="wiki-article-cleanup-banner" role="status" aria-live="polite">
                        <div
                          className="wiki-cleanup-progress-circle"
                          style={
                            {
                              '--cleanup-progress': `${Math.max(0, Math.min(100, Math.round(wikiCleanupProgress)))}%`
                            } as CSSProperties & Record<'--cleanup-progress', string>
                          }
                        >
                          <span>{Math.max(0, Math.min(100, Math.round(wikiCleanupProgress)))}%</span>
                        </div>
                        <p>{wikiCleanupLabel}</p>
                      </div>
                    ) : null}
                    <div className="wiki-article-inner">
                      <header className="wiki-article-header">
                        <div className="wiki-article-title-row">
                          <h1 className="wiki-article-title">{wikiTitle}</h1>
                          <div className="wiki-article-title-actions">
                            {wikiImportConfidence ? (
                              <span
                                className="wiki-source-kind-pill wiki-source-kind-pill--article"
                                title={
                                  wikiImportConfidence.reasons.length > 0
                                    ? `Import confidence reasons: ${wikiImportConfidence.reasons.join(', ')}`
                                    : 'Import confidence based on parser and cleanup heuristics.'
                                }
                              >
                                Import confidence {Math.round(wikiImportConfidence.score * 100)}%
                              </span>
                            ) : null}
                            {wikiSelectedKindLabel ? (
                              <span className="wiki-source-kind-pill wiki-source-kind-pill--article">
                                {wikiSelectedKindLabel}
                              </span>
                            ) : null}
                            {wikiSelectedId && wikiTopics.find((x) => x.id === wikiSelectedId)?.kind === 'document' ? (
                              <div className="wiki-domain-assign">
                                <input
                                  className="input wiki-domain-assign-input"
                                  type="text"
                                  placeholder="Domain"
                                  list="wiki-domain-options"
                                  value={wikiDomainDraft}
                                  onChange={(e) => setWikiDomainDraft(e.target.value)}
                                  disabled={wikiDomainSaving}
                                />
                                <datalist id="wiki-domain-options">
                                  {wikiDomainOptions.map((d) => (
                                    <option key={d.id} value={d.title} />
                                  ))}
                                </datalist>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => void applyWikiDomainOverride()}
                                  disabled={wikiDomainSaving || wikiDomainDraft.trim().length === 0}
                                >
                                  {wikiDomainSaving ? 'Saving…' : 'Set domain'}
                                </button>
                              </div>
                            ) : null}
                            {wikiSelectedId ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => void runWikiArticleCleanup()}
                                disabled={wikiCleanupBusy}
                              >
                                {wikiCleanupBusy ? 'Cleaning…' : 'Clean up article'}
                              </button>
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
                      </header>

                      <div className="wiki-article-main mw-parser-output">
                        <WikiArticleTocNav groups={wikiTocGroups} />
                        <ChatRichContent
                          content={wikiBody}
                          className="wiki-rich-body"
                          wikiHighlightTerms={wikiHighlightTerms}
                          onWikiKeywordNavigate={(id, phrase) => void handleWikiTermClick(id, phrase)}
                          onRichDomReady={onWikiRichDomReady}
                        />
                      </div>

                      {wikiSelectedId ? (
                        <section className="wiki-postprocess-panel wiki-article-end-section" aria-label="Manual post process">
                          <h2 className="wiki-section-heading">Manual post-process</h2>
                          <p className="wiki-related-lead">
                            Select passages, choose a keyword, and extract a focused article.
                          </p>
                          <div className="wiki-postprocess-keyword-row">
                            <input
                              className="input"
                              type="text"
                              value={wikiExtractKeywordDraft}
                              onChange={(e) => setWikiExtractKeywordDraft(e.target.value)}
                              placeholder="Keyword"
                              maxLength={120}
                            />
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => void runWikiManualExtraction()}
                              disabled={wikiExtractBusy || wikiSelectedPassageCount === 0}
                            >
                              {wikiExtractBusy ? 'Extracting…' : 'Extract article'}
                            </button>
                          </div>
                          {wikiKeywordCandidates.length > 0 ? (
                            <div className="wiki-postprocess-keywords">
                              {wikiKeywordCandidates.slice(0, 10).map((k) => (
                                <button
                                  key={k.keyword}
                                  type="button"
                                  className="wiki-postprocess-keyword-chip"
                                  onClick={() => setWikiExtractKeywordDraft(k.keyword)}
                                >
                                  <span>{k.keyword}</span>
                                  <span className="wiki-postprocess-keyword-score">
                                    {Math.max(0, Math.round(k.score * 10) / 10)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {wikiExtractStatus ? <p className="muted wiki-postprocess-status">{wikiExtractStatus}</p> : null}
                          <div className="wiki-postprocess-toolbar">
                            <span className="muted">
                              {wikiSelectedPassageCount}/{wikiPassages.length} selected · {wikiSelectedPassageWordCount} words
                            </span>
                            <div className="wiki-postprocess-toolbar-actions">
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => applyWikiPassageSelection(wikiPassages.map((p) => p.chunkId), true)}
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => applyWikiPassageSelection(wikiPassages.map((p) => p.chunkId), false)}
                              >
                                Clear
                              </button>
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                disabled={wikiFilteredPassages.length === 0}
                                onClick={() =>
                                  applyWikiPassageSelection(
                                    wikiFilteredPassages.map((p) => p.chunkId),
                                    true
                                  )
                                }
                              >
                                Select filtered
                              </button>
                            </div>
                          </div>
                          <div className="wiki-postprocess-filter-row">
                            <input
                              className="input"
                              type="search"
                              value={wikiPassageFilterDraft}
                              onChange={(e) => setWikiPassageFilterDraft(e.target.value)}
                              placeholder="Filter passages by keyword, heading, or snippet"
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <span className="muted">{wikiFilteredPassages.length} shown</span>
                          </div>
                          {wikiPassageHeadingGroups.length > 0 ? (
                            <div className="wiki-postprocess-sections">
                              {wikiPassageHeadingGroups.slice(0, 12).map((g) => {
                                const selectedInGroup = g.chunkIds.filter((id) => wikiSelectedPassageIds[id] !== false).length
                                return (
                                  <div key={g.label} className="wiki-postprocess-section-chip">
                                    <span className="wiki-postprocess-section-label">
                                      {g.label} ({selectedInGroup}/{g.chunkIds.length})
                                    </span>
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm"
                                      onClick={() => applyWikiPassageSelection(g.chunkIds, true)}
                                    >
                                      Select
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm"
                                      onClick={() => applyWikiPassageSelection(g.chunkIds, false)}
                                    >
                                      Clear
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                          {wikiSelectedPassages.length > 0 ? (
                            <div className="wiki-postprocess-preview">
                              <div className="wiki-postprocess-preview-title">Extraction preview</div>
                              {wikiSelectedPassages.slice(0, 3).map((p) => (
                                <div key={`preview-${p.chunkId}`} className="wiki-postprocess-preview-row">
                                  <strong>{p.title}</strong>
                                  <span>{p.snippet}</span>
                                </div>
                              ))}
                              {wikiSelectedPassages.length > 3 ? (
                                <div className="muted wiki-postprocess-preview-more">
                                  +{wikiSelectedPassages.length - 3} more selected passages
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="wiki-postprocess-passages">
                            {wikiFilteredPassages.map((p) => (
                              <label key={p.chunkId} className="wiki-postprocess-passage">
                                <input
                                  type="checkbox"
                                  checked={wikiSelectedPassageIds[p.chunkId] !== false}
                                  onChange={(e) =>
                                    setWikiSelectedPassageIds((prev) => ({ ...prev, [p.chunkId]: e.target.checked }))
                                  }
                                />
                                <span className="wiki-postprocess-passage-title">{p.title}</span>
                                <span className="wiki-postprocess-passage-snippet">{p.snippet}</span>
                              </label>
                            ))}
                            {wikiFilteredPassages.length === 0 ? (
                              <p className="muted wiki-postprocess-empty">No passages match this filter.</p>
                            ) : null}
                          </div>
                        </section>
                      ) : null}

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
                            Other library entries that overlap this topic by vocabulary (open to read in the wiki).
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
                              </li>
                            ))}
                          </ul>
                        </nav>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </article>
              ) : (
                <div className="main-knowledge-graph-shell wiki-knowledge-graph-subview">
                  <KnowledgeGraphView
                    hideToolbarTitle
                    data={kgPayload}
                    loading={kgLoading}
                    onRefresh={() => void loadKnowledgeGraph()}
                    graphAnalysis={{
                      busy: kgAnalysisBusy,
                      error: kgAnalysisError,
                      summary: kgAnalysisSummary,
                      markdown: kgAnalysisMarkdown,
                      ingestedId: kgAnalysisIngestedId,
                      result: kgAnalysisResult
                    }}
                    onRunGraphAnalysis={(o) => void runKnowledgeGraphAnalysis(o)}
                    onPickDestination={(d) => {
                      setMainView('wiki')
                      setWikiSubview('article')
                      void openWikiPage(d.sourceId, { sectionOrd: d.sectionOrd ?? null })
                    }}
                  />
                </div>
              )}
              </div>
            </div>
          )}

          {mainView === 'ontology' ? (
            <div className="main-knowledge-graph-shell">
              <OntologyView
                data={ontologyPayload}
                stats={ontologyStats}
                loading={ontologyLoading}
                detailLoading={ontologyDetailLoading}
                details={ontologyDetails}
                onQuery={(request) => void loadOntology(request)}
                onSelectEntity={(iri) => void loadOntologyEntityDetails(iri)}
                onRefresh={() => void loadOntology()}
                onRebuild={() => void rebuildOntologySnapshot()}
                onExport={() => void exportOntologyJsonLd()}
              />
            </div>
          ) : null}

          {mainView === 'architectureRepository' ? (
            <div className="main-arch-repo-shell">
              <ArchitectureRepositoryView
                scanRoot={architectureRepositoryScanRoot}
                onChooseScanRoot={chooseArchitectureRepositoryScanRoot}
                onClearScanRoot={clearArchitectureRepositoryScanRoot}
                integrationListenEnabled={integrationListenEnabled}
                integrationPort={integrationPortLive}
                integrationTokenConfigured={integrationTokenDraft.trim().length > 0}
                wikiTopics={wikiTopics}
                kgNodeCount={kgPayload?.nodes.length ?? 0}
                kgEdgeCount={kgPayload?.edges.length ?? 0}
                kgLoading={kgLoading}
                kgTruncated={kgPayload?.truncated ?? false}
                onRefreshKnowledgeGraph={() => void loadKnowledgeGraph()}
                hardwareSummary={hardwareSummary}
                modelsDefaultPath={paths?.modelsDefault ?? null}
                trainJobCount={trainJobs.length}
                pluginReportCount={integrationPluginReports.length}
                codebaseAnalysisSnapshots={codebaseAnalysisSnapshots}
              />
            </div>
          ) : null}

          {mainView === 'train' ? <div className="main-train-shell">{trainPanel}</div> : null}

          {mainView === 'codebaseLandscape' ? (
            <div className="main-codebase-landscape-shell">
              <CodebaseLandscapeView
                onOpenIntegrations={() => openSettings('integrations')}
                onEnrichmentComplete={() => {
                  void loadWiki()
                  void loadKnowledgeGraph({ keepAnalysis: true })
                  void loadCodebaseAnalyses()
                }}
              />
            </div>
          ) : null}

          {mainView === 'electronDev' && devShellChrome ? (
            <ElectronDevDashboard
              userDataPath={paths?.userData ?? null}
              logsPath={paths?.logs ?? null}
              onOpenTrain={openTrainSurface}
              onOpenSettingsGeneral={() => openSettings('general')}
              onBridgeListenChange={(enabled) => {
                setIntegrationListenEnabled(enabled)
                void window.api.setConfig({ integrationListenEnabled: enabled }).then((r) => {
                  if (!r.ok) {
                    setIntegrationListenEnabled(!enabled)
                    setErr(r.error ?? 'Could not update IDE bridge')
                  }
                })
              }}
              checklist={ideJourneyChecklist}
              onChecklistChange={patchIdeJourneyChecklist}
              ideJourneyAutoChecklist={ideJourneyAutoChecklist}
              onIdeJourneyAutoChecklistChange={(v) => void setIdeJourneyAutoChecklistPersist(v)}
              pluginReports={integrationPluginReports}
              idePromptMonitor={idePromptMonitor}
              runtimeRunning={runtimeOn}
              runtimeKind={runtimeStatus?.kind ?? 'none'}
              bridgeEnabled={integrationListenEnabled}
              bridgePort={integrationPortLive}
              tokenConfigured={integrationTokenDraft.trim().length > 0}
              onOpenIntegrations={() => openSettings('integrations')}
              onOpenRun={() => setDrawer('runtime')}
              onOpenModels={() => setDrawer('hf')}
              onOpenChat={() => setMainView('chat')}
              onOpenMetrics={() => setDrawer('metrics')}
              onPinActivity={() => void saveMetricsWidgetConfig({ activityPinned: true })}
              onOpenWiki={() => {
                setMainView('wiki')
                void loadWiki()
              }}
              onRefreshRuntime={refreshRuntimeStatus}
            />
          ) : null}

          {mainView === 'releasePlanner' ? (
            <div className="main-release-readiness-shell">
              <ReleaseReadinessView
                snapshot={{
                  runtimeRunning: runtimeOn,
                  modelConfigured: modelPath.trim().length > 0,
                  bridgeEnabled: integrationListenEnabled,
                  integrationTokenConfigured: integrationTokenDraft.trim().length > 0,
                  pluginReportCount: integrationPluginReports.length,
                  wikiTopicCount: wikiTopics.length,
                  knowledgeGraphNodeCount: kgPayload?.nodes.length ?? 0,
                  ontologyEntityCount: ontologyStats?.entityCount ?? 0,
                  codebaseAnalysisCount: codebaseAnalysisSnapshots.length,
                  trainJobCount: trainJobs.length,
                  metricsSampleCount: metricsBundle?.history.length ?? 0,
                  downloadsCompleteCount: localDownloads.filter((d) => d.status === 'complete').length,
                  updatesSupported: paths?.updatesSupported === true
                }}
                featureSet={releaseFeatureSet}
                onFeatureSetChange={saveReleaseFeatureSet}
              />
            </div>
          ) : null}
        </div>
        {inferredModelRuntimeKind === 'llamacpp' && (runtimeStarting || runtimeLoadLog.length > 0) ? (
          <div className="llama-load-console" aria-label="llama-server startup output">
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize llama.cpp panel height"
              className={`llama-load-console-resize${llamaConsoleResizing ? ' llama-load-console-resize--active' : ''}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                llamaConsoleResizeRef.current = {
                  startY: e.clientY,
                  startH: llamaLoadConsoleHeightPx
                }
                setLlamaConsoleResizing(true)
              }}
            />
            <button
              type="button"
              className="llama-load-console-toggle"
              aria-expanded={llamaLoadConsoleExpanded}
              onClick={() => persistLlamaConsoleExpanded(!llamaLoadConsoleExpanded)}
            >
              <i
                className={`fa-solid fa-chevron-${llamaLoadConsoleExpanded ? 'down' : 'right'}`}
                aria-hidden
              />
              <span className="llama-load-console-toggle-label">llama.cpp server output</span>
              {runtimeStarting ? (
                <span className="llama-load-console-toggle-badge">Starting…</span>
              ) : null}
            </button>
            {llamaLoadConsoleExpanded ? (
              <pre
                ref={llamaLoadConsoleRef}
                className="llama-load-console-body"
                tabIndex={0}
                style={{ height: llamaLoadConsoleHeightPx }}
              >
                {llamaLoadConsoleBodyText ||
                  'Waiting for llama-server logs…'}
              </pre>
            ) : null}
          </div>
        ) : null}
      </PrimaryWork>
      </RoleWorkspaceShell>
      </div>

      {drawer && (
        <>
          <div className="drawer-backdrop" role="presentation" onClick={() => setDrawer(null)} />
          <div className="drawer-modal-root">
            <div
              className={`drawer${drawer === 'settings' ? ' drawer--settings' : ''}${drawer === 'hf' ? ' drawer--hf-browser' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="drawer-title"
            >
            <div className="drawer-header">
              <h2 id="drawer-title">
                {drawer === 'hf' && 'Browse models'}
                {drawer === 'runtime' && 'Your AI (Run)'}
                {drawer === 'train' && !roleLayoutResolved.mainViews.includes('train') && 'Training'}
                {drawer === 'metrics' && 'Metrics'}
                {drawer === 'settings' && (
                  <>
                    <i className="fa-solid fa-gear" aria-hidden style={{ marginRight: 10, opacity: 0.88 }} />
                    Settings
                    <span className="drawer-title-sub muted" style={{ marginLeft: 10, fontWeight: 500, fontSize: 13 }}>
                      · {visibleSettingsNavItems.find((x) => x.id === settingsNav)?.label ?? ''}
                    </span>
                  </>
                )}
              </h2>
              <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="drawer-body">
              {drawer === 'hf' && (
                <HfModelBrowserDrawer
                  hfQuery={hfQuery}
                  setHfQuery={setHfQuery}
                  onHfQueryPaste={(e) => {
                    const text = e.clipboardData.getData('text/plain')
                    const repo = parseHuggingFaceRepoIdFromInput(text)
                    if (repo) {
                      e.preventDefault()
                      setHfQuery(repo)
                    }
                  }}
                  onHfSearch={() => void runHfSearch()}
                  hfSearchLoading={hfSearchLoading}
                  hfLibraryMode={hfLibraryMode}
                  backToRecommendations={backToRecommendations}
                  hfHubSubview={hfHubSubview}
                  setHfHubSubview={setHfHubSubview}
                  hfListLoading={hfListLoading}
                  hfListModelsLength={hfListModels.length}
                  hfDisplayModelsLength={hfDisplayModels.length}
                  hfHubAvailableModelsSorted={hfHubAvailableModelsSorted}
                  hfHubInstalledModelsSorted={hfHubInstalledModelsSorted}
                  hfAvailableListPage={hfAvailableListPage}
                  setHfAvailableListPage={setHfAvailableListPage}
                  hfInstalledListPage={hfInstalledListPage}
                  setHfInstalledListPage={setHfInstalledListPage}
                  browseStoreEmptyAllInstalled={
                    !hfListLoading && hfDisplayModels.length > 0 && hfHubAvailableModels.length === 0
                  }
                  selectedModel={selectedModel}
                  onActivateModel={onHubLibraryRowActivate}
                  detail={detail}
                  hardwareSummary={hardwareSummary}
                  localDownloads={localDownloads}
                  hfDownloadJobs={hfDownloadJobs}
                  quickDownloadRepo={quickDownloadRepo}
                  hfOllamaPullBusy={hfOllamaPullBusy}
                  hfOllamaPullRepoId={hfOllamaPullRepoId}
                  hfOllamaPullProgress={hfOllamaPullProgress}
                  onInstall={(repoId, primaryFilename) => void installHubModelFromBrowse(repoId, primaryFilename)}
                  onCancelJob={(jobId) => void cancelDownloadJob(jobId)}
                  onDeleteInstalled={(m) => void deleteInstalledHubModel(m)}
                  hfHubDeleteRepoBusy={hfHubDeleteRepoBusy}
                  hfFilterMinLikes={hfFilterMinLikes}
                  setHfFilterMinLikes={setHfFilterMinLikes}
                  hfFilterMinDownloads={hfFilterMinDownloads}
                  setHfFilterMinDownloads={setHfFilterMinDownloads}
                  hfFilterMaxSizeGb={hfFilterMaxSizeGb}
                  setHfFilterMaxSizeGb={setHfFilterMaxSizeGb}
                  hfSortBy={hfSortBy}
                  setHfSortBy={setHfSortBy}
                  hfSortDir={hfSortDir}
                  setHfSortDir={setHfSortDir}
                />
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
                        Mood and journal update only when you ask for a personal or subjective view (for example
                        “What is your opinion on …?”). Everyday questions stay neutral; markers are not requested then.
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
                        <button
                          type="button"
                          className="btn-ghost-sm"
                          onClick={() => void resetInteractionBaseline()}
                          title="Profile, domain extras, sampling defaults; see message if a finetune is loaded"
                        >
                          Reset to baseline…
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
                    <h3 className="runtime-load-card-title">Get your AI running</h3>
                    <p className="muted runtime-load-card-lead">
                      <strong>Easiest:</strong> leave the top bar on <strong>Ollama</strong>, install Ollama if needed
                      below, pick a model, then press <strong>play</strong> in the top bar. <strong>Advanced:</strong> switch
                      to files on your PC if you use downloaded{' '}
                      <code className="inline-code">.gguf</code> or a full Hugging Face folder with{' '}
                      <code className="inline-code">.safetensors</code> (the app ships{' '}
                      <code className="inline-code">convert_hf_to_gguf.py</code> and converts once you install Python
                      with PyTorch and Transformers — see Settings → AI engine).
                    </p>
                    <div className="runtime-ollama-probe" role="status">
                      <div className="runtime-ollama-probe-row">
                        <span className="runtime-ollama-probe-label">Ollama reachable</span>
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
                    {ollamaChatTags.length > 0 && !ollamaChatTagsLoading && !ollamaChatTagsErr ? (
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
                  {inferredModelRuntimeKind === 'llamacpp' && llamaEnv && !llamaEnv.detected && (
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
                  {inferredModelRuntimeKind === 'llamacpp' && llamaEnv?.detected && !llamaEnv.binaryValid && llamaEnv.validateError ? (
                    <div className="runtime-llama-setup-banner runtime-llama-setup-banner--error" role="alert">
                      <p className="runtime-llama-setup-banner-title">llama-server binary is not usable</p>
                      <p className="muted" style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>
                        {llamaEnv.validateError}
                      </p>
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        Choose the <strong>llama-server</strong> executable from a llama.cpp release (not llama-cli). On
                        Windows, use the variant that matches your GPU (CUDA/ Vulkan/ CPU) and keep DLLs next to the .exe.
                      </p>
                    </div>
                  ) : null}
                  {inferredModelRuntimeKind === 'llamacpp' && llamaEnv?.detected && !llamaEnv.configuredValid && llamaEnv.resolvedPath ? (
                    <p className="muted runtime-llama-path-note">
                      No saved binary path on disk; using{' '}
                      <code className="inline-code">{llamaEnv.resolvedPath}</code> from PATH. Save by starting a model from
                      the top bar or paste a binary path below.
                    </p>
                  ) : null}
                    {inferredModelRuntimeKind === 'llamacpp' ? (
                      <p className="muted runtime-field-hint-inline">
                        Weight files in folder:{' '}
                        <span className="runtime-local-models-dir">{paths?.modelsDefault ?? '—'}</span>
                      </p>
                    ) : null}
                    {inferredModelRuntimeKind === 'llamacpp' ? (
                      <>
                        <label className="runtime-field-label" htmlFor="runtime-llama-bin-input">
                          llama-server binary
                        </label>
                        {llamaEnv?.detected && llamaEnv.configuredValid && llamaEnv.binaryValid ? (
                          <p className="muted runtime-llama-ok">Saved path looks valid (llama-server check passed).</p>
                        ) : null}
                        {llamaEnv?.detected && llamaEnv.configuredValid && !llamaEnv.binaryValid && llamaEnv.validateError ? (
                          <p className="runtime-llama-validate-warn" role="alert">
                            {llamaEnv.validateError}
                          </p>
                        ) : null}
                        <input
                          id="runtime-llama-bin-input"
                          className="input"
                          value={llamaBin}
                          disabled={runtimeStarting}
                          onChange={(e) => setLlamaBin(e.target.value)}
                          placeholder="Path to llama-server"
                        />
                        <p className="muted" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.45 }}>
                          <strong>Safetensors:</strong> put the whole model repo in your models folder (with{' '}
                          <code className="inline-code">config.json</code> next to the weights), pick any{' '}
                          <code className="inline-code">.safetensors</code> file, then Start. The first run converts to GGUF
                          (cached under app data). Optional: set the convert script and Python paths in Settings → AI
                          engine.
                        </p>
                      </>
                    ) : null}
                    {inferredModelRuntimeKind === 'llamacpp' && localModelFilePaths.length > 0 ? (
                      <div className="runtime-model-purge" role="group" aria-label="Delete local GGUF files">
                        <div className="runtime-model-purge-title">Delete local weight files</div>
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
                        <button type="button" className="btn-ghost-sm" onClick={() => openSettings('data')}>
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
                                  <span className="runtime-download-row-title">
                                    {r.chat_display_name?.trim() || fileNameFromPath(r.local_path)}
                                  </span>
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

              {drawer === 'train' && !roleLayoutResolved.mainViews.includes('train') ? trainPanel : null}

              {drawer === 'metrics' && (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    While this panel is open, a snapshot is saved and charts refresh every{' '}
                    <strong>{formatRefreshLabel(metricsRefreshMs)}</strong> (same interval as pinned widgets). Configure
                    which widgets are pinned, panel side, and refresh interval under{' '}
                    <strong>Settings → Widgets &amp; metrics</strong>.
                  </p>
                  <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" className="btn-secondary" onClick={() => openSettings('widgets')}>
                      Open widget settings…
                    </button>
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
                <div className="settings-view">
                  <nav className="settings-view-nav" aria-label="Settings sections">
                    {!roleLayoutResolved.advancedSettingsByDefault ? (
                      <button
                        type="button"
                        className={`settings-view-nav-btn${settingsAdvancedVisible ? ' settings-view-nav-btn--active' : ''}`}
                        onClick={() => setSettingsShowAdvanced((v) => !v)}
                      >
                        <i className="fa-solid fa-layer-group" aria-hidden />
                        <span>{settingsAdvancedVisible ? 'Hide advanced' : 'Show advanced'}</span>
                      </button>
                    ) : null}
                    {visibleSettingsNavItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`settings-view-nav-btn${settingsNav === item.id ? ' settings-view-nav-btn--active' : ''}`}
                        onClick={() => setSettingsNav(item.id)}
                      >
                        <i className={`fa-solid ${item.icon}`} aria-hidden />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </nav>
                  <div className="settings-view-panels">
                    {settingsNav === 'general' && (
                      <section className="settings-group" aria-labelledby="settings-grp-general">
                        <h2 id="settings-grp-general" className="settings-group-heading">
                          <i className="fa-solid fa-sliders" aria-hidden />
                          General
                        </h2>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-box-open" aria-hidden />
                            Application
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Version <strong>{paths?.appVersion ?? '—'}</strong>
                            {paths?.updatesSupported ? '' : ' · In-app updates apply to release installs only.'}
                          </p>
                          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={!paths?.updatesSupported || appUpdateBusy}
                              onClick={() => void runCheckForUpdates()}
                            >
                              {appUpdateBusy ? 'Checking…' : 'Check for updates'}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => void window.api.openExternalUrl('https://github.com/localllm/local-llm-desktop/releases')}
                            >
                              Release notes
                            </button>
                          </div>
                          {appUpdateLine ? (
                            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                              {appUpdateLine}
                            </p>
                          ) : null}
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title" id="settings-workspace-role-heading">
                            <i className="fa-solid fa-user-tag" aria-hidden />
                            Workspace profile
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Simplifies the sidebar to match how you work. Builder/Admin exposes all views and settings;
                            Develop is also available in unpackaged builds (or when LOCAL_LLM_FORCE_DEV_UI=1).
                          </p>
                          <div
                            className="settings-role-grid"
                            role="radiogroup"
                            aria-labelledby="settings-workspace-role-heading"
                          >
                            {UI_ROLE_IDS.map((id) => (
                              <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={uiRole === id}
                                className={`settings-role-option${uiRole === id ? ' settings-role-option--selected' : ''}`}
                                onClick={() => {
                                  setUiRole(id)
                                  const nextDensity = roleLayout(id).defaultDensity
                                  setWorkspaceDensity(nextDensity)
                                  void window.api.setConfig({ uiRole: id, workspaceDensity: nextDensity }).then((r) => {
                                    if (!r.ok) setErr(r.error ?? 'Could not save role')
                                  })
                                }}
                              >
                                <span className="settings-role-option-title">
                                  {uiRole === id ? (
                                    <i className="fa-solid fa-circle-check settings-role-option-title-check" aria-hidden="true" />
                                  ) : (
                                    <span className="settings-role-option-title-radio" aria-hidden="true" />
                                  )}
                                  {UI_ROLE_LABELS[id]}
                                </span>
                                <span className="settings-role-option-blurb muted">{UI_ROLE_CARD_BLURBS[id]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-person-chalkboard" aria-hidden />
                            Presentation focus
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Keep the app centered on setup, knowledge, training, and release-readiness during presentations.
                          </p>
                          <label className="metrics-widget-check">
                            <input
                              type="checkbox"
                              checked={presentationModeEnabled}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setPresentationModeEnabled(checked)
                                void window.api.setConfig({ presentationModeEnabled: checked }).then((r) => {
                                  if (!r.ok) setErr(r.error ?? 'Could not save presentation mode')
                                })
                              }}
                            />
                            <span>Enable presentation mode (focused navigation)</span>
                          </label>
                          <label className="metrics-widget-check" style={{ marginTop: 8 }}>
                            <input
                              type="checkbox"
                              checked={showAdvancedSurfaces}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setShowAdvancedSurfaces(checked)
                                void window.api.setConfig({ showAdvancedSurfaces: checked }).then((r) => {
                                  if (!r.ok) setErr(r.error ?? 'Could not save advanced surface visibility')
                                })
                              }}
                            />
                            <span>Show advanced surfaces (Developer, Architecture, Ontology internals)</span>
                          </label>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-hand-sparkles" aria-hidden />
                            Presentation checklist and first-time tips
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Setup guidance is role-specific and can be opened whenever needed.
                          </p>
                          <label className="setup-tour-startup-toggle settings-startup-tour-toggle">
                            <input
                              type="checkbox"
                              checked={setupTourOnStartup}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setSetupTourOnStartup(checked)
                                void window.api.setConfig({ setupTourOnStartup: checked }).then((r) => {
                                  if (!r.ok) setErr(r.error ?? 'Could not save startup tour preference')
                                })
                              }}
                            />
                            <span>Show setup tour on startup when onboarding updates are available</span>
                          </label>
                          <button type="button" className="btn-secondary" onClick={() => void showWelcomeGuideAgain()}>
                            Show first-run checklist…
                          </button>
                          <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => void rerunSetupTour()}>
                            Run setup tour again…
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ marginLeft: 8 }}
                            onClick={() => {
                              openSettings('integrations')
                            }}
                          >
                            Open integrations…
                          </button>
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
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-arrows-left-right" aria-hidden />
                            Slide panel widths
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Applied when panels slide over the chat. You can still drag resize handles in the layout.
                          </p>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Chats list width (px, min {SLIDE_CONV_MIN})
                            </span>
                            <input
                              type="number"
                              className="input"
                              style={{ width: '100%', maxWidth: 200 }}
                              min={SLIDE_CONV_MIN}
                              value={slideConvWidthPx}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10)
                                if (!Number.isFinite(n)) return
                                const v = clampSlideConv(n)
                                setSlideConvWidthPx(v)
                                try {
                                  localStorage.setItem(LS_SLIDE_CONV_W, String(v))
                                } catch {
                                  /* ignore */
                                }
                              }}
                            />
                          </label>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Knowledge panel width (px, min {SLIDE_KB_MIN})
                            </span>
                            <input
                              type="number"
                              className="input"
                              style={{ width: '100%', maxWidth: 200 }}
                              min={SLIDE_KB_MIN}
                              value={slideKbWidthPx}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10)
                                if (!Number.isFinite(n)) return
                                const v = clampSlideKb(n)
                                setSlideKbWidthPx(v)
                                try {
                                  localStorage.setItem(LS_SLIDE_KB_W, String(v))
                                } catch {
                                  /* ignore */
                                }
                              }}
                            />
                          </label>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-book" aria-hidden />
                            Knowledge column
                          </h3>
                          <label className="metrics-widget-check">
                            <input
                              type="checkbox"
                              checked={!kbChatPanelCollapsed}
                              onChange={(e) => {
                                const show = e.target.checked
                                setKbChatPanelCollapsed(!show)
                                try {
                                  localStorage.setItem(LS_KB_CHAT_COLLAPSED, show ? '0' : '1')
                                } catch {
                                  /* ignore */
                                }
                              }}
                            />
                            <span>Show wiki / knowledge column beside chat (wide layouts)</span>
                          </label>
                          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                            When off, the sidebar stays collapsed until you expand it from the chat view.
                          </p>
                        </div>
                        <div className="drawer-section">
                          <button type="button" className="btn-secondary" onClick={() => setDrawer('runtime')}>
                            Open Run (runtime setup)…
                          </button>
                          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                            Start or stop your model, install Ollama, and see downloads.
                          </p>
                        </div>
                      </section>
                    )}

                    {settingsNav === 'appearance' && (
                      <section className="settings-group" aria-labelledby="settings-grp-look">
                        <h2 id="settings-grp-look" className="settings-group-heading">
                          <i className="fa-solid fa-palette" aria-hidden />
                          Appearance
                        </h2>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-layer-group" aria-hidden />
                            Workspace density
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Controls visual density for role workspaces: Focused removes noise, Standard balances clarity,
                            Expanded keeps extra context visible.
                          </p>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>Density mode</span>
                            <select
                              className="select"
                              style={{ width: '100%', maxWidth: 320 }}
                              value={workspaceDensity}
                              onChange={(e) => {
                                const next = parseWorkspaceDensity(e.target.value)
                                setWorkspaceDensity(next)
                                void window.api.setConfig({ workspaceDensity: next }).then((r) => {
                                  if (!r.ok) setErr(r.error ?? 'Could not save workspace density')
                                })
                              }}
                            >
                              {WORKSPACE_DENSITY_IDS.map((id) => (
                                <option key={id} value={id}>
                                  {id.charAt(0).toUpperCase() + id.slice(1)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                            <input
                              type="checkbox"
                              checked={animatedBackdropEnabled}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setAnimatedBackdropEnabled(checked)
                                void window.api.setConfig({ animatedBackdropEnabled: checked }).then((r) => {
                                  if (!r.ok) setErr(r.error ?? 'Could not save animated background preference')
                                })
                              }}
                            />
                            <span>Enable animated background sphere</span>
                          </label>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-swatchbook" aria-hidden />
                            Color scheme
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Each option is a coordinated palette (backgrounds, text, accents, chat bubbles, and status colors).
                            Light themes use a bright base; CVD themes avoid confusing red–green or blue–yellow pairs for key states.
                          </p>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              <i className="fa-solid fa-droplet" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                              Theme
                            </span>
                            <select
                              className="select"
                              style={{ width: '100%', maxWidth: 420 }}
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
                            <i className="fa-solid fa-text-height" aria-hidden />
                            Text &amp; reading comfort
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Adjusts the base text size (via the page root), line spacing, and a few key controls so chat,
                            wiki, and forms stay in proportion. Use <strong>Compact</strong> if you prefer the older,
                            denser layout.
                          </p>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              <i className="fa-solid fa-book-open" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                              Typography preset
                            </span>
                            <select
                              className="select"
                              style={{ width: '100%', maxWidth: 420 }}
                              value={typographyComfort}
                              onChange={(e) => void saveTypographyComfort(parseTypographyComfort(e.target.value))}
                            >
                              {TYPOGRAPHY_COMFORT_IDS.map((id) => (
                                <option key={id} value={id}>
                                  {TYPOGRAPHY_COMFORT_LABELS[id]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-font" aria-hidden />
                            Font &amp; spacing
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            These settings apply on top of the preset above. Line spacing scales body text, chat
                            bubbles, and the composer. Letter and word spacing are added to the whole app (body).
                          </p>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              <i className="fa-solid fa-font" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                              Application font
                            </span>
                            <select
                              className="select"
                              style={{ width: '100%', maxWidth: 420 }}
                              value={typographyFontFamily}
                              onChange={(e) => {
                                const f = parseTypographyFontFamily(e.target.value)
                                typographyFontLiveRef.current = f
                                setTypographyFontFamily(f)
                                void window.api.setConfig({
                                  typographyFontFamily: f,
                                  typographyLineHeightFactor: typographyLineHeightLiveRef.current,
                                  typographyLetterSpacingExtraEm: typographyLetterExtraLiveRef.current,
                                  typographyWordSpacingEm: typographyWordSpacingLiveRef.current
                                })
                              }}
                            >
                              {TYPOGRAPHY_FONT_FAMILY_IDS.map((id) => (
                                <option key={id} value={id}>
                                  {TYPOGRAPHY_FONT_FAMILY_LABELS[id]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div style={{ marginTop: 18 }}>
                            <label className="muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, fontSize: 12 }}>
                              <span>Line spacing multiplier</span>
                              <span aria-live="polite">{Math.round(typographyLineHeightFactor * 100)}%</span>
                            </label>
                            <input
                              id="settings-typo-line-height"
                              type="range"
                              className="settings-typography-range"
                              min={Math.round(TYPOGRAPHY_LINE_HEIGHT_FACTOR_MIN * 100)}
                              max={Math.round(TYPOGRAPHY_LINE_HEIGHT_FACTOR_MAX * 100)}
                              step={1}
                              value={Math.round(typographyLineHeightFactor * 100)}
                              onInput={(e) => {
                                const v = clampTypographyLineHeightFactor(parseInt(e.currentTarget.value, 10) / 100)
                                typographyLineHeightLiveRef.current = v
                                setTypographyLineHeightFactor(v)
                              }}
                              onPointerUp={persistTypographyTuneConfig}
                              aria-valuemin={Math.round(TYPOGRAPHY_LINE_HEIGHT_FACTOR_MIN * 100)}
                              aria-valuemax={Math.round(TYPOGRAPHY_LINE_HEIGHT_FACTOR_MAX * 100)}
                              aria-valuenow={Math.round(typographyLineHeightFactor * 100)}
                              aria-label="Line spacing multiplier percent"
                            />
                          </div>
                          <div style={{ marginTop: 16 }}>
                            <label className="muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, fontSize: 12 }}>
                              <span>Extra letter spacing</span>
                              <span aria-live="polite">{typographyLetterSpacingExtraEm.toFixed(3)}em</span>
                            </label>
                            <input
                              id="settings-typo-letter"
                              type="range"
                              className="settings-typography-range"
                              min={Math.round(TYPOGRAPHY_LETTER_EXTRA_EM_MIN * 1000)}
                              max={Math.round(TYPOGRAPHY_LETTER_EXTRA_EM_MAX * 1000)}
                              step={1}
                              value={Math.round(typographyLetterSpacingExtraEm * 1000)}
                              onInput={(e) => {
                                const v = clampTypographyLetterSpacingExtraEm(parseInt(e.currentTarget.value, 10) / 1000)
                                typographyLetterExtraLiveRef.current = v
                                setTypographyLetterSpacingExtraEm(v)
                              }}
                              onPointerUp={persistTypographyTuneConfig}
                              aria-valuemin={Math.round(TYPOGRAPHY_LETTER_EXTRA_EM_MIN * 1000)}
                              aria-valuemax={Math.round(TYPOGRAPHY_LETTER_EXTRA_EM_MAX * 1000)}
                              aria-valuenow={Math.round(typographyLetterSpacingExtraEm * 1000)}
                              aria-label="Extra letter spacing in thousandths of em"
                            />
                          </div>
                          <div style={{ marginTop: 16 }}>
                            <label className="muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6, fontSize: 12 }}>
                              <span>Word spacing</span>
                              <span aria-live="polite">
                                {typographyWordSpacingEm === 0 ? 'normal' : `${typographyWordSpacingEm.toFixed(3)}em`}
                              </span>
                            </label>
                            <input
                              id="settings-typo-word"
                              type="range"
                              className="settings-typography-range"
                              min={0}
                              max={Math.round(TYPOGRAPHY_WORD_SPACING_EM_MAX * 1000)}
                              step={1}
                              value={Math.round(typographyWordSpacingEm * 1000)}
                              onInput={(e) => {
                                const v = clampTypographyWordSpacingEm(parseInt(e.currentTarget.value, 10) / 1000)
                                typographyWordSpacingLiveRef.current = v
                                setTypographyWordSpacingEm(v)
                              }}
                              onPointerUp={persistTypographyTuneConfig}
                              aria-valuemin={0}
                              aria-valuemax={Math.round(TYPOGRAPHY_WORD_SPACING_EM_MAX * 1000)}
                              aria-valuenow={Math.round(typographyWordSpacingEm * 1000)}
                              aria-label="Word spacing in thousandths of em"
                            />
                          </div>
                          <div style={{ marginTop: 14 }}>
                            <button
                              type="button"
                              className="btn-secondary btn-ghost-sm"
                              onClick={() => {
                                typographyFontLiveRef.current = DEFAULT_TYPOGRAPHY_FONT_FAMILY
                                typographyLineHeightLiveRef.current = DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR
                                typographyLetterExtraLiveRef.current = DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM
                                typographyWordSpacingLiveRef.current = DEFAULT_TYPOGRAPHY_WORD_SPACING_EM
                                setTypographyFontFamily(DEFAULT_TYPOGRAPHY_FONT_FAMILY)
                                setTypographyLineHeightFactor(DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR)
                                setTypographyLetterSpacingExtraEm(DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM)
                                setTypographyWordSpacingEm(DEFAULT_TYPOGRAPHY_WORD_SPACING_EM)
                                void window.api.setConfig({
                                  typographyFontFamily: DEFAULT_TYPOGRAPHY_FONT_FAMILY,
                                  typographyLineHeightFactor: DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR,
                                  typographyLetterSpacingExtraEm: DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM,
                                  typographyWordSpacingEm: DEFAULT_TYPOGRAPHY_WORD_SPACING_EM
                                })
                              }}
                            >
                              Reset font &amp; spacing to defaults
                            </button>
                          </div>
                        </div>
                      </section>
                    )}

                    {settingsNav === 'chat' && (
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
                        Default max new tokens per reply for Ollama (<code className="inline-code">num_predict</code>) and for llama.cpp when you have not set a separate cap under{' '}
                        <strong>Settings → Data → llama.cpp server</strong>. llama-server also uses this (or the llama-specific value) as <code className="inline-code">-n</code> when started;
                        restart Run after changing if another client on the same port omits <code className="inline-code">max_tokens</code>.
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
                      {(() => {
                        const n = parseInt(chatMaxTokensDraft.trim(), 10)
                        return Number.isFinite(n) && n > 0 && n < 1024 ? (
                          <p className="muted" style={{ marginTop: 8, marginBottom: 0, maxWidth: 520 }}>
                            Values under ~1024 tokens often cut answers short. Raise this for normal chat unless you
                            need very short replies.
                          </p>
                        ) : null
                      })()}
                      <label style={{ display: 'block', marginTop: 16 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-clock-rotate-left" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Chat history messages (sent to the model)
                        </span>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', maxWidth: 200 }}
                          min={2}
                          max={500}
                          step={1}
                          value={chatHistoryMaxMessagesDraft}
                          onChange={(e) => setChatHistoryMaxMessagesDraft(e.target.value)}
                          onBlur={() => {
                            const n = parseInt(chatHistoryMaxMessagesDraft.trim(), 10)
                            const v = chatHistoryMaxMessagesFromConfig(Number.isFinite(n) ? n : undefined)
                            setChatHistoryMaxMessagesDraft(String(v))
                            void window.api.setConfig({ chatHistoryMaxMessages: v })
                          }}
                        />
                      </label>
                      <p className="muted" style={{ marginTop: 6, marginBottom: 0, fontSize: 12, maxWidth: 560 }}>
                        Only the most recent user+assistant bubbles are included in each request (older turns are
                        dropped). Lower this if llama.cpp runs out of context with long threads or large RAG inserts.
                      </p>
                      <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12, maxWidth: 560 }}>
                        Mood and journal updates use the profile system prompt only when you ask for a personal stance
                        (e.g. “What is your opinion on …?”). Ordinary questions use a neutral assistant prompt.
                      </p>
                      <label className="metrics-widget-check" style={{ marginTop: 12 }}>
                        <input
                          type="checkbox"
                          checked={chatDomainEnhancement}
                          onChange={(e) => {
                            const v = e.target.checked
                            setChatDomainEnhancement(v)
                            void window.api.setConfig({ chatDomainEnhancement: v })
                          }}
                        />
                        <span>
                          Domain-enhanced prompts — when a user message matches a{' '}
                          <strong>Chat prompt domain</strong> that has optional context (configure below), append that
                          text to the system message (bounded to {MAX_PROMPT_DOMAIN_SUFFIX_CHARS} characters per turn).
                        </span>
                      </label>
                      <label className="metrics-widget-check" style={{ marginTop: 12 }}>
                        <input
                          type="checkbox"
                          checked={ontologyEnabled}
                          onChange={(e) => {
                            const v = e.target.checked
                            setOntologyEnabled(v)
                            void window.api.setConfig({ ontologyEnabled: v })
                          }}
                        />
                        <span>
                          Runtime ontology context - continuously build and inject relevant domain facts from previous runtime interactions.
                        </span>
                      </label>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                        <label style={{ display: 'block' }}>
                          <span className="muted" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            Ontology triples per prompt
                          </span>
                          <input
                            type="number"
                            className="input"
                            style={{ width: 210 }}
                            min={5}
                            max={200}
                            value={ontologyMaxTriplesDraft}
                            onChange={(e) => setOntologyMaxTriplesDraft(e.target.value)}
                            onBlur={() => {
                              const n = parseInt(ontologyMaxTriplesDraft.trim(), 10)
                              const v = Math.min(200, Math.max(5, Number.isFinite(n) ? n : 40))
                              setOntologyMaxTriplesDraft(String(v))
                              void window.api.setConfig({ ontologyMaxTriples: v })
                            }}
                          />
                        </label>
                        <label style={{ display: 'block' }}>
                          <span className="muted" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                            Ontology context token budget
                          </span>
                          <input
                            type="number"
                            className="input"
                            style={{ width: 210 }}
                            min={64}
                            max={3000}
                            value={ontologyContextTokensDraft}
                            onChange={(e) => setOntologyContextTokensDraft(e.target.value)}
                            onBlur={() => {
                              const n = parseInt(ontologyContextTokensDraft.trim(), 10)
                              const v = Math.min(3000, Math.max(64, Number.isFinite(n) ? n : 512))
                              setOntologyContextTokensDraft(String(v))
                              void window.api.setConfig({ ontologyContextTokens: v })
                            }}
                          />
                        </label>
                      </div>
                      <div className="prompt-domains-panel" aria-label="Chat prompt domains">
                        <h4 className="prompt-domains-panel-title">Chat prompt domains</h4>
                        <p className="prompt-domains-panel-hint muted">
                          Topic clusters inferred from your user prompts (keyword overlap). Optional per-domain system
                          context applies only when “Domain-enhanced prompts” above is enabled. Send a chat message to
                          refresh this list.
                        </p>
                        {promptDomains.length === 0 ? (
                          <p className="prompt-domains-panel-empty muted">No domains yet.</p>
                        ) : (
                          <ul className="prompt-domains-panel-list">
                            {promptDomains.map((d) => (
                              <li key={d.id}>
                                <span className="prompt-domains-panel-name">{d.title}</span>
                                <span className="muted"> · {d.messageCount} prompts</span>
                                {d.keywords.length > 0 ? (
                                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                                    {d.keywords.slice(0, 8).join(', ')}
                                    {d.keywords.length > 8 ? '…' : ''}
                                  </div>
                                ) : null}
                                <label className="muted" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                                  Optional system context when this domain matches (max {MAX_PROMPT_DOMAIN_SUFFIX_CHARS}{' '}
                                  chars; used only when “Domain-enhanced prompts” is on)
                                  <textarea
                                    className="input"
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      maxWidth: 520,
                                      minHeight: 56,
                                      marginTop: 6,
                                      fontSize: 12
                                    }}
                                    value={promptDomainSuffixDrafts[d.id] ?? d.systemSuffix}
                                    onChange={(e) =>
                                      setPromptDomainSuffixDrafts((prev) => ({
                                        ...prev,
                                        [d.id]: e.target.value.slice(0, MAX_PROMPT_DOMAIN_SUFFIX_CHARS)
                                      }))
                                    }
                                    spellCheck={false}
                                    rows={3}
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn-ghost-sm"
                                  style={{ marginTop: 6 }}
                                  onClick={() =>
                                    void window.api
                                      .promptDomainSetSuffix({
                                        domainId: d.id,
                                        systemSuffix: (promptDomainSuffixDrafts[d.id] ?? d.systemSuffix).trim()
                                      })
                                      .then(() => void refreshPromptDomains())
                                  }
                                >
                                  Save domain context
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
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
                        Runs a short second pass on the local model to distill concise reference notes into the knowledge
                        base. Notes are linked to the conversation so they can be removed with{' '}
                        <strong>Save chat to knowledge base</strong>–style cleanup when you delete the chat. Turn off to
                        save time and tokens.
                      </p>
                      <label className="metrics-widget-check" style={{ marginTop: 14 }}>
                        <input
                          type="checkbox"
                          checked={chatResponsePostProcess}
                          onChange={(e) => {
                            const v = e.target.checked
                            setChatResponsePostProcess(v)
                            void window.api.setConfig({ chatResponsePostProcess: v })
                          }}
                        />
                        <span>
                          <i className="fa-solid fa-align-left" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                          Tidy assistant replies (spacing, sections, quick outline)
                        </span>
                      </label>
                      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                        After each reply, the app normalizes Markdown: trims stray spaces, adds breathing room around
                        headings and horizontal rules, collapses huge blank gaps, and when there are several{' '}
                        <code>##</code> sections it prepends a short <strong>In this reply</strong> outline so you can
                        scan faster. Runs locally — no extra model call.
                      </p>
                      <label className="metrics-widget-check" style={{ marginTop: 16 }}>
                        <input
                          type="checkbox"
                          checked={deepLearnEnabled}
                          onChange={(e) => {
                            const v = e.target.checked
                            setDeepLearnEnabled(v)
                            void window.api.setConfig({ deepLearnEnabled: v })
                          }}
                        />
                        <span>
                          <i className="fa-solid fa-layer-group" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                          Deep research from chat (“learn everything about …”)
                        </span>
                      </label>
                      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                        When your message matches that phrase, the app asks before running several local model passes and saving one wiki article (and
                        updating the knowledge graph). If you paste http(s) links, you confirm once to allow the main process to fetch them; localhost and
                        private hosts are blocked.
                      </p>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          Deep research — max model rounds per run
                        </span>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', maxWidth: 200 }}
                          min={1}
                          max={24}
                          step={1}
                          value={deepLearnMaxRoundsDraft}
                          onChange={(e) => setDeepLearnMaxRoundsDraft(e.target.value)}
                          onBlur={() => {
                            const n = parseInt(deepLearnMaxRoundsDraft.trim(), 10)
                            const v = Math.min(24, Math.max(1, Number.isFinite(n) ? n : 5))
                            setDeepLearnMaxRoundsDraft(String(v))
                            void window.api.setConfig({ deepLearnMaxRounds: v })
                          }}
                        />
                      </label>
                      <label style={{ display: 'block', marginTop: 12 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          Deep research — max bytes per approved URL fetch
                        </span>
                        <input
                          type="number"
                          className="input"
                          style={{ width: '100%', maxWidth: 200 }}
                          min={4096}
                          max={8000000}
                          step={1024}
                          value={deepLearnMaxFetchBytesDraft}
                          onChange={(e) => setDeepLearnMaxFetchBytesDraft(e.target.value)}
                          onBlur={() => {
                            const n = parseInt(deepLearnMaxFetchBytesDraft.trim(), 10)
                            const v = Math.min(8_000_000, Math.max(4096, Number.isFinite(n) ? n : 1_500_000))
                            setDeepLearnMaxFetchBytesDraft(String(v))
                            void window.api.setConfig({ deepLearnMaxFetchBytes: v })
                          }}
                        />
                      </label>
                      <label className="metrics-widget-check" style={{ marginTop: 18 }}>
                        <input
                          type="checkbox"
                          checked={agenticWorkersEnabled}
                          onChange={(e) => {
                            const v = e.target.checked
                            setAgenticWorkersEnabled(v)
                            void window.api.setConfig({ agenticWorkersEnabled: v })
                          }}
                        />
                        <span>
                          <i className="fa-solid fa-diagram-project" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                          Enable parallel multi-model agents (Ollama only)
                        </span>
                      </label>
                      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                        Each send runs a short planner on your primary model, then up to four specialist workers in parallel. Workers can use different Ollama
                        tags on this machine. Optionally, you may add a second Ollama base URL for another host <strong>you</strong> operate (homelab PC, LAN
                        box, VPS with Ollama). Third-party LLM APIs are not supported — self-hosted Ollama only.
                      </p>
                      <label style={{ display: 'block', marginTop: 14 }}>
                        <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                          <i className="fa-solid fa-server" aria-hidden style={{ marginRight: 6, opacity: 0.65 }} />
                          Self-hosted Ollama URL (optional, second machine you run)
                        </span>
                        <input
                          type="url"
                          className="input"
                          style={{ width: '100%', maxWidth: 420 }}
                          placeholder="http://192.168.1.50:11434 or https://ollama.myserver.net"
                          value={agentRemoteOllamaUrlDraft}
                          onChange={(e) => setAgentRemoteOllamaUrlDraft(e.target.value)}
                          onBlur={() => void window.api.setConfig({ agentRemoteOllamaUrl: agentRemoteOllamaUrlDraft.trim() })}
                        />
                      </label>
                    </div>
                  </section>
                    )}

                    {settingsNav === 'integrations' && (
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
                      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn-secondary settings-btn-icon"
                          disabled={intellijPluginZipSaving}
                          onClick={async () => {
                            setIntellijPluginZipSaving(true)
                            setErr(null)
                            try {
                              const r = await window.api.saveIntellijPluginZip()
                              if (r.ok) {
                                setErr(null)
                              } else if (!r.canceled) {
                                setErr(r.error ?? 'Could not save IntelliJ plugin ZIP')
                              }
                            } catch (e) {
                              setErr(String(e))
                            } finally {
                              setIntellijPluginZipSaving(false)
                            }
                          }}
                        >
                          <i className="fa-solid fa-download" aria-hidden />
                          {intellijPluginZipSaving ? 'Preparing…' : 'Save IntelliJ plugin (.zip)…'}
                        </button>
                      </div>
                      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                        Uses a Gradle <code className="inline-code">buildPlugin</code> ZIP from this install when present; otherwise downloads the matching file from
                        the latest <a href="https://github.com/localllm/local-llm-desktop/releases">GitHub release</a>. In the IDE:{' '}
                        <strong>Settings → Plugins → Install Plugin from Disk…</strong>
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
                      <label className="metrics-widget-check" style={{ marginTop: 10 }}>
                        <input
                          type="checkbox"
                          checked={ideJourneyAutoChecklist}
                          onChange={(e) => void setIdeJourneyAutoChecklistPersist(e.target.checked)}
                        />
                        <span>
                          <i className="fa-solid fa-list-check" aria-hidden style={{ marginRight: 6, opacity: 0.55 }} />
                          Auto-mark journey checklist &quot;first IDE chat&quot; on successful plugin reports
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
                    <CodebaseFormalSettingsSection
                      onEnrichmentComplete={() => {
                        void loadWiki()
                        void loadKnowledgeGraph({ keepAnalysis: true })
                        void loadCodebaseAnalyses()
                      }}
                    />
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
                    <div className="drawer-section">
                      <h3 className="settings-section-title">
                        <i className="fa-solid fa-clock-rotate-left" aria-hidden />
                        Recent IDE bridge activity
                      </h3>
                      {integrationPluginReports.length === 0 ? (
                        <p className="muted" style={{ marginTop: 0 }}>
                          No plugin requests recorded yet. Enable the bridge above and use the IntelliJ integration.
                        </p>
                      ) : (
                        <ul className="settings-plugin-report-list muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {[...integrationPluginReports]
                            .slice()
                            .reverse()
                            .slice(0, 14)
                            .map((r, i) => (
                              <li key={`${r.receivedAt}-${i}`} style={{ marginBottom: 6 }}>
                                <strong style={{ color: 'var(--text-primary)' }}>{settingsPluginKindLabel(r.kind)}</strong>
                                <span style={{ marginLeft: 8 }}>
                                  {new Date(r.receivedAt).toLocaleString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  })}
                                </span>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </section>
                    )}

                    {settingsNav === 'data' && (
                  <section className="settings-group" aria-labelledby="settings-grp-storage">
                    <h2 id="settings-grp-storage" className="settings-group-heading">
                      <i className="fa-solid fa-hard-drive" aria-hidden />
                      Files &amp; paths
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
                    )}

                    {settingsNav === 'runtime' && (
                      <section className="settings-group" aria-labelledby="settings-grp-runtime">
                        <h2 id="settings-grp-runtime" className="settings-group-heading">
                          <i className="fa-solid fa-microchip" aria-hidden />
                          Runtime &amp; backends
                        </h2>
                        <div className="drawer-section">
                          <p className="muted" style={{ marginTop: 0 }}>
                            Choose the model and press <strong>Play</strong> in the top bar. This tab stores connection defaults; live status, install
                            helpers, and downloads stay in the <strong>Run</strong> drawer.
                          </p>
                          <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setDrawer('runtime')}>
                            Open inference runtime drawer…
                          </button>
                        </div>
                        <div className="drawer-section">
                          <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
                            Ollama tags and local weight files are combined in the top bar. The app starts <strong>Ollama</strong> or{' '}
                            <strong>llama-server</strong> automatically from the entry you pick.
                          </p>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-link" aria-hidden />
                            Ollama API
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Base URL for tag listing, pulls, and chat when Ollama is selected. Probe updates after you save.
                          </p>
                          {ollamaHost != null ? (
                            <p className="muted" style={{ marginTop: 8 }}>
                              <span
                                className={`runtime-ollama-probe-mark ${ollamaHost.reachable ? 'runtime-ollama-probe-mark--ok' : 'runtime-ollama-probe-mark--bad'}`}
                                style={{ marginRight: 8 }}
                                aria-hidden
                              >
                                {ollamaHost.reachable ? '✓' : '✗'}
                              </span>
                              Last check: <code className="inline-code">{ollamaHost.baseUrl}</code>
                            </p>
                          ) : null}
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              API base URL
                            </span>
                            <input
                              className="input"
                              style={{ width: '100%', maxWidth: 420 }}
                              value={ollamaBaseUrlDraft}
                              onChange={(e) => setOllamaBaseUrlDraft(e.target.value)}
                              onBlur={() => {
                                const t = ollamaBaseUrlDraft.trim() || OLLAMA_BASE_DEFAULT
                                setOllamaBaseUrlDraft(t)
                                void window.api
                                  .setConfig({ ollamaBaseUrl: t })
                                  .then(() => {
                                    void refreshRunDrawerQuick()
                                    void refreshOllamaChatTags()
                                  })
                              }}
                              placeholder={OLLAMA_BASE_DEFAULT}
                            />
                          </label>
                        </div>
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-server" aria-hidden />
                            llama.cpp server
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Port passed to <code className="inline-code">llama-server</code> when this app spawns it. Restart the runtime after changing.
                          </p>
                          <label style={{ display: 'block', marginTop: 12 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Listen port
                            </span>
                            <input
                              type="number"
                              className="input"
                              style={{ width: '100%', maxWidth: 200 }}
                              min={1024}
                              max={65535}
                              value={llamaPortDraft}
                              onChange={(e) => setLlamaPortDraft(e.target.value)}
                              onBlur={() => {
                                const n = parseInt(llamaPortDraft.trim(), 10)
                                const v = clampLlamaPort(Number.isFinite(n) ? n : LLAMA_PORT_DEFAULT)
                                setLlamaPortDraft(String(v))
                                void window.api.setConfig({ llamaPort: v })
                              }}
                            />
                          </label>
                          <label style={{ display: 'block', marginTop: 16 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Context size (tokens, <code className="inline-code">-c</code>)
                            </span>
                            <input
                              type="number"
                              className="input"
                              style={{ width: '100%', maxWidth: 200 }}
                              min={LLAMA_CONTEXT_TOKENS_MIN}
                              max={LLAMA_CONTEXT_TOKENS_MAX}
                              step={1024}
                              value={llamaContextTokensDraft}
                              onChange={(e) => setLlamaContextTokensDraft(e.target.value)}
                              onBlur={() => {
                                const n = parseInt(llamaContextTokensDraft.trim(), 10)
                                const v = clampLlamaContextTokens(
                                  Number.isFinite(n) ? n : LLAMA_CONTEXT_TOKENS_DEFAULT
                                )
                                setLlamaContextTokensDraft(String(v))
                                void window.api.setConfig({ llamaContextTokens: v })
                              }}
                            />
                          </label>
                          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                            Prompt plus reply must fit in this window (long chats and RAG need more). Uses more VRAM/RAM when
                            higher. Restart Run after changing.
                          </p>
                          <label style={{ display: 'block', marginTop: 18 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Max response tokens (llama.cpp only)
                            </span>
                            <input
                              type="number"
                              className="input"
                              style={{ width: '100%', maxWidth: 200 }}
                              min={CHAT_MAX_TOKENS_MIN}
                              max={CHAT_MAX_TOKENS_MAX}
                              value={llamaChatMaxTokensDraft}
                              placeholder={chatMaxTokensDraft.trim() || String(CHAT_MAX_TOKENS_DEFAULT)}
                              onChange={(e) => setLlamaChatMaxTokensDraft(e.target.value)}
                              onBlur={() => {
                                const t = llamaChatMaxTokensDraft.trim()
                                if (!t) {
                                  void window.api.setConfig({ llamaChatMaxTokens: null })
                                  return
                                }
                                const n = parseInt(t, 10)
                                const v = clampChatMaxTokens(Number.isFinite(n) ? n : CHAT_MAX_TOKENS_DEFAULT)
                                setLlamaChatMaxTokensDraft(String(v))
                                void window.api.setConfig({ llamaChatMaxTokens: v })
                              }}
                            />
                          </label>
                          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                            Optional override for <code className="inline-code">max_tokens</code> and server <code className="inline-code">-n</code>. Leave empty to use{' '}
                            <strong>Chat &amp; knowledge → Max response tokens</strong>. Restart Run after changing.
                          </p>
                          <p className="settings-section-title" style={{ marginTop: 18, marginBottom: 6, fontSize: 14 }}>
                            Sampling (OpenAI API)
                          </p>
                          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                            Passed on each <code className="inline-code">/v1/chat/completions</code> call. Restart Run is not required.
                          </p>
                          <div className="settings-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 440 }}>
                            <label style={{ display: 'block' }}>
                              <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                                Temperature
                              </span>
                              <input
                                type="number"
                                className="input"
                                min={0}
                                max={2}
                                step={0.05}
                                value={llamaTemperatureDraft}
                                onChange={(e) => setLlamaTemperatureDraft(e.target.value)}
                                onBlur={() => {
                                  const n = parseFloat(llamaTemperatureDraft.trim())
                                  const v = Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0.8
                                  setLlamaTemperatureDraft(String(v))
                                  void window.api.setConfig({ llamaTemperature: v })
                                }}
                              />
                            </label>
                            <label style={{ display: 'block' }}>
                              <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                                Top P
                              </span>
                              <input
                                type="number"
                                className="input"
                                min={0}
                                max={1}
                                step={0.05}
                                value={llamaTopPDraft}
                                onChange={(e) => setLlamaTopPDraft(e.target.value)}
                                onBlur={() => {
                                  const n = parseFloat(llamaTopPDraft.trim())
                                  const v = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.95
                                  setLlamaTopPDraft(String(v))
                                  void window.api.setConfig({ llamaTopP: v })
                                }}
                              />
                            </label>
                            <label style={{ display: 'block' }}>
                              <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                                Frequency penalty
                              </span>
                              <input
                                type="number"
                                className="input"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={llamaFrequencyPenaltyDraft}
                                onChange={(e) => setLlamaFrequencyPenaltyDraft(e.target.value)}
                                onBlur={() => {
                                  const n = parseFloat(llamaFrequencyPenaltyDraft.trim())
                                  const v = Number.isFinite(n) ? Math.min(2, Math.max(-2, n)) : 0
                                  setLlamaFrequencyPenaltyDraft(String(v))
                                  void window.api.setConfig({ llamaFrequencyPenalty: v })
                                }}
                              />
                            </label>
                            <label style={{ display: 'block' }}>
                              <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
                                Presence penalty
                              </span>
                              <input
                                type="number"
                                className="input"
                                min={-2}
                                max={2}
                                step={0.1}
                                value={llamaPresencePenaltyDraft}
                                onChange={(e) => setLlamaPresencePenaltyDraft(e.target.value)}
                                onBlur={() => {
                                  const n = parseFloat(llamaPresencePenaltyDraft.trim())
                                  const v = Number.isFinite(n) ? Math.min(2, Math.max(-2, n)) : 0
                                  setLlamaPresencePenaltyDraft(String(v))
                                  void window.api.setConfig({ llamaPresencePenalty: v })
                                }}
                              />
                            </label>
                          </div>
                          <label className="metrics-widget-check" style={{ marginTop: 12 }}>
                            <input
                              type="checkbox"
                              checked={llamaRagGrounding}
                              onChange={(e) => {
                                const v = e.target.checked
                                setLlamaRagGrounding(v)
                                void window.api.setConfig({ llamaRagGrounding: v })
                              }}
                            />
                            <span>
                              Require RAG snippet citations (llama.cpp) — adds instructions to cite [1], [2], … and
                              warns if the reply omits them.
                            </span>
                          </label>
                          <label style={{ display: 'block', marginTop: 16 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              <code className="inline-code">llama-server</code> binary path
                            </span>
                            <input
                              className="input"
                              style={{ width: '100%', maxWidth: 480 }}
                              value={llamaBin}
                              onChange={(e) => setLlamaBin(e.target.value)}
                              placeholder="Path to llama-server executable"
                            />
                          </label>
                          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
                            <button type="button" className="btn-primary settings-btn-icon" onClick={() => void saveLlamaBinaryFromSettings()}>
                              <i className="fa-solid fa-floppy-disk" aria-hidden />
                              Save binary path
                            </button>
                          </div>
                          {llamaEnv?.detected && llamaEnv.resolvedPath ? (
                            <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 12 }}>
                              Detected on PATH: <code className="inline-code">{llamaEnv.resolvedPath}</code>
                            </p>
                          ) : null}
                          {llamaEnv?.detected && llamaEnv.binaryValid ? (
                            <p className="muted runtime-llama-ok" style={{ marginTop: 10, marginBottom: 0 }}>
                              llama-server validation passed (--help probe).
                            </p>
                          ) : null}
                          {llamaEnv?.detected && !llamaEnv.binaryValid && llamaEnv.validateError ? (
                            <p className="runtime-llama-validate-warn" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
                              {llamaEnv.validateError}
                            </p>
                          ) : null}
                          <label style={{ display: 'block', marginTop: 18 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Path to <code className="inline-code">convert_hf_to_gguf.py</code> (optional — leave empty
                              to use the <strong>bundled</strong> script from the app for{' '}
                              <code className="inline-code">.safetensors</code>)
                            </span>
                            <input
                              className="input"
                              style={{ width: '100%', maxWidth: 560 }}
                              value={llamaConvertScriptPath}
                              onChange={(e) => setLlamaConvertScriptPath(e.target.value)}
                              onBlur={() =>
                                void window.api.setConfig({ llamaConvertScriptPath: llamaConvertScriptPath.trim() })
                              }
                              placeholder="Leave empty for bundled converter, or set a custom script path"
                            />
                          </label>
                          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12, maxWidth: 640 }}>
                            One-time Python setup for conversion: run{' '}
                            <code className="inline-code">pip install -r requirements-convert.txt</code> inside{' '}
                            <code className="inline-code">vendor/llama-hf-to-gguf</code> (dev) or{' '}
                            <code className="inline-code">resources/llama-hf-to-gguf</code> next to the installed app
                            (the app shows the full path in errors if a package is missing).
                          </p>
                          <label style={{ display: 'block', marginTop: 14 }}>
                            <span className="muted" style={{ display: 'block', marginBottom: 6 }}>
                              Python for conversion (the app picks a working interpreter on PATH when this is empty —
                              try <code className="inline-code">py -3</code>, <code className="inline-code">python</code>,
                              then <code className="inline-code">python3</code>; override with a full path if needed)
                            </span>
                            <input
                              className="input"
                              style={{ width: '100%', maxWidth: 400 }}
                              value={llamaPythonPath}
                              onChange={(e) => setLlamaPythonPath(e.target.value)}
                              onBlur={() => void window.api.setConfig({ llamaPythonPath: llamaPythonPath.trim() })}
                              placeholder="Leave empty for auto-detect, or e.g. python3 / full path to python.exe"
                            />
                          </label>
                        </div>
                      </section>
                    )}

                    {settingsNav === 'widgets' && (
                  <section className="settings-group" aria-labelledby="settings-grp-widgets">
                    <h2 id="settings-grp-widgets" className="settings-group-heading">
                      <i className="fa-solid fa-gauge-high" aria-hidden />
                      Widgets &amp; metrics
                    </h2>
                    {metricsWidgetControls}
                        <div className="drawer-section">
                          <h3 className="settings-section-title">
                            <i className="fa-solid fa-up-right-and-down-left-from-center" aria-hidden />
                            Default pinned panel size
                          </h3>
                          <p className="muted" style={{ marginTop: 0 }}>
                            Starting width and height when the pinned widgets rail opens. Drag panel edges in the UI anytime; use <strong>Save</strong> to
                            persist numbers here.
                          </p>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                            <label style={{ flex: '1 1 120px' }}>
                              <span className="muted" style={{ display: 'block', marginBottom: 4 }}>
                                Width (px)
                              </span>
                              <input
                                type="number"
                                className="input"
                                min={PINNED_W_MIN}
                                max={1400}
                                value={pinnedWidgetsWidthPx}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10)
                                  if (!Number.isFinite(n)) return
                                  setPinnedWidgetsWidthPx(clampPinnedWidth(n))
                                }}
                              />
                            </label>
                            <label style={{ flex: '1 1 120px' }}>
                              <span className="muted" style={{ display: 'block', marginBottom: 4 }}>
                                Height (px)
                              </span>
                              <input
                                type="number"
                                className="input"
                                min={PINNED_H_MIN}
                                max={1200}
                                value={pinnedWidgetsHeightPx}
                                onChange={(e) => {
                                  const n = parseInt(e.target.value, 10)
                                  if (!Number.isFinite(n)) return
                                  setPinnedWidgetsHeightPx(clampPinnedHeight(n))
                                }}
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            className="btn-secondary settings-btn-icon"
                            style={{ marginTop: 12 }}
                            onClick={() =>
                              void window.api.setConfig({
                                pinnedWidgetsWidthPx: clampPinnedWidth(pinnedWidgetsWidthPx),
                                pinnedWidgetsHeightPx: clampPinnedHeight(pinnedWidgetsHeightPx)
                              })
                            }
                          >
                            <i className="fa-solid fa-floppy-disk" aria-hidden />
                            Save panel size
                          </button>
                        </div>
                        <div className="drawer-section">
                          <button type="button" className="btn-secondary" onClick={() => setDrawer('metrics')}>
                            Open metrics &amp; charts drawer…
                          </button>
                          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                            GPU, memory, and history charts; snapshot recording.
                          </p>
                        </div>
                  </section>
                    )}

                    {settingsNav === 'maintenance' && (
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
                          onClick={() => setSettingsConfirmKind('wikiReset')}
                        >
                          <i className="fa-solid fa-book-skull" aria-hidden />
                          {settingsMaintenanceBusy === 'wikiReset' ? 'Removing…' : 'Reset wiki &amp; all domains'}
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
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </>
      )}

      {settingsConfirmKind && (
        <div
          className="modal-overlay modal-overlay--layer-top"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-destructive-title"
          onClick={() => setSettingsConfirmKind(null)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2 id="settings-destructive-title" className="modal-title">
              {settingsConfirmKind === 'caches' && 'Clear all caches?'}
              {settingsConfirmKind === 'wikiReset' && 'Reset entire wiki and all prompt domains?'}
              {settingsConfirmKind === 'models' && 'Delete all model files?'}
              {settingsConfirmKind === 'factory' && 'Reset settings to factory defaults?'}
            </h2>
            {settingsConfirmKind === 'caches' ? (
              <p className="muted modal-text">
                This cancels active downloads, clears the download registry and Hugging Face metadata cache in the database, wipes metrics history and training job records, and deletes files under the vectors index folder. Your conversations, knowledge base, wiki pages, and downloaded model weight files are kept.
              </p>
            ) : null}
            {settingsConfirmKind === 'wikiReset' ? (
              <p className="muted modal-text">
                This permanently deletes <strong>every</strong> knowledge library entry (documents, saved chats, chat
                notes, auto-extracted notes), all compiled wiki pages, indexed chunks, and the full-text search index for
                that material. It also clears <strong>all chat prompt domains</strong>: every domain row, all keyword
                clusters, optional per-domain system suffixes, and every link from stored messages to those domains. Your{' '}
                <strong>conversations and chat history are kept</strong>; only the wiki / knowledge base and domain data
                are cleared. Training job records are not removed, but past jobs may reference KB source ids that no longer
                exist.
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
                Stops the runtime and cancels in-flight downloads. All saved settings (including custom models folder, llama binary and Safetensors-convert paths, Ollama URL, ports, llama context size, max response tokens, auto wiki extraction from chat, IDE integration, and pinned widgets) return to defaults, and your Hugging Face token is removed from this device. Chats, knowledge base, wiki, caches, and model files are not changed by this action alone.
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
                  else if (settingsConfirmKind === 'wikiReset') void runResetWikiAndKeywords()
                  else if (settingsConfirmKind === 'models') void runDeleteAllModels()
                  else void runResetFactoryConfig()
                }}
              >
                {settingsConfirmKind === 'caches' && 'Clear caches'}
                {settingsConfirmKind === 'wikiReset' && 'Reset wiki & domains'}
                {settingsConfirmKind === 'models' && 'Delete models'}
                {settingsConfirmKind === 'factory' && 'Reset settings'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
