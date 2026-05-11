import {
  app,
  ipcMain,
  dialog,
  safeStorage,
  BrowserWindow,
  shell,
  type MessageBoxOptions
} from 'electron'
import { randomUUID } from 'crypto'
import { basename, join, resolve } from 'path'

function llamaPathsDiffer(a: string, b: string): boolean {
  try {
    const na = resolve(a.replace(/^file:\/\//i, ''))
      .replace(/\\/g, '/')
      .toLowerCase()
    const nb = resolve(b.replace(/^file:\/\//i, ''))
      .replace(/\\/g, '/')
      .toLowerCase()
    return na !== nb
  } catch {
    return a.trim() !== b.trim()
  }
}

/** Loopback HTTP client for IDE bridge self-test (same host as integration server). */
async function localhostJsonRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<{ statusCode: number; body: string }> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { ...opts.headers }
  const body = opts.body
  if (body && headers['Content-Length'] == null) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
  }
  const timeoutMs = opts.timeoutMs ?? 8000
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    if (body) req.write(body)
    req.end()
  })
}

import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import http from 'node:http'
import type Store from 'electron-store'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import { isValidStoredColorScheme } from '@shared/colorScheme'
import type {
  CodebaseWikiAnalysisProgress,
  KbIngestFileProgress,
  RuntimeLoadProgress,
  WikiExtractArticleRequest,
  WikiArticleCleanupProgress,
  WikiReanalyzeProgress
} from '@shared/types'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import {
  mergeIdeJourneyChecklist,
  type BridgeSelfTestStep,
  type IntegrationBridgeSelfTestResult,
  type IntegrationBridgeSmokeChat
} from '@shared/ideJourney'
import { MAX_PROMPT_DOMAIN_SUFFIX_CHARS } from '@shared/promptDomains'
import { assertSelfHostedOllamaBaseUrl } from '@shared/agenticChat'
import {
  clampLlamaContextTokens,
  LLAMA_CONTEXT_TOKENS_DEFAULT
} from '@shared/llamaContext'
import { manualCheckForUpdates } from '../updateController'
import { hfSearch, hfModelDetail, hfRecommended } from '../services/hfService'
import {
  startDownload,
  cancelDownload,
  listDownloadsWithProgress,
  getActiveDownload,
  clearDownloadRegistryAndHfCache,
  cancelAllActiveDownloads,
  hfResolveDownloadUrl
} from '../services/downloadManager'
import { createRuntime, type RuntimeAdapter } from '../services/runtime'
import {
  llamaChatMaxCompletionTokensFromStore,
  resolveChatMaxCompletionTokens
} from '../services/chatMaxTokens'
import { installOllamaForPlatform } from '../services/ollamaInstaller'
import {
  deleteOllamaModel,
  ensureOllamaModelInLibrary,
  fetchOllamaModelTags,
  probeOllamaReachable
} from '../services/runtime/ollamaAdapter'
import * as chatService from '../services/chatService'
import {
  assignUserMessageToPromptDomains,
  collectDomainSystemSuffixForMessage,
  listPromptDomains,
  updatePromptDomainSystemSuffix
} from '../services/promptDomainService'
import * as kbService from '../services/kbService'
import {
  analyzeKnowledgeGraph,
  knowledgeGraphAnalysisToMarkdown
} from '@shared/knowledgeGraphAnalysis'
import {
  parseWikiExtractResponse,
  runWikiExtractChat,
  wikiExtractLimits
} from '../services/wikiExtractService'
import {
  deepLearnCancelJob,
  resolveDeepLearnRoundChoice,
  runDeepLearnResearch
} from '../services/deepLearnResearchService'
import { runWikiReanalysisBatch } from '../services/wikiReanalysisService'
import { assertUrlAllowedForDeepLearnFetch } from '../services/deepLearnFetch'
import * as metricsService from '../services/metricsService'
import * as trainOrchestrator from '../services/trainOrchestrator'
import { logLine } from '../logger'
import { resolveLlamaBinary, validateLlamaServerBinary } from '../services/llamaDetect'
import { collectHardwareSummary } from '../services/hardwareSummary'
import { clearAllAppCaches, deleteAllChildrenInDirectory } from '../services/dataMaintenance'
import { migrateChatProfileSettings, migrateRoleSetupIfNeeded, resetElectronStoreToFactory } from '../storeDefaults'
import { configureIntegrationServer } from '../services/integrationServer'
import { createOntologyService } from '../services/ontologyService'
import { ensureDemoSeeded } from '../services/demoSeed'
import { runIntegrationChatPipeline } from '../services/integrationChatPipeline'
import { getPluginReportHistory } from '../services/pluginIntegrationHub'
import { listGgufModelsInDir } from '../services/localModelsScan'
import { hfDownloadAbsolutePath } from '../services/hfDownloadNaming'
import {
  ensureGgufForSafetensorsModelPath,
  isSafetensorsWeightFilePath
} from '../services/safetensorsGgufConvert'
import {
  ensureAutoDetectedPythonInStore,
  resetPythonAutoDetectSession
} from '../services/pythonDetect'
import { scanArchitectureRepository } from '../services/architectureRepositoryScan'
import { saveIntellijPluginZipWithDialog } from '../services/intellijPluginZip'
import {
  appendLearningEvent,
  buildManifestFromApproved,
  listDomainModelVersions,
  listDomainProfiles,
  listEvidenceCards,
  upsertDomainProfile,
  updateEvidenceCardStatus
} from '../services/trainingWorkflowStore'
import {
  addFormalProfile,
  addManualCodebase,
  appendFormalRun,
  readCodebaseFormalBundle,
  removeCodebase,
  removeFormalProfile,
  updateCodebase,
  updateFormalProfile,
  updateFormalRun
} from '../services/codebaseFormalStore'
import {
  addCodebaseFromGitUrl,
  listLatestCodebaseAnalysisSnapshots,
  runCodebaseWikiAnalysis
} from '../services/codebaseWikiPipeline'
import {
  attachFormalRunLlmAdvisory,
  shouldAutoInterpretFormalRun,
  shouldIncludeKbContext
} from '../services/formalVerificationInterpret'
import { registerDmsIpc } from './registerDmsIpc'
import {
  expandCommandTemplate,
  finalizeRunRow,
  runFormalVerificationJob
} from '../services/formalVerificationRunner'
import {
  DEFAULT_FORMAL_TOOL_TIMEOUT_MS,
  type FormalToolProfile,
  type FormalVerificationProgressPayload,
  type FormalVerificationRun
} from '@shared/codebaseRegistry'

const configSchema = z.object({
  /** Set to `null` to clear and use the app default under user data. */
  modelsDir: z.union([z.string().min(1), z.null()]).optional(),
  llamaBinaryPath: z.string().optional(),
  /** Full path to llama.cpp `convert_hf_to_gguf.py` (optional; otherwise searched near llama-server). */
  llamaConvertScriptPath: z.string().max(4096).optional(),
  /** Python executable for conversion (optional; default python / python3). */
  llamaPythonPath: z.string().max(4096).optional(),
  runtimeKind: z.enum(['llamacpp', 'ollama']).optional(),
  trainBackend: z.enum(['axolotl']).optional(),
  /** Last model that was running (Ollama tag or local weight path). */
  lastRuntimeModelPath: z.string().max(8192).optional(),
  lastRuntimeModelKind: z.enum(['llamacpp', 'ollama']).optional(),
  /** When true, next launch restores `lastRuntime*` and auto-starts the runtime after the wake overlay. */
  resumeRuntimeOnLaunch: z.boolean().optional(),
  ollamaBaseUrl: z.string().optional(),
  llamaPort: z.number().optional(),
  llamaContextTokens: z.number().int().min(2048).max(262_144).optional(),
  hfTokenEncrypted: z.string().optional(),
  metricsPinned: z.boolean().optional(),
  metricsRefreshMs: z.number().min(500).max(3_600_000).optional(),
  downloadsPinned: z.boolean().optional(),
  activityPinned: z.boolean().optional(),
  issuesPinned: z.boolean().optional(),
  pinnedWidgetsSide: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  pinnedWidgetsBarCollapsed: z.boolean().optional(),
  pinnedWidgetsWidthPx: z.number().min(160).max(1400).optional(),
  pinnedWidgetsHeightPx: z.number().min(300).max(1200).optional(),
  pinnedWidgetWeights: z
    .object({
      metrics: z.number().min(0.05).max(100).optional(),
      downloads: z.number().min(0.05).max(100).optional(),
      activity: z.number().min(0.05).max(100).optional(),
      issues: z.number().min(0.05).max(100).optional()
    })
    .optional(),
  colorScheme: z
    .string()
    .optional()
    .refine((s) => s == null || s === '' || isValidStoredColorScheme(s), {
      message: 'Unknown color scheme id'
    }),
  typographyComfort: z.enum(['compact', 'balanced', 'relaxed', 'reader']).optional(),
  typographyFontFamily: z.enum(['system', 'wide_sans', 'serif_document']).optional(),
  typographyLineHeightFactor: z.number().min(0.88).max(1.2).optional(),
  typographyLetterSpacingExtraEm: z.number().min(-0.04).max(0.12).optional(),
  typographyWordSpacingEm: z.number().min(0).max(0.2).optional(),
  chatMaxTokens: z.number().int().min(1).max(262_144).optional(),
  /** When set, caps llama.cpp `max_tokens` / `-n` default instead of global `chatMaxTokens`. Clear with `null`. */
  llamaChatMaxTokens: z.union([z.number().int().min(1).max(262_144), z.null()]).optional(),
  chatHistoryMaxMessages: z.number().int().min(2).max(500).optional(),
  chatDomainEnhancement: z.boolean().optional(),
  llamaRagGrounding: z.boolean().optional(),
  ontologyEnabled: z.boolean().optional(),
  ontologyMaxTriples: z.number().int().min(5).max(200).optional(),
  ontologyContextTokens: z.number().int().min(64).max(3000).optional(),
  llamaTemperature: z.number().min(0).max(2).optional(),
  llamaTopP: z.number().min(0).max(1).optional(),
  llamaFrequencyPenalty: z.number().min(-2).max(2).optional(),
  llamaPresencePenalty: z.number().min(-2).max(2).optional(),
  integrationListenEnabled: z.boolean().optional(),
  integrationPort: z.number().int().min(1024).max(65535).optional(),
  integrationToken: z.string().max(256).optional(),
  ideJourneyChecklist: z
    .object({
      backendReady: z.boolean().optional(),
      pluginInstalled: z.boolean().optional(),
      intellijConfigured: z.boolean().optional(),
      firstIdeChat: z.boolean().optional()
    })
    .optional(),
  /** When true, successful IDE chat_completed reports mark checklist firstIdeChat. */
  ideJourneyAutoChecklist: z.boolean().optional(),
  wikiAutoExtract: z.boolean().optional(),
  chatResponsePostProcess: z.boolean().optional(),
  deepLearnEnabled: z.boolean().optional(),
  deepLearnMaxRounds: z.number().int().min(1).max(24).optional(),
  deepLearnMaxFetchBytes: z.number().int().min(4096).max(8_000_000).optional(),
  /** Bump when onboarding copy changes; user sees welcome until version matches latest in app. */
  welcomeGuideVersion: z.number().int().min(0).max(99).optional(),
  uiRole: z.enum(['software_developer', 'software_architect', 'business_analyst', 'tester', 'builder_admin']).optional(),
  workspaceDensity: z.enum(['focused', 'standard', 'expanded']).optional(),
  /** First-run role tour; see `@shared/uiRole` SETUP_TOUR_LATEST. */
  setupTourVersion: z.number().int().min(0).max(99).optional(),
  /** If false, startup will not auto-open setup tour even when content version changes. */
  setupTourOnStartup: z.boolean().optional(),
  /** Focus UI on the presentation workflow and remove advanced navigation noise. */
  presentationModeEnabled: z.boolean().optional(),
  /** Reveal advanced/non-core surfaces even when presentation mode is on. */
  showAdvancedSurfaces: z.boolean().optional(),
  /** Seed bundle version for first-run demo content hydration. */
  demoSeedBundleVersion: z.number().int().min(0).max(999).optional(),
  /** Ambient animated sphere backdrop behind shell chrome. */
  animatedBackdropEnabled: z.boolean().optional(),
  /** Chat: planner spawns parallel Ollama workers (Ollama runtime only). */
  agenticWorkersEnabled: z.boolean().optional(),
  /** Optional second Ollama base URL for agent workers (remote GPU / larger models). */
  agentRemoteOllamaUrl: z.union([z.string().max(2048), z.literal('')]).optional(),
  /** Workspace folder for Architecture Repository bounded scan (Software architect UI). Clear with null or empty. */
  architectureRepositoryScanRoot: z.union([z.string().min(1).max(8192), z.literal(''), z.null()]).optional(),
  /** Persisted generated chapter drafts + version history for TOGAF repository view. */
  architectureRepositoryGeneratedChaptersSchemaVersion: z.number().int().min(1).max(20).optional(),
  architectureRepositoryGeneratedChapters: z
    .record(
      z
        .object({
          activeVersion: z.number().int().min(1).max(10_000),
          versions: z
            .array(
              z.object({
                version: z.number().int().min(1).max(10_000),
                createdAt: z.number().int().min(0),
                markdown: z.string().max(250_000),
                format: z.enum(['markdown', 'asciidoc']).optional(),
                modelPath: z.string().max(8192).optional(),
                artifactId: z.string().max(128).optional(),
                subjectKey: z.string().max(8192).optional()
              })
            )
            .min(1)
            .max(40)
        })
        .strict()
    )
    .optional(),
  formalVerificationInterpretWithLlm: z.boolean().optional(),
  formalVerificationInterpretIncludeKb: z.boolean().optional()
})

export interface IpcContext {
  db: Database.Database
  store: Store<Record<string, unknown>>
  userData: string
  getHfToken: () => string | undefined
  setHfToken: (t: string | undefined) => void
  getRuntime: () => RuntimeAdapter | null
  setRuntime: (r: RuntimeAdapter | null) => void
}

function ollamaTagConflictsWithLoaded(loaded: string, toDelete: string): boolean {
  const a = loaded.trim()
  const b = toDelete.trim()
  if (!a || !b) return false
  if (a === b) return true
  const baseA = a.split(':')[0] ?? ''
  const baseB = b.split(':')[0] ?? ''
  if (baseA !== '' && baseA === baseB) return true
  if (a.startsWith(`${b}:`) || b.startsWith(`${a}:`)) return true
  return false
}

export function registerIpc(ctx: IpcContext): void {
  const { db, store, userData, getHfToken, setHfToken, getRuntime, setRuntime } = ctx
  registerDmsIpc({ db, store })
  migrateChatProfileSettings(store)
  migrateRoleSetupIfNeeded(store)

  const modelsDir = (): string => {
    const m = (store.get('modelsDir') as string | undefined)?.trim()
    if (m) {
      try {
        if (!existsSync(m)) mkdirSync(m, { recursive: true })
      } catch (e) {
        logLine('error', 'models_dir_mkdir', {
          path: m,
          error: e instanceof Error ? e.message : String(e)
        })
      }
      if (existsSync(m)) return m
      logLine('warn', 'models_dir_unusable', { path: m })
      store.delete('modelsDir')
    }
    const d = join(userData, 'models')
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
    return d
  }

  const safeRecordLearningEvent = (args: {
    source: 'electron' | 'intellij-plugin'
    actor: string
    interactionType: 'chat_turn' | 'wiki_extract' | 'deep_learn' | 'plugin_report' | 'tool_outcome'
    payloadRef: string
    summary: string
    details?: Record<string, unknown>
    domainId?: string | null
  }): void => {
    try {
      appendLearningEvent(db, args)
    } catch (e) {
      logLine('warn', 'learning_event_append_failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
  const ontology = createOntologyService(db)
  void ensureDemoSeeded({ db, store, ontology })

  ipcMain.handle(IPC.GET_PATHS, () => ({
    userData,
    logs: join(userData, 'logs'),
    modelsDefault: modelsDir(),
    db: join(userData, 'app.sqlite'),
    vectors: join(userData, 'vectors'),
    platform: process.platform,
    appVersion: app.getVersion(),
    updatesSupported: app.isPackaged && !is.dev
  }))

  ipcMain.handle(IPC.APP_UPDATE_CHECK, async () => manualCheckForUpdates())

  ipcMain.handle(IPC.OPEN_PATH_IN_EXPLORER, async (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(8192).safeParse(raw)
    if (!parsed.success) return { ok: false, error: 'Invalid path' }
    const target = parsed.data
    try {
      if (!existsSync(target)) return { ok: false, error: 'Path does not exist' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const err = await shell.openPath(target)
    if (err) return { ok: false, error: err }
    return { ok: true }
  })

  ipcMain.handle(IPC.HARDWARE_SUMMARY, (_e, destDir?: unknown) => {
    const base = modelsDir()
    let diskPath = base
    if (typeof destDir === 'string') {
      const t = destDir.trim()
      if (t && existsSync(t)) diskPath = t
    }
    return collectHardwareSummary(diskPath)
  })

  ipcMain.handle(IPC.GET_CONFIG, async () => {
    await ensureAutoDetectedPythonInStore(store)
    migrateRoleSetupIfNeeded(store)
    const showElectronDevMainView =
      !app.isPackaged || String(process.env.LOCAL_LLM_FORCE_DEV_UI ?? '').trim() === '1'
    return {
      ...store.store,
      hfTokenSet: !!getHfToken(),
      showElectronDevMainView
    }
  })

  ipcMain.handle(IPC.SET_CONFIG, (_e, raw: unknown) => {
    const parsed = configSchema.partial().safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    const remoteAgentUrl = parsed.data.agentRemoteOllamaUrl
    if (typeof remoteAgentUrl === 'string' && remoteAgentUrl.trim()) {
      try {
        assertSelfHostedOllamaBaseUrl(remoteAgentUrl)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    const reloadIntegration = Object.keys(parsed.data).some(
      (k) => k === 'integrationListenEnabled' || k === 'integrationPort' || k === 'integrationToken'
    )
    const configPatch = { ...parsed.data }
    if (configPatch.ideJourneyChecklist !== undefined) {
      const checklistPatch =
        configPatch.ideJourneyChecklist && typeof configPatch.ideJourneyChecklist === 'object'
          ? configPatch.ideJourneyChecklist
          : {}
      store.set(
        'ideJourneyChecklist',
        mergeIdeJourneyChecklist(store.get('ideJourneyChecklist'), checklistPatch)
      )
      delete configPatch.ideJourneyChecklist
    }
    Object.entries(configPatch).forEach(([k, v]) => {
      if (v === undefined || k === 'hfTokenEncrypted') return
      if (k === 'llamaPythonPath' && typeof v === 'string' && !v.trim()) {
        resetPythonAutoDetectSession()
      }
      if (k === 'modelsDir' && v === null) {
        store.delete('modelsDir')
        return
      }
      if (k === 'architectureRepositoryScanRoot' && (v === null || v === '')) {
        store.delete('architectureRepositoryScanRoot')
        return
      }
      if (k === 'llamaChatMaxTokens' && v === null) {
        store.delete('llamaChatMaxTokens')
        return
      }
      store.set(k, v as never)
    })
    if (reloadIntegration) {
      configureIntegrationServer({
        store,
        getRuntime,
        getDb: () => db,
        getOntology: () => ontology
      })
    }
    return { ok: true }
  })

  ipcMain.handle(IPC.PICK_MODELS_DIRECTORY, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle(IPC.ARCHITECTURE_REPO_PICK_ROOT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  const architectureRepoScanSchema = z
    .object({
      rootPath: z.string().min(1).max(8192).optional()
    })
    .optional()

  ipcMain.handle(IPC.ARCHITECTURE_REPO_SCAN, (_event, payload: unknown) => {
    const parsed = architectureRepoScanSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: 'Invalid payload' } as const
    }
    const rootOverride = parsed.data?.rootPath?.trim()
    const raw = store.get('architectureRepositoryScanRoot')
    const root = rootOverride?.length ? rootOverride : typeof raw === 'string' ? raw.trim() : ''
    if (!root) {
      return {
        ok: false,
        error:
          'Architecture Repository scan root is not set. Use “Choose workspace folder” to select a codebase directory.'
      } as const
    }
    try {
      const result = scanArchitectureRepository(root)
      return { ok: true, result } as const
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logLine('warn', 'architecture_repo_scan_failed', { root, error: msg })
      return { ok: false, error: msg } as const
    }
  })

  const formalVerificationLocks = new Set<string>()
  const formalInterpretLocks = new Set<string>()

  function sendFormalVerificationProgress(payload: FormalVerificationProgressPayload): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.CODEBASE_FORMAL_VERIFICATION_PROGRESS, payload)
      }
    }
  }

  function sendCodebaseWikiAnalysisProgress(payload: CodebaseWikiAnalysisProgress): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.CODEBASE_WIKI_ANALYSIS_PROGRESS, payload)
      }
    }
  }

  ipcMain.handle(IPC.CODEBASE_FORMAL_GET, () => readCodebaseFormalBundle(store))

  ipcMain.handle(IPC.CODEBASE_FORMAL_PICK_ROOT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  const formalAddCodebaseSchema = z.object({
    rootPath: z.string().min(1).max(8192),
    displayName: z.string().max(400).optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_ADD, (_e, raw: unknown) => {
    const parsed = formalAddCodebaseSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const rec = addManualCodebase(store, parsed.data.rootPath, parsed.data.displayName)
    if (!rec) return { ok: false as const, error: 'Path is not an existing directory.' }
    return { ok: true as const, record: rec }
  })

  const formalAddGitCodebaseSchema = z.object({
    gitUrl: z.string().min(4).max(2048),
    displayName: z.string().max(400).optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_ADD_GIT, (_e, raw: unknown) => {
    const parsed = formalAddGitCodebaseSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const r = addCodebaseFromGitUrl({
      store,
      userData,
      gitUrl: parsed.data.gitUrl,
      displayName: parsed.data.displayName
    })
    if (!r.ok) return { ok: false as const, error: r.error }
    const bundle = readCodebaseFormalBundle(store)
    const rec = bundle.codebases.find((c) => c.id === r.recordId)
    if (!rec) return { ok: false as const, error: 'Codebase registered but could not reload record.' }
    return { ok: true as const, record: rec }
  })

  const codebaseWikiAnalyzeSchema = z.object({
    codebaseId: z.string().uuid()
  })

  ipcMain.handle(IPC.CODEBASE_WIKI_ANALYZE, async (_e, raw: unknown) => {
    const parsed = codebaseWikiAnalyzeSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    try {
      const snapshot = await runCodebaseWikiAnalysis({
        db,
        store,
        getRuntime,
        codebaseId: parsed.data.codebaseId,
        onProgress: sendCodebaseWikiAnalysisProgress
      })
      safeRecordLearningEvent({
        source: 'electron',
        actor: 'assistant',
        interactionType: 'tool_outcome',
        payloadRef: `codebase-analysis:${snapshot.codebaseId}:${snapshot.id}`,
        summary: `Codebase wiki enrichment for ${snapshot.rootPath}`,
        details: {
          domainModelCount: snapshot.domainModel.length,
          designPatternCount: snapshot.designPatterns.length,
          architecturePatternCount: snapshot.architecturePatterns.length
        }
      })
      return { ok: true as const, snapshot }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendCodebaseWikiAnalysisProgress({ phase: 'error', message: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IPC.CODEBASE_WIKI_ANALYSIS_LATEST, () => listLatestCodebaseAnalysisSnapshots(db))

  const formalUpdateCodebaseSchema = z.object({
    id: z.string().uuid(),
    displayName: z.string().max(400).optional(),
    disabled: z.boolean().optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_UPDATE, (_e, raw: unknown) => {
    const parsed = formalUpdateCodebaseSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const rec = updateCodebase(store, parsed.data.id, {
      displayName: parsed.data.displayName,
      disabled: parsed.data.disabled
    })
    if (!rec) return { ok: false as const, error: 'Codebase not found.' }
    return { ok: true as const, record: rec }
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_REMOVE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const, error: 'Invalid id' }
    const ok = removeCodebase(store, id.trim())
    return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'Codebase not found.' } as const)
  })

  const formalProfileAddSchema = z.object({
    label: z.string().min(1).max(200),
    commandTemplate: z.string().min(1).max(8000),
    spawnMode: z.enum(['shell', 'exec']).optional(),
    timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
    expectedExitCodes: z.array(z.number().int()).min(1).max(24).optional(),
    interpretWithLlm: z.boolean().optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_PROFILE_ADD, (_e, raw: unknown) => {
    const parsed = formalProfileAddSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid profile' }
    const profile: FormalToolProfile = {
      id: randomUUID(),
      label: parsed.data.label,
      commandTemplate: parsed.data.commandTemplate,
      spawnMode: parsed.data.spawnMode ?? (process.platform === 'win32' ? 'shell' : 'exec'),
      timeoutMs: parsed.data.timeoutMs ?? DEFAULT_FORMAL_TOOL_TIMEOUT_MS,
      expectedExitCodes: parsed.data.expectedExitCodes ?? [0],
      ...(typeof parsed.data.interpretWithLlm === 'boolean' ? { interpretWithLlm: parsed.data.interpretWithLlm } : {})
    }
    addFormalProfile(store, profile)
    return { ok: true as const, profile }
  })

  const formalProfileUpdateSchema = z.object({
    id: z.string().uuid(),
    interpretWithLlm: z.enum(['inherit', 'on', 'off'])
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_PROFILE_UPDATE, (_e, raw: unknown) => {
    const parsed = formalProfileUpdateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const profile = updateFormalProfile(store, parsed.data.id, {
      interpretWithLlm: parsed.data.interpretWithLlm
    })
    if (!profile) return { ok: false as const, error: 'Profile not found.' }
    return { ok: true as const, profile }
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_PROFILE_REMOVE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const, error: 'Invalid id' }
    const ok = removeFormalProfile(store, id.trim())
    return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'Profile not found.' } as const)
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_LIST, () => {
    const bundle = readCodebaseFormalBundle(store)
    return [...bundle.formalVerificationRuns].sort((a, b) => b.startedAt - a.startedAt)
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_GET, (_e, runId: unknown) => {
    if (typeof runId !== 'string' || !runId.trim()) return null
    const bundle = readCodebaseFormalBundle(store)
    return bundle.formalVerificationRuns.find((r) => r.id === runId.trim()) ?? null
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_EXPORT_JSON, (_e, runId: unknown) => {
    if (typeof runId !== 'string' || !runId.trim()) return { ok: false as const, error: 'Invalid id' }
    const bundle = readCodebaseFormalBundle(store)
    const run = bundle.formalVerificationRuns.find((r) => r.id === runId.trim())
    if (!run) return { ok: false as const, error: 'Run not found.' }
    const payload = {
      disclaimer:
        'Tool-backed bounded formal assurance only. Verdict reflects the configured external command exit code, not universal program correctness.',
      exportedAt: new Date().toISOString(),
      run
    }
    return { ok: true as const, json: JSON.stringify(payload, null, 2) }
  })

  const formalInterpretRunSchema = z.object({
    runId: z.string().uuid(),
    includeContext: z.boolean().optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_INTERPRET_RUN, async (_e, raw: unknown) => {
    const parsed = formalInterpretRunSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const runId = parsed.data.runId
    if (formalInterpretLocks.has(runId)) {
      return { ok: false as const, error: 'Interpretation already in progress for this run.' }
    }
    formalInterpretLocks.add(runId)
    try {
      const bundle = readCodebaseFormalBundle(store)
      const run = bundle.formalVerificationRuns.find((r) => r.id === runId)
      if (!run) return { ok: false as const, error: 'Run not found.' }
      if (run.status === 'running') {
        return { ok: false as const, error: 'Run is still in progress.' }
      }
      const profile = bundle.formalToolProfiles.find((p) => p.id === run.profileId)
      const codebase = bundle.codebases.find((c) => c.id === run.codebaseId)
      if (!profile || !codebase) return { ok: false as const, error: 'Profile or codebase missing.' }
      const includeContext = parsed.data.includeContext === true
      const next = await attachFormalRunLlmAdvisory({
        store,
        db,
        getRuntime,
        run,
        profile,
        codebase,
        includeContext
      })
      updateFormalRun(store, next)
      sendFormalVerificationProgress({ runId, phase: 'finished', run: next })
      return { ok: true as const, run: next }
    } finally {
      formalInterpretLocks.delete(runId)
    }
  })

  const formalRunStartSchema = z.object({
    codebaseId: z.string().uuid(),
    profileId: z.string().uuid()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_START, (_event, raw: unknown) => {
    const parsed = formalRunStartSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const { codebaseId, profileId } = parsed.data
    if (formalVerificationLocks.has(codebaseId)) {
      return { ok: false as const, error: 'A verification run is already in progress for this codebase.' }
    }
    const bundle = readCodebaseFormalBundle(store)
    const codebase = bundle.codebases.find((c) => c.id === codebaseId)
    const profile = bundle.formalToolProfiles.find((p) => p.id === profileId)
    if (!codebase) return { ok: false as const, error: 'Codebase not found.' }
    if (!profile) return { ok: false as const, error: 'Profile not found.' }
    if (codebase.disabled) return { ok: false as const, error: 'Codebase is disabled.' }

    const cwd = resolve(codebase.rootPath.trim())
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return { ok: false as const, error: 'Codebase directory no longer exists.' }
    }

    const commandResolved = expandCommandTemplate(profile.commandTemplate, cwd)
    const runId = randomUUID()
    const startedAt = Date.now()
    const baseRun: FormalVerificationRun = {
      id: runId,
      codebaseId,
      profileId,
      startedAt,
      status: 'running',
      exitCode: null,
      stdout: '',
      stderr: '',
      commandResolved
    }

    formalVerificationLocks.add(codebaseId)
    appendFormalRun(store, baseRun)
    sendFormalVerificationProgress({ runId, phase: 'started', run: baseRun })

    void (async () => {
      const maybeInterpret = async (run: FormalVerificationRun): Promise<FormalVerificationRun> => {
        if (!shouldAutoInterpretFormalRun(store, profile)) return run
        const includeContext = shouldIncludeKbContext(store)
        return attachFormalRunLlmAdvisory({
          store,
          db,
          getRuntime,
          run,
          profile,
          codebase,
          includeContext
        })
      }
      try {
        const expectedExitCodes =
          profile.expectedExitCodes.length > 0 ? profile.expectedExitCodes : [0]
        const timeoutMs =
          typeof profile.timeoutMs === 'number' && profile.timeoutMs > 0
            ? profile.timeoutMs
            : DEFAULT_FORMAL_TOOL_TIMEOUT_MS
        const result = await runFormalVerificationJob({
          commandResolved,
          cwd,
          spawnMode: profile.spawnMode,
          timeoutMs,
          expectedExitCodes
        })
        let final = finalizeRunRow(baseRun, result)
        updateFormalRun(store, final)
        final = await maybeInterpret(final)
        updateFormalRun(store, final)
        sendFormalVerificationProgress({ runId, phase: 'finished', run: final })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        let failed: FormalVerificationRun = {
          ...baseRun,
          finishedAt: Date.now(),
          status: 'failed',
          exitCode: null,
          stdout: '',
          stderr: msg.slice(0, 8000)
        }
        updateFormalRun(store, failed)
        failed = await maybeInterpret(failed)
        updateFormalRun(store, failed)
        sendFormalVerificationProgress({ runId, phase: 'finished', run: failed })
      } finally {
        formalVerificationLocks.delete(codebaseId)
      }
    })()

    return { ok: true as const, runId }
  })

  const confirmDestructivePayload = z.object({
    message: z.string().min(1).max(4000),
    detail: z.string().max(12000).optional(),
    confirmLabel: z.string().min(1).max(80).optional()
  })

  ipcMain.handle(IPC.APP_CONFIRM_DESTRUCTIVE, async (event, raw: unknown) => {
    const parsed = confirmDestructivePayload.safeParse(raw)
    if (!parsed.success) throw new Error('Invalid confirm payload')
    const { message, detail, confirmLabel } = parsed.data
    const win =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
    const label = confirmLabel ?? 'OK'
    const opts: MessageBoxOptions = {
      type: 'warning',
      buttons: ['Cancel', label],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message,
      detail: detail?.trim() ? detail.trim() : undefined
    }
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    return r.response === 1
  })

  ipcMain.handle(IPC.LOG, (_e, level: string, msg: string, meta?: Record<string, unknown>) => {
    logLine(level, msg, meta)
  })

  ipcMain.handle(IPC.HF_SEARCH, async (_e, query: string, limit?: number) => {
    return hfSearch(query, limit ?? 30, getHfToken())
  })

  ipcMain.handle(IPC.HF_RECOMMENDED, async (_e, limit?: number) => {
    return hfRecommended(limit ?? 24, getHfToken())
  })

  ipcMain.handle(IPC.HF_MODEL_INFO, async (_e, repoId: string) => {
    return hfModelDetail(db, repoId, getHfToken())
  })

  const hfDownloadPayload = z.object({
    repoId: z.string().min(1),
    revision: z.string().optional(),
    filename: z.string().min(1),
    destDir: z.string().optional(),
    chatDisplayName: z.string().max(240).optional()
  })

  ipcMain.handle(IPC.HF_DOWNLOAD, async (_e, raw: unknown) => {
    const payload = hfDownloadPayload.parse(raw)
    const destBase = payload.destDir ?? modelsDir()
    if (!existsSync(destBase)) mkdirSync(destBase, { recursive: true })
    const revision = payload.revision || 'main'
    const destPath = hfDownloadAbsolutePath(destBase, payload.repoId, revision, payload.filename)
    const hfFilename = payload.filename.replace(/\\/g, '/')
    const job = {
      id: randomUUID(),
      repoId: payload.repoId,
      revision,
      destPath,
      status: 'pending' as const,
      progress: 0,
      bytesReceived: 0,
      bytesTotal: 0,
      hfFilename,
      chatDisplayName:
        payload.chatDisplayName?.trim() ||
        `${payload.repoId} · ${basename(hfFilename)}`
    }
    const token = getHfToken()
    const url = hfResolveDownloadUrl(payload.repoId, revision, hfFilename)

    startDownload(
      db,
      { ...job, status: 'downloading' },
      async () => url,
      () => {},
      token
    )
    return job
  })

  ipcMain.handle(IPC.HF_DOWNLOAD_STATUS, (_e, jobId: string) => {
    const j = getActiveDownload(jobId)
    if (j) return j
    const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(jobId)
    return row ?? null
  })

  ipcMain.handle(IPC.HF_CANCEL_DOWNLOAD, (_e, jobId: string) => {
    if (cancelDownload(jobId)) return { ok: true as const }
    const row = db
      .prepare('SELECT local_path, status FROM downloads WHERE id = ?')
      .get(jobId) as { local_path: string; status: string } | undefined
    if (row?.status === 'downloading') {
      db.prepare('DELETE FROM downloads WHERE id = ?').run(jobId)
      try {
        if (existsSync(row.local_path)) unlinkSync(row.local_path)
      } catch {
        /* ignore */
      }
      return { ok: true as const }
    }
    return { ok: false as const }
  })

  ipcMain.handle(IPC.DOWNLOADS_LIST, () => listDownloadsWithProgress(db))

  ipcMain.handle(IPC.CLEAR_DOWNLOAD_CACHE, () => clearDownloadRegistryAndHfCache(db))

  ipcMain.handle(IPC.CLEAR_ALL_CACHES, () => {
    const vectorsDir = join(userData, 'vectors')
    return clearAllAppCaches(db, vectorsDir)
  })

  ipcMain.handle(IPC.DELETE_ALL_MODELS, async () => {
    await getRuntime()?.stop()
    setRuntime(null)
    cancelAllActiveDownloads()
    const dir = modelsDir()
    const r = deleteAllChildrenInDirectory(dir)
    const downloadsRemoved = db.prepare('DELETE FROM downloads').run().changes
    logLine('info', 'all_models_deleted', { dir, removed: r.removed, errors: r.errors, downloadsRemoved })
    return { ...r, downloadsRemoved }
  })

  ipcMain.handle(IPC.RESET_FACTORY_CONFIG, async () => {
    await getRuntime()?.stop()
    setRuntime(null)
    cancelAllActiveDownloads()
    resetElectronStoreToFactory(store)
    resetPythonAutoDetectSession()
    setHfToken(undefined)
    logLine('info', 'factory_config_reset')
    return { ok: true as const }
  })

  ipcMain.handle(IPC.RUNTIME_LIST, () => [
    { id: 'llamacpp', label: 'llama.cpp server' },
    { id: 'ollama', label: 'Ollama (local daemon)' }
  ])

  const listLocalModelsPayload = z.object({
    additionalRoots: z.array(z.string().max(4096)).max(32).optional()
  })

  ipcMain.handle(IPC.RUNTIME_LIST_LOCAL_MODELS, (_e, raw?: unknown) => {
    const parsed = listLocalModelsPayload.safeParse(raw ?? {})
    const extraRaw = parsed.success ? (parsed.data.additionalRoots ?? []) : []

    const rootSet = new Set<string>()
    const tryAddRoot = (p: string): void => {
      const t = p.trim()
      if (!t) return
      try {
        const abs = resolve(t)
        if (!existsSync(abs)) return
        if (!statSync(abs).isDirectory()) return
        rootSet.add(abs)
      } catch {
        /* ignore */
      }
    }

    tryAddRoot(modelsDir())
    for (const x of extraRaw) tryAddRoot(x)

    const pathByKey = new Map<string, string>()
    const keyOf = (p: string): string =>
      process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p
    for (const root of rootSet) {
      for (const p of listGgufModelsInDir(root)) {
        const k = keyOf(p)
        if (!pathByKey.has(k)) pathByKey.set(k, p)
      }
    }
    const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()
    const paths = [...pathByKey.values()].sort((a, b) => norm(a).localeCompare(norm(b)))
    return { modelsDir: modelsDir(), paths }
  })

  ipcMain.handle(IPC.RUNTIME_OLLAMA_TAGS, async () => {
    const raw = (store.get('ollamaBaseUrl') as string | undefined)?.trim()
    const ollamaBase = raw || 'http://127.0.0.1:11434'
    return fetchOllamaModelTags(ollamaBase)
  })

  ipcMain.handle(IPC.RUNTIME_OLLAMA_PULL, async (event, raw: unknown) => {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name || name.length > 256) throw new Error('Model name must be 1–256 characters.')
    const ollamaBase = (store.get('ollamaBaseUrl') as string | undefined)?.trim() || 'http://127.0.0.1:11434'
    const send = (p: RuntimeLoadProgress): void => {
      event.sender.send(IPC.OLLAMA_PULL_PROGRESS, p)
    }
    await ensureOllamaModelInLibrary(ollamaBase, name, send)
    return { ok: true as const }
  })

  ipcMain.handle(IPC.RUNTIME_DELETE_LOCAL_GGUF, async (_e, raw: unknown) => {
    const parsed = z.string().min(1).safeParse(raw)
    if (!parsed.success) throw new Error('File path required.')
    const abs = resolve(parsed.data.replace(/^file:\/\//i, ''))
    const root = resolve(modelsDir())
    const norm = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
    const absN = norm(abs)
    const rootN = norm(root)
    if (absN !== rootN && !absN.startsWith(`${rootN}/`)) {
      throw new Error('That file is outside your configured models folder.')
    }
    if (!/\.(gguf|safetensors|safetensor)$/i.test(abs)) {
      throw new Error('Only .gguf, .safetensors, or .safetensor files can be deleted here.')
    }
    if (!existsSync(abs)) throw new Error('File not found (it may already be deleted).')
    const rt = getRuntime()
    const st = rt?.getStatus()
    if (st?.running && st.kind === 'llamacpp' && st.modelPath?.trim()) {
      const loadedRes = resolve(st.modelPath.trim().replace(/^file:\/\//i, ''))
      if (norm(loadedRes) === absN) {
        throw new Error('Unload this model before deleting its file.')
      }
    }
    unlinkSync(abs)
    try {
      const removed = db.prepare('DELETE FROM downloads WHERE local_path = ?').run(abs).changes
      if (removed > 0) logLine('info', 'download_registry_row_removed', { path: abs })
    } catch (e) {
      logLine('warn', 'download_registry_delete_failed', {
        path: abs,
        error: e instanceof Error ? e.message : String(e)
      })
    }
    logLine('info', 'deleted_local_weight_file', { path: abs })
    return { ok: true as const }
  })

  ipcMain.handle(IPC.RUNTIME_DELETE_OLLAMA_MODEL, async (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(512).safeParse(raw)
    if (!parsed.success) throw new Error('Model name required.')
    const name = parsed.data.trim()
    const rawBase = (store.get('ollamaBaseUrl') as string | undefined)?.trim()
    const ollamaBase = rawBase || 'http://127.0.0.1:11434'
    const rt = getRuntime()
    const st = rt?.getStatus()
    if (st?.running && st.kind === 'ollama' && st.modelPath?.trim()) {
      const loaded = st.modelPath.trim()
      if (ollamaTagConflictsWithLoaded(loaded, name)) {
        throw new Error('Unload this model before deleting it from Ollama.')
      }
    }
    const r = await deleteOllamaModel(ollamaBase, name)
    if (!r.ok) throw new Error(r.error)
    logLine('info', 'deleted_ollama_model', { model: name })
    return { ok: true as const }
  })

  ipcMain.handle(IPC.RUNTIME_INSTALL_PATH, async () => {
    const configured = (store.get('llamaBinaryPath') as string | undefined) ?? ''
    const trimmed = configured.trim()
    const configuredValid = Boolean(trimmed && existsSync(trimmed))
    const resolved = resolveLlamaBinary(configured.trim() ? configured : undefined)
    const ollamaBase = (store.get('ollamaBaseUrl') as string | undefined) ?? 'http://127.0.0.1:11434'
    const ollamaReachable = await probeOllamaReachable(ollamaBase)
    let llamaBinaryValid = false
    let llamaValidateError: string | null = null
    if (resolved) {
      const v = await validateLlamaServerBinary(resolved)
      llamaBinaryValid = v.ok
      llamaValidateError = v.ok ? null : v.error
    }
    return {
      llamaBinary: configured,
      ollamaBase,
      llamaResolvedPath: resolved ?? '',
      llamaDetected: Boolean(resolved),
      llamaConfiguredPathValid: configuredValid,
      llamaBinaryValid,
      llamaValidateError,
      ollamaReachable
    }
  })

  ipcMain.handle(IPC.RUNTIME_INSTALL_OLLAMA, async (event) => {
    const raw = (store.get('ollamaBaseUrl') as string | undefined)?.trim()
    const ollamaBase = raw || 'http://127.0.0.1:11434'
    if (!raw) store.set('ollamaBaseUrl', ollamaBase)
    const sendProgress = (message: string): void => {
      event.sender.send(IPC.RUNTIME_INSTALL_OLLAMA_PROGRESS, { message })
    }
    return installOllamaForPlatform(ollamaBase, sendProgress)
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL_URL, (_e, raw: unknown) => {
    const parsed = z.string().url().safeParse(raw)
    if (!parsed.success || !parsed.data.startsWith('https://')) {
      throw new Error('Only https URLs are allowed')
    }
    void shell.openExternal(parsed.data)
    return { ok: true as const }
  })

  ipcMain.handle(IPC.APP_SAVE_INTELLIJ_PLUGIN_ZIP, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return await saveIntellijPluginZipWithDialog(win)
  })

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (event, opts: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => {
      const existing = getRuntime()
      if (existing?.getStatus().running) {
        throw new Error('A model is already loaded. Unload it before loading another.')
      }
      await existing?.stop()
      setRuntime(null)
      const adapter = createRuntime(opts.kind, {
        ollamaBaseUrl: (store.get('ollamaBaseUrl') as string | undefined) ?? 'http://127.0.0.1:11434'
      })
      const configuredBin = store.get('llamaBinaryPath') as string | undefined
      const binaryPath =
        opts.kind === 'llamacpp'
          ? resolveLlamaBinary(typeof configuredBin === 'string' ? configuredBin : undefined)
          : undefined
      if (opts.kind === 'llamacpp') {
        if (!binaryPath) {
          throw new Error(
            'No llama-server binary is configured. Open Run, set the path to llama-server (or install it on your PATH), then try again.'
          )
        }
        const v = await validateLlamaServerBinary(binaryPath, { bypassCache: true })
        if (!v.ok) {
          throw new Error(v.error)
        }
      }
      const sendLoad = (p: RuntimeLoadProgress): void => {
        event.sender.send(IPC.RUNTIME_LOAD_PROGRESS, p)
      }
      let modelPathForLoad = opts.modelPath.trim()
      let displayModelPath: string | undefined
      if (opts.kind === 'llamacpp' && isSafetensorsWeightFilePath(modelPathForLoad)) {
        await ensureAutoDetectedPythonInStore(store)
        const configuredTrim = (typeof configuredBin === 'string' ? configuredBin : '').trim()
        const primaryBin = (binaryPath ?? configuredTrim) || undefined
        const alternateBins: string[] = []
        if (configuredTrim && primaryBin && llamaPathsDiffer(configuredTrim, primaryBin)) {
          alternateBins.push(configuredTrim)
        }
        const r = await ensureGgufForSafetensorsModelPath({
          weightPath: modelPathForLoad,
          userData,
          llamaBinaryPath: primaryBin,
          llamaBinaryAlternatePaths: alternateBins.length ? alternateBins : undefined,
          convertScriptConfigured: store.get('llamaConvertScriptPath') as string | undefined,
          pythonConfigured: store.get('llamaPythonPath') as string | undefined,
          onProgress: sendLoad
        })
        modelPathForLoad = r.loadPath
        displayModelPath = r.displayPath
      }
      const rawCtx = store.get('llamaContextTokens')
      const llamaContextTokens =
        typeof rawCtx === 'number' && Number.isFinite(rawCtx)
          ? clampLlamaContextTokens(rawCtx)
          : LLAMA_CONTEXT_TOKENS_DEFAULT
      try {
        await adapter.start({
          modelPath: modelPathForLoad,
          displayModelPath,
          binaryPath,
          port: (store.get('llamaPort') as number | undefined) ?? 8080,
          ...(opts.kind === 'llamacpp'
            ? {
                defaultPredictTokens: llamaChatMaxCompletionTokensFromStore(store),
                contextTokens: llamaContextTokens
              }
            : {}),
          onLoadProgress: sendLoad
        })
      } catch (e) {
        try {
          await adapter.stop()
        } catch {
          /* ignore stop errors after failed start */
        }
        setRuntime(null)
        throw e
      }
      setRuntime(adapter)
      store.set('runtimeKind', opts.kind)
      return adapter.getStatus()
    }
  )

  ipcMain.handle(IPC.RUNTIME_STOP, async () => {
    await getRuntime()?.stop()
    setRuntime(null)
    return { running: false, kind: 'none' as const }
  })

  ipcMain.handle(IPC.RUNTIME_STATUS, () => getRuntime()?.getStatus() ?? { running: false, kind: 'none' as const })

  ipcMain.handle(
    IPC.RUNTIME_CHAT,
    async (
      event,
      payload: {
        messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
        requestId?: string
        /** When set, clamps to 1…262144. Composer suggestions pass small values (e.g. 96). */
        maxTokens?: number
        ollamaModel?: string
        ollamaBaseUrl?: string
      }
    ) => {
      const rt = getRuntime()
      if (!rt) throw new Error('Runtime not started')
      const st = rt.getStatus()
      if (st.kind === 'llamacpp' && !st.running) {
        throw new Error(
          'llama-server is not running. It may have crashed while loading the model — open Run and press Start again, or verify the model file path and port.'
        )
      }
      const chatMaxTokens = resolveChatMaxCompletionTokens(
        store,
        payload.maxTokens,
        st.kind === 'llamacpp' ? 'llamacpp' : st.kind === 'ollama' ? 'ollama' : undefined
      )
      const ollamaModel =
        typeof payload.ollamaModel === 'string' && payload.ollamaModel.trim() ? payload.ollamaModel.trim() : undefined
      let ollamaBaseUrl: string | undefined
      if (typeof payload.ollamaBaseUrl === 'string' && payload.ollamaBaseUrl.trim()) {
        const u = payload.ollamaBaseUrl.trim().slice(0, 2048)
        if (!/^https?:\/\//i.test(u)) {
          throw new Error('Agent remote Ollama URL must start with http:// or https://')
        }
        assertSelfHostedOllamaBaseUrl(u)
        ollamaBaseUrl = u
      }
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : ''
      const emit = (
        data:
          | { kind: 'started' }
          | { kind: 'token'; text: string }
          | { kind: 'error'; message: string }
          | { kind: 'usage'; promptTokens?: number; completionTokens?: number }
      ): void => {
        if (!requestId) return
        event.sender.send(IPC.RUNTIME_CHAT_PROGRESS, { requestId, ...data })
      }
      try {
        if (requestId) emit({ kind: 'started' })
        const result = await runIntegrationChatPipeline({
          store,
          db,
          runtime: rt,
          ontology,
          messages: payload.messages,
          maxTokensOverride: chatMaxTokens,
          ollamaModel,
          ollamaBaseUrl,
          ontologySourcePrefix: `runtime-chat:${requestId || Date.now()}`,
          progress: {
            onToken: (text: string) => {
              if (requestId) emit({ kind: 'token', text })
            }
          }
        })
        if (requestId) {
          emit({
            kind: 'usage',
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens
          })
        }
        return result.reply
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        emit({ kind: 'error', message })
        throw err
      }
    }
  )

  ipcMain.handle(IPC.CONVERSATIONS_LIST, () => chatService.listConversations(db))
  ipcMain.handle(IPC.CONVERSATION_CREATE, (_e, title?: string) => chatService.createConversation(db, title ?? ''))
  ipcMain.handle(IPC.CONVERSATION_MESSAGES, (_e, id: string) => chatService.listMessages(db, id))
  ipcMain.handle(IPC.CONVERSATION_RENAME, (_e, payload: unknown) => {
    const parsed = z
      .object({
        id: z.string().min(1),
        title: z.string().max(512)
      })
      .safeParse(payload)
    if (!parsed.success) throw new Error('Invalid conversation rename payload')
    const row = chatService.renameConversation(db, parsed.data.id, parsed.data.title)
    if (!row) throw new Error('Conversation not found')
    return row
  })
  ipcMain.handle(
    IPC.MESSAGE_APPEND,
    (
      _e,
      cid: string,
      role: 'user' | 'assistant' | 'system',
      content: string,
      modelId?: string,
      usage?: {
        promptTokens?: number
        completionTokens?: number
        promptIsEstimate?: boolean
        completionIsEstimate?: boolean
      }
    ) => {
      const row = chatService.appendMessage(db, cid, role, content, modelId, usage)
      if (role === 'user') {
        try {
          ontology.ingestText({
            text: content,
            sourceType: 'message_append_user',
            sourceRef: `chat:${cid}:${row.id}`,
            confidence: 0.65,
            entityType: 'user_input'
          })
        } catch {
          /* ontology is best-effort */
        }
        safeRecordLearningEvent({
          source: 'electron',
          actor: 'user',
          interactionType: 'chat_turn',
          payloadRef: `chat:${cid}:${row.id}`,
          summary: content.slice(0, 260),
          details: { role }
        })
        try {
          assignUserMessageToPromptDomains(db, row.id, content)
        } catch (e) {
          logLine('warn', 'prompt_domains_assign_failed', {
            message: e instanceof Error ? e.message : String(e)
          })
        }
        if (store.get('chatDomainEnhancement') === true) {
          const suffix = collectDomainSystemSuffixForMessage(db, row.id).trim()
          if (suffix) {
            return { ...row, promptDomainSuffix: suffix }
          }
        }
      }
      if (role === 'assistant') {
        try {
          ontology.ingestText({
            text: content,
            sourceType: 'message_append_assistant',
            sourceRef: `chat:${cid}:${row.id}`,
            confidence: 0.6,
            entityType: 'assistant_output'
          })
        } catch {
          /* ontology is best-effort */
        }
        safeRecordLearningEvent({
          source: 'electron',
          actor: 'assistant',
          interactionType: 'chat_turn',
          payloadRef: `chat:${cid}:${row.id}`,
          summary: content.slice(0, 260),
          details: { role, modelId: modelId ?? null }
        })
      }
      return row
    }
  )

  ipcMain.handle(
    IPC.PROMPT_DOMAIN_SET_SUFFIX,
    (_e, raw: unknown) => {
      const parsed = z
        .object({
          domainId: z.string().min(1),
          systemSuffix: z.string().max(MAX_PROMPT_DOMAIN_SUFFIX_CHARS)
        })
        .safeParse(raw)
      if (!parsed.success) throw new Error('Invalid prompt domain suffix payload')
      updatePromptDomainSystemSuffix(db, parsed.data.domainId, parsed.data.systemSuffix)
      return { ok: true as const }
    }
  )

  ipcMain.handle(IPC.TRAIN_BASE_FOR_FINETUNE_PATH, (_e, raw: unknown) => {
    const p = typeof raw === 'string' ? raw.trim() : ''
    if (!p) return { baseModelPath: null as string | null }
    const base = trainOrchestrator.findBaseModelForFinetuneArtifact(db, p)
    return { baseModelPath: base ?? null }
  })

  ipcMain.handle(
    IPC.MESSAGE_DELETE,
    (
      _e,
      payload: unknown
    ) => {
      const parsed = z
        .object({
          conversationId: z.string().min(1),
          messageId: z.string().min(1)
        })
        .safeParse(payload)
      if (!parsed.success) throw new Error('Invalid message delete payload')
      const ok = chatService.deleteMessage(db, parsed.data.conversationId, parsed.data.messageId)
      return { ok }
    }
  )

  ipcMain.handle(IPC.PROMPT_DOMAINS_LIST, () => listPromptDomains(db))

  ipcMain.handle(IPC.ONTOLOGY_STATS, () => ontology.getStats())

  ipcMain.handle(IPC.ONTOLOGY_QUERY_SUBGRAPH, (_e, raw: unknown) => {
    const parsed = z
      .object({
        query: z.string().max(2000).optional(),
        limitEntities: z.number().int().min(5).max(300).optional(),
        limitTriples: z.number().int().min(10).max(900).optional(),
        maxHops: z.number().int().min(1).max(3).optional(),
        typeFilters: z.array(z.string().max(120)).max(40).optional(),
        predicateFilters: z.array(z.string().max(120)).max(40).optional(),
        recentOnlyMs: z.number().int().min(1).max(31 * 24 * 60 * 60 * 1000).optional(),
        lodTier: z.enum(['overview', 'mid', 'detail']).optional(),
        focusNodeId: z.string().min(3).max(512).optional(),
        viewportHint: z
          .object({
            x0: z.number(),
            y0: z.number(),
            x1: z.number(),
            y1: z.number()
          })
          .optional(),
        maxEdgeDensity: z.number().min(0.05).max(1).optional()
      })
      .optional()
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid ontology query payload')
    return ontology.querySubgraph(parsed.data)
  })

  ipcMain.handle(IPC.ONTOLOGY_ENTITY_DETAILS, (_e, raw: unknown) => {
    const parsed = z
      .object({
        iri: z.string().min(3).max(512),
        limit: z.number().int().min(1).max(300).optional()
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid ontology entity details payload')
    return ontology.entityDetails(parsed.data.iri, parsed.data.limit)
  })

  ipcMain.handle(IPC.ONTOLOGY_REBUILD, () => ontology.rebuildSnapshot())
  ipcMain.handle(IPC.ONTOLOGY_EXPORT, () => ontology.exportJsonLd())

  ipcMain.handle(
    IPC.CONVERSATION_DELETE,
    (_e, payload: { id: string; removeLinkedKnowledge: boolean }) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (!id) throw new Error('conversation id required')
      const removeKb = Boolean(payload?.removeLinkedKnowledge)
      if (removeKb) kbService.deleteKbSourcesForConversation(db, id)
      chatService.deleteConversation(db, id)
      return { ok: true as const }
    }
  )

  ipcMain.handle(IPC.KB_INGEST_TEXT, (_e, title: string, uri: string, body: string) =>
    kbService.ingestText(db, title, uri, body)
  )

  ipcMain.handle(IPC.KB_INGEST_CONVERSATION, (_e, conversationId: string) => {
    if (typeof conversationId !== 'string' || !conversationId) throw new Error('conversation id required')
    return kbService.ingestConversationThread(db, conversationId)
  })

  ipcMain.handle(IPC.KB_INGEST_FILE, async (event) => {
    const emit = (payload: KbIngestFileProgress): void => {
      event.sender.send(IPC.KB_INGEST_FILE_PROGRESS, payload)
    }
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['txt', 'md', 'html', 'htm', 'pdf'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Text / Markdown', extensions: ['txt', 'md', 'html', 'htm'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) {
      emit({ kind: 'cancelled' })
      return null
    }
    const fp = r.filePaths[0]
    emit({ kind: 'selected', filePath: fp })
    try {
      return await kbService.ingestFile(db, fp, undefined, (p) => emit(p), getRuntime() ?? null)
    } catch (e) {
      emit({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      throw e
    }
  })
  ipcMain.handle(IPC.KB_INGEST_JOBS, (_e, limit?: number) => kbService.listIngestJobs(db, Number(limit) || 40))

  ipcMain.handle(IPC.KB_SOURCES, () => kbService.listSources(db))
  ipcMain.handle(IPC.KB_SEARCH, (_e, query: string, limit?: number) =>
    kbService.searchChunks(db, query, limit ?? 8).map((c) => c.text)
  )
  ipcMain.handle(IPC.KB_SEARCH_RETRIEVAL, (_e, raw: unknown) => {
    const parsed = z
      .object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(64).optional(),
        domainIds: z.array(z.string().min(1)).max(20).optional()
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid retrieval request payload')
    return kbService.searchKbHits(db, parsed.data.query, parsed.data.limit ?? 16).filter((hit) =>
      parsed.data.domainIds?.length ? parsed.data.domainIds.includes(hit.domainId ?? '') : true
    )
  })
  ipcMain.handle(IPC.KB_DOMAINS_LIST, (_e, limit?: number) => kbService.listKnowledgeDomains(db, Number(limit) || 120))
  ipcMain.handle(IPC.KB_SOURCE_SET_DOMAIN, (_e, raw: unknown) => {
    const parsed = z
      .object({
        sourceId: z.string().min(1),
        domainTitle: z.string().min(1).max(120)
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid source domain request payload')
    return kbService.setSourceDomain(db, parsed.data)
  })
  ipcMain.handle(IPC.KB_SEARCH_HITS, (_e, query: string, limit?: number) =>
    kbService.searchKbHits(db, query, limit ?? 16)
  )
  ipcMain.handle(IPC.KB_CHUNKS, (_e, sourceId: string) => kbService.listChunksForSource(db, sourceId))
  ipcMain.handle(IPC.KB_WIKI_TOPICS, () => kbService.listWikiTopics(db))
  ipcMain.handle(IPC.KB_WIKI_PAGE, (_e, sourceId: string) =>
    kbService.buildWikiPagePayload(db, sourceId)
  )
  ipcMain.handle(IPC.KB_WIKI_CLEANUP_ARTICLE, async (event, raw: unknown) => {
    const parsed = z
      .object({
        sourceId: z.string().min(1)
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid wiki cleanup request payload')
    const emit = (payload: WikiArticleCleanupProgress): void => {
      event.sender.send(IPC.KB_WIKI_CLEANUP_PROGRESS, payload)
    }
    emit({ kind: 'started', sourceId: parsed.data.sourceId })
    try {
      const summary = await kbService.cleanupWikiArticle(db, parsed.data.sourceId, getRuntime() ?? null, (progress) => {
        emit({
          kind: 'progress',
          sourceId: parsed.data.sourceId,
          stage: progress.stage,
          label: progress.label,
          progress: progress.progress
        })
      })
      emit({ kind: 'done', sourceId: parsed.data.sourceId, summary })
      return summary
    } catch (error) {
      emit({
        kind: 'error',
        sourceId: parsed.data.sourceId,
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  })
  ipcMain.handle(IPC.KB_WIKI_PASSAGES, (_e, sourceId: string) =>
    kbService.listWikiPassages(db, String(sourceId ?? '').trim())
  )
  ipcMain.handle(IPC.KB_WIKI_KEYWORDS, (_e, raw: unknown) => {
    const parsed = z
      .object({
        sourceId: z.string().min(1),
        chunkIds: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid wiki keyword request payload')
    return kbService.suggestWikiKeywords(db, parsed.data.sourceId, parsed.data.chunkIds, parsed.data.limit ?? 24)
  })
  ipcMain.handle(IPC.KB_WIKI_EXTRACT_ARTICLE, (_e, raw: unknown) => {
    const parsed = z
      .object({
        sourceId: z.string().min(1),
        keyword: z.string().min(1),
        chunkIds: z.array(z.string().min(1)).min(1),
        title: z.string().max(200).optional()
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid wiki extract request payload')
    return kbService.extractWikiArticlesFromSource(db, parsed.data as WikiExtractArticleRequest)
  })
  ipcMain.handle(IPC.KB_WIKI_RESOLVE_TERM, (_e, raw: unknown) => {
    const parsed = z
      .object({
        term: z.string().min(1).max(200),
        contextSourceId: z.string().min(1).optional(),
        contextSnippet: z.string().max(600).optional()
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid wiki term resolve payload')
    return kbService.resolveWikiTerm(db, parsed.data)
  })
  ipcMain.handle(IPC.KB_WIKI_HIGHLIGHT_TERMS, () => kbService.listWikiChatHighlightTerms(db))
  ipcMain.handle(IPC.KB_DELETE_SOURCE, (_e, sourceId: string) => {
    const id = typeof sourceId === 'string' ? sourceId.trim() : ''
    if (!id) throw new Error('source id required')
    kbService.deleteKbSource(db, id)
    return { ok: true as const }
  })
  ipcMain.handle(IPC.KB_RESET_WIKI_AND_KEYWORDS, () => kbService.resetEntireWikiAndKeywords(db))
  ipcMain.handle(IPC.KB_EXPORT_WIKI_ZIP, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const opts = {
      title: 'Export wiki as ZIP',
      defaultPath: `wiki-export-${iso}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false as const, canceled: true as const }
    let filePath = r.filePath
    if (!filePath.toLowerCase().endsWith('.zip')) filePath += '.zip'
    await kbService.exportWikiZip(db, filePath)
    return { ok: true as const, path: filePath }
  })
  ipcMain.handle(IPC.KB_KNOWLEDGE_GRAPH, () => kbService.getKnowledgeGraph(db))

  ipcMain.handle(IPC.KB_GRAPH_ANALYSIS_RUN, (_e, raw: unknown) => {
    const ingest =
      raw &&
      typeof raw === 'object' &&
      (raw as { ingestReport?: unknown }).ingestReport === true
    try {
      const payload = kbService.getKnowledgeGraph(db)
      const result = analyzeKnowledgeGraph(payload)
      const markdown = knowledgeGraphAnalysisToMarkdown(payload, result)
      let ingestedSourceId: string | undefined
      if (ingest) {
        const iso = new Date().toISOString().slice(0, 19).replace('T', ' ')
        const title = `Graph analysis · ${iso}`
        const uri = `analysis:kg:${Date.now()}`
        const src = kbService.ingestText(db, title, uri, markdown, undefined, null)
        ingestedSourceId = src.id
      }
      return { ok: true as const, result, markdown, ingestedSourceId }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IPC.KB_WIKI_REANALYZE_RUN, async (event) => {
    const rt = getRuntime()
    if (!rt?.getStatus().running) {
      return {
        ok: false as const,
        error: 'Runtime is not running. Start a model before reanalyzing the wiki.',
        processedSources: 0,
        processedEntries: 0,
        mergedEntries: 0,
        skippedSources: 0,
        modelId: 'none',
        promptVersion: 'n/a'
      }
    }
    try {
      const sender = event.sender
      const result = await runWikiReanalysisBatch({
        db,
        runtime: rt,
        onProgress: (payload: WikiReanalyzeProgress) => {
          sender.send(IPC.KB_WIKI_REANALYZE_PROGRESS, payload)
        }
      })
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return {
        ok: false as const,
        error: message,
        processedSources: 0,
        processedEntries: 0,
        mergedEntries: 0,
        skippedSources: 0,
        modelId: rt.getStatus().modelPath?.trim() || rt.kind,
        promptVersion: '2026-04-20.v1'
      }
    }
  })

  ipcMain.handle(IPC.KB_WIKI_EXTRACT_TURN, async (_e, raw: unknown) => {
    const parsed = z
      .object({
        conversationId: z.string().min(1),
        conversationTitle: z.string().max(512).optional(),
        userMessage: z.string(),
        assistantMessage: z.string()
      })
      .safeParse(raw)
    if (!parsed.success) throw new Error('Invalid wiki extract payload')

    if (store.get('wikiAutoExtract') === false) {
      return { ok: true as const, skipped: true, reason: 'disabled' }
    }

    const assistant = parsed.data.assistantMessage.trim()
    if (assistant.length < wikiExtractLimits.minAssistantChars) {
      return { ok: true as const, skipped: true, reason: 'short_reply' }
    }

    const rt = getRuntime()
    if (!rt?.getStatus().running) {
      return { ok: true as const, skipped: true, reason: 'no_runtime' }
    }

    try {
      const rawOut = await runWikiExtractChat(rt, parsed.data.userMessage, assistant)
      const distilled = parseWikiExtractResponse(rawOut)
      if (!('title' in distilled)) {
        return { ok: true as const, skipped: true, reason: 'nothing_to_save' }
      }
      const { title, body } = distilled
      const t = Date.now()
      const uri = `wiki-extract:${parsed.data.conversationId}:${t}`
      const displayTitle = title.replace(/\s+/g, ' ').trim() || 'Untitled'
      const source = kbService.ingestText(
        db,
        displayTitle,
        uri,
        body,
        undefined,
        parsed.data.conversationId
      )
      safeRecordLearningEvent({
        source: 'electron',
        actor: 'assistant',
        interactionType: 'wiki_extract',
        payloadRef: `kb:${source.id}`,
        summary: `Wiki extract: ${displayTitle}`,
        details: { conversationId: parsed.data.conversationId }
      })
      logLine('info', 'wiki_extract_ingested', { sourceId: source.id, conversationId: parsed.data.conversationId })
      return { ok: true as const, skipped: false, sourceId: source.id, title: displayTitle }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logLine('warn', 'wiki_extract_failed', { error: message })
      return { ok: false as const, skipped: false, error: message }
    }
  })

  ipcMain.handle(IPC.KB_DEEP_LEARN_RUN, async (event, raw: unknown) => {
    const parsed = z
      .object({
        jobId: z.string().min(1).max(128),
        conversationId: z.string().min(1),
        subject: z.string().min(1).max(500),
        userMessage: z.string().min(1).max(24_000),
        approvedFetchUrls: z.array(z.string().min(1).max(2048)).max(20)
      })
      .safeParse(raw)
    if (!parsed.success) {
      return { ok: false as const, error: 'Invalid deep learn payload' }
    }

    if (store.get('deepLearnEnabled') === false) {
      return {
        ok: false as const,
        error: 'Deep research is turned off in Settings → Chat generation.'
      }
    }

    for (const url of parsed.data.approvedFetchUrls) {
      const t = url.trim()
      if (!/^https?:\/\//i.test(t)) {
        return { ok: false as const, error: `Unsupported URL: ${t.slice(0, 120)}` }
      }
      try {
        assertUrlAllowedForDeepLearnFetch(t)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }

    const rt = getRuntime()
    if (!rt?.getStatus().running) {
      return { ok: false as const, error: 'Model is not running. Start the runtime first.' }
    }

    const maxRoundsRaw = store.get('deepLearnMaxRounds')
    const maxRounds =
      typeof maxRoundsRaw === 'number' && Number.isFinite(maxRoundsRaw)
        ? Math.min(24, Math.max(1, Math.floor(maxRoundsRaw)))
        : 5
    const maxBytesRaw = store.get('deepLearnMaxFetchBytes')
    const maxFetchBytes =
      typeof maxBytesRaw === 'number' && Number.isFinite(maxBytesRaw)
        ? Math.min(8_000_000, Math.max(4096, Math.floor(maxBytesRaw)))
        : 1_500_000

    const jobId = parsed.data.jobId
    event.sender.send(IPC.KB_DEEP_LEARN_PROGRESS, { kind: 'started', jobId })

    try {
      const r = await runDeepLearnResearch({
        db,
        store,
        rt,
        jobId,
        conversationId: parsed.data.conversationId,
        subject: parsed.data.subject,
        userMessage: parsed.data.userMessage,
        approvedFetchUrls: parsed.data.approvedFetchUrls.map((u) => u.trim()),
        maxRounds,
        maxFetchBytes,
        sendProgress: (p) =>
          event.sender.send(IPC.KB_DEEP_LEARN_PROGRESS, {
            jobId,
            ...p
          })
      })
      logLine('info', 'deep_learn_ingested', {
        sourceId: r.sourceId,
        conversationId: parsed.data.conversationId
      })
      safeRecordLearningEvent({
        source: 'electron',
        actor: 'assistant',
        interactionType: 'deep_learn',
        payloadRef: `kb:${r.sourceId}`,
        summary: `Deep learn: ${r.title}`,
        details: { conversationId: parsed.data.conversationId, roundsUsed: r.roundsUsed }
      })
      return {
        ok: true as const,
        sourceId: r.sourceId,
        title: r.title,
        roundsUsed: r.roundsUsed,
        fetchErrors: r.fetchErrors.length ? r.fetchErrors : undefined,
        lastExplorePaths: r.lastExplorePaths.length ? r.lastExplorePaths : undefined
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'cancelled' || msg.toLowerCase().includes('cancelled')) {
        event.sender.send(IPC.KB_DEEP_LEARN_PROGRESS, { kind: 'cancelled', jobId })
        return { ok: false as const, error: 'Cancelled', cancelled: true }
      }
      logLine('warn', 'deep_learn_failed', { error: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IPC.KB_DEEP_LEARN_CANCEL, (_e, raw: unknown) => {
    const p = z.object({ jobId: z.string().min(1).max(128) }).safeParse(raw)
    if (!p.success) return { ok: false as const }
    deepLearnCancelJob(p.data.jobId)
    return { ok: true as const }
  })

  ipcMain.handle(IPC.KB_DEEP_LEARN_RESUME, (_e, raw: unknown) => {
    const p = z
      .object({
        jobId: z.string().min(1).max(128),
        action: z.enum(['continue', 'finish']),
        followUp: z.string().max(4000).optional()
      })
      .safeParse(raw)
    if (!p.success) return { ok: false as const }
    if (p.data.action === 'finish') {
      resolveDeepLearnRoundChoice(p.data.jobId, { action: 'finish' })
    } else {
      resolveDeepLearnRoundChoice(p.data.jobId, {
        action: 'continue',
        followUp: p.data.followUp?.trim() || undefined
      })
    }
    return { ok: true as const }
  })

  ipcMain.handle(IPC.METRICS_SNAPSHOT, async (_e, opts?: { persist?: boolean }) => {
    if (opts?.persist === false) {
      return metricsService.peekSnapshot(getRuntime())
    }
    return metricsService.collectSnapshot(db, getRuntime())
  })
  ipcMain.handle(IPC.METRICS_HISTORY, (_e, limit?: number) => metricsService.recentHistory(db, limit ?? 60))

  ipcMain.handle(IPC.TRAIN_START, (_e, raw: unknown) => {
    const p = raw as {
      baseModelPath?: string
      datasetPath?: string
      kbSourceIds?: string[]
      displayName?: string
      domainId?: string
    }
    const base = typeof p.baseModelPath === 'string' ? p.baseModelPath.trim() : ''
    if (!base) throw new Error('Base model path is required (GGUF or model id you fine-tune from).')
    const kbSourceIds = Array.isArray(p.kbSourceIds)
      ? p.kbSourceIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined
    return trainOrchestrator.startTrainJob(db, userData, {
      baseModelPath: base,
      datasetPath: typeof p.datasetPath === 'string' && p.datasetPath.trim() ? p.datasetPath.trim() : undefined,
      kbSourceIds,
      displayName: typeof p.displayName === 'string' ? p.displayName : undefined,
      domainId: typeof p.domainId === 'string' && p.domainId.trim() ? p.domainId.trim() : undefined,
      modelsDir: modelsDir()
    })
  })

  ipcMain.handle(IPC.TRAIN_VALIDATE_START, (_e, raw: unknown) => {
    const p = z
      .object({
        baseModelPath: z.string().min(1)
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Base model path is required.')
    return trainOrchestrator.validateTrainStart(p.data.baseModelPath)
  })

  ipcMain.handle(IPC.TRAIN_STATUS, (_e, id: string) => trainOrchestrator.getTrainJob(db, id))
  ipcMain.handle(IPC.TRAIN_LIST_JOBS, () => trainOrchestrator.listTrainJobs(db))
  ipcMain.handle(IPC.TRAIN_RESCAN_ARTIFACT, (_e, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Job id is required')
    const r = trainOrchestrator.rescanTrainJobArtifacts(db, jobId.trim(), modelsDir())
    if (!r) throw new Error('Train job not found')
    return r
  })
  ipcMain.handle(IPC.TRAIN_REVIEW_QUEUE, (_e, raw?: unknown) => {
    const p = z
      .object({
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        domainId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(400).optional()
      })
      .safeParse(raw ?? {})
    if (!p.success) return listEvidenceCards(db, { limit: 120 })
    return listEvidenceCards(db, {
      status: p.data.status,
      domainId: p.data.domainId,
      limit: p.data.limit
    })
  })
  ipcMain.handle(IPC.TRAIN_REVIEW_SET_STATUS, (_e, raw: unknown) => {
    const p = z
      .object({
        cardId: z.string().uuid(),
        status: z.enum(['pending', 'approved', 'rejected'])
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid review status payload')
    const next = updateEvidenceCardStatus(db, p.data.cardId, p.data.status)
    if (!next) throw new Error('Evidence card not found')
    return next
  })
  ipcMain.handle(IPC.TRAIN_MANIFEST_PREVIEW, (_e, raw: unknown) => {
    const p = z
      .object({
        id: z.string().uuid().optional(),
        domainId: z.string().uuid().optional(),
        baseModelPath: z.string().min(1),
        datasetPath: z.string().min(1),
        outputDir: z.string().min(1),
        sourceIds: z.array(z.string().min(1)).optional()
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid manifest preview payload')
    return buildManifestFromApproved(db, {
      id: p.data.id ?? randomUUID(),
      domainId: p.data.domainId ?? null,
      baseModelPath: p.data.baseModelPath,
      datasetPath: p.data.datasetPath,
      outputDir: p.data.outputDir,
      sourceIds: p.data.sourceIds
    })
  })
  ipcMain.handle(IPC.TRAIN_DOMAIN_PROFILES_LIST, () => listDomainProfiles(db))
  ipcMain.handle(IPC.TRAIN_DOMAIN_PROFILE_UPSERT, (_e, raw: unknown) => {
    const p = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        terminology: z.array(z.string().min(1).max(64)).max(120),
        objective: z.string().max(1000).default(''),
        allowedSources: z.array(z.enum(['electron', 'intellij-plugin'])).min(1).max(2),
        retentionDays: z.number().int().min(1).max(3650).default(90)
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid domain profile payload')
    return upsertDomainProfile(db, p.data)
  })
  ipcMain.handle(IPC.TRAIN_DOMAIN_MODEL_VERSIONS, (_e, raw?: unknown) => {
    const p = z.object({ domainId: z.string().uuid().optional() }).safeParse(raw ?? {})
    return listDomainModelVersions(db, p.success ? p.data.domainId : undefined)
  })

  /** Persist HF token with safeStorage */
  ipcMain.handle(IPC.INTEGRATION_PLUGIN_REPORTS_LIST, () => getPluginReportHistory())

  ipcMain.handle(IPC.INTEGRATION_BRIDGE_SELF_TEST, async (_e, raw?: unknown): Promise<IntegrationBridgeSelfTestResult> => {
    const smokeChat =
      raw != null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as { smokeChat?: unknown }).smokeChat === true

    const enabled = store.get('integrationListenEnabled') === true
    const rawPort = store.get('integrationPort')
    const port =
      typeof rawPort === 'number' && Number.isFinite(rawPort)
        ? Math.min(65535, Math.max(1024, Math.floor(rawPort)))
        : 17373
    const steps: BridgeSelfTestStep[] = []

    if (!enabled) {
      return {
        ok: false,
        summary: 'IDE HTTP bridge is disabled. Turn it on under Settings → Integrations.',
        steps: [
          {
            id: 'bridge',
            ok: false,
            detail: 'integrationListenEnabled is false'
          }
        ],
        smokeChat: smokeChat ? { ok: false, detail: 'Bridge disabled' } : null
      }
    }

    const tokenRaw = store.get('integrationToken')
    const token = typeof tokenRaw === 'string' && tokenRaw.trim() ? tokenRaw.trim() : ''
    const authHeaders: Record<string, string> = {}
    if (token) authHeaders.Authorization = `Bearer ${token}`

    let healthRuntimeRunning = false
    try {
      const h = await localhostJsonRequest(port, '/health', { method: 'GET', timeoutMs: 5000 })
      const ok = h.statusCode === 200
      if (ok) {
        try {
          const j = JSON.parse(h.body) as { runtimeRunning?: boolean; runtimeKind?: string }
          healthRuntimeRunning = Boolean(j.runtimeRunning)
          const kind = typeof j.runtimeKind === 'string' ? j.runtimeKind : ''
          steps.push({
            id: 'health',
            ok: true,
            detail: `HTTP ${h.statusCode} · runtimeRunning=${healthRuntimeRunning}${kind ? ` · ${kind}` : ''}`
          })
        } catch {
          steps.push({ id: 'health', ok: true, detail: `HTTP ${h.statusCode} (body not JSON)` })
        }
      } else {
        steps.push({ id: 'health', ok: false, detail: `HTTP ${h.statusCode}` })
      }
    } catch (e) {
      steps.push({
        id: 'health',
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }

    if (!steps.find((s) => s.id === 'health')?.ok) {
      return {
        ok: false,
        summary: 'Health check failed — fix connection or enable the bridge.',
        steps,
        smokeChat: smokeChat ? { ok: false, detail: 'Skipped — health failed' } : null
      }
    }

    try {
      const r = await localhostJsonRequest(port, '/v1/runtime/status', {
        method: 'GET',
        headers: { ...authHeaders },
        timeoutMs: 5000
      })
      const ok = r.statusCode === 200
      let extra = ''
      if (r.statusCode === 401) extra = ' — check bearer token matches this app and your client'
      if (ok) {
        try {
          const j = JSON.parse(r.body) as { running?: boolean; kind?: string }
          extra = ` · running=${Boolean(j.running)}${j.kind ? ` · ${j.kind}` : ''}`
        } catch {
          /* ignore */
        }
      }
      steps.push({
        id: 'runtime_status',
        ok,
        detail: `HTTP ${r.statusCode}${extra}`
      })
    } catch (e) {
      steps.push({
        id: 'runtime_status',
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }

    let smoke: IntegrationBridgeSmokeChat | null = null
    if (smokeChat) {
      if (!healthRuntimeRunning) {
        smoke = {
          ok: false,
          detail: 'Skipped — start the model runtime first (/health reports runtimeRunning).'
        }
      } else {
        try {
          const chatBody = JSON.stringify({
            messages: [
              { role: 'system', content: 'Reply with a single token.' },
              { role: 'user', content: 'ping' }
            ],
            maxTokens: 1
          })
          const r = await localhostJsonRequest(port, '/v1/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders
            },
            body: chatBody,
            timeoutMs: 120_000
          })
          const ok = r.statusCode === 200
          let preview = ''
          if (ok) {
            try {
              const j = JSON.parse(r.body) as { reply?: string }
              if (typeof j.reply === 'string') preview = j.reply.replace(/\s+/g, ' ').trim().slice(0, 64)
            } catch {
              /* ignore */
            }
          }
          smoke = {
            ok,
            httpStatus: r.statusCode,
            detail: ok
              ? `HTTP ${r.statusCode}${preview ? ` · ${preview}` : ''}`
              : `HTTP ${r.statusCode} — ${r.body.replace(/\s+/g, ' ').trim().slice(0, 160)}`
          }
        } catch (e) {
          smoke = { ok: false, detail: e instanceof Error ? e.message : String(e) }
        }
      }
    }

    const coreOk = steps.every((s) => s.ok)
    const smokeOk = smoke == null || smoke.ok
    const ok = coreOk && smokeOk
    let summary = coreOk
      ? 'Health and /v1/runtime/status succeeded.'
      : 'One or more checks failed — see steps.'
    if (smokeChat && smoke) {
      summary += smoke.ok ? ' Smoke chat succeeded.' : ` Smoke chat: ${smoke.detail}`
    }
    return { ok, summary, steps, smokeChat: smokeChat ? smoke : null }
  })

  ipcMain.handle(IPC.SECRETS_SET_HF_TOKEN, (_e, token: string | null) => {
    if (!token) {
      store.delete('hfTokenEncrypted')
      setHfToken(undefined)
      return { ok: true }
    }
    if (!safeStorage.isEncryptionAvailable()) {
      store.set('hfTokenEncrypted', token)
      setHfToken(token)
      return { ok: true, warn: 'encryption_unavailable' }
    }
    const buf = safeStorage.encryptString(token)
    store.set('hfTokenEncrypted', Buffer.from(buf).toString('base64'))
    setHfToken(token)
    return { ok: true }
  })

  configureIntegrationServer({
    store,
    getRuntime,
    getDb: () => db,
    getOntology: () => ontology
  })
}
