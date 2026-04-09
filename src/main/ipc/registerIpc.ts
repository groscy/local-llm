import { ipcMain, dialog, safeStorage, BrowserWindow, shell } from 'electron'
import { randomUUID } from 'crypto'
import { basename, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import type Store from 'electron-store'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import { hfSearch, hfModelDetail, hfRecommended } from '../services/hfService'
import {
  startDownload,
  cancelDownload,
  listDownloadsWithProgress,
  getActiveDownload,
  clearDownloadRegistryAndHfCache,
  cancelAllActiveDownloads
} from '../services/downloadManager'
import { createRuntime, type RuntimeAdapter } from '../services/runtime'
import { installOllamaForPlatform } from '../services/ollamaInstaller'
import { fetchOllamaModelTags, probeOllamaReachable } from '../services/runtime/ollamaAdapter'
import * as chatService from '../services/chatService'
import { recordChatRoundtripMs } from '../services/chatLatencyStats'
import * as kbService from '../services/kbService'
import {
  parseWikiExtractResponse,
  runWikiExtractChat,
  wikiExtractLimits
} from '../services/wikiExtractService'
import * as metricsService from '../services/metricsService'
import * as trainOrchestrator from '../services/trainOrchestrator'
import { logLine } from '../logger'
import { resolveLlamaBinary } from '../services/llamaDetect'
import { collectHardwareSummary } from '../services/hardwareSummary'
import { clearAllAppCaches, deleteAllChildrenInDirectory } from '../services/dataMaintenance'
import { resetElectronStoreToFactory } from '../storeDefaults'
import { configureIntegrationServer } from '../services/integrationServer'
import { getPluginReportHistory } from '../services/pluginIntegrationHub'
import { listGgufModelsInDir } from '../services/localModelsScan'
import { hfDownloadDestFileName } from '../services/hfDownloadNaming'

const configSchema = z.object({
  /** Set to `null` to clear and use the app default under user data. */
  modelsDir: z.union([z.string().min(1), z.null()]).optional(),
  llamaBinaryPath: z.string().optional(),
  runtimeKind: z.enum(['llamacpp', 'ollama']).optional(),
  ollamaBaseUrl: z.string().optional(),
  llamaPort: z.number().optional(),
  hfTokenEncrypted: z.string().optional(),
  metricsPinned: z.boolean().optional(),
  metricsRefreshMs: z.number().min(500).max(3_600_000).optional(),
  downloadsPinned: z.boolean().optional(),
  activityPinned: z.boolean().optional(),
  pinnedWidgetsSide: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  pinnedWidgetsWidthPx: z.number().min(160).max(1400).optional(),
  pinnedWidgetsHeightPx: z.number().min(100).max(1200).optional(),
  colorScheme: z.enum(['violet', 'teal', 'amber', 'rose', 'sky']).optional(),
  chatMaxTokens: z.number().int().min(1).max(262_144).optional(),
  integrationListenEnabled: z.boolean().optional(),
  integrationPort: z.number().int().min(1024).max(65535).optional(),
  integrationToken: z.string().max(256).optional(),
  wikiAutoExtract: z.boolean().optional()
})

function trainingScriptPath(): string {
  if (is.dev) return join(process.cwd(), 'training', 'train_lora.py')
  return join(process.resourcesPath, 'training', 'train_lora.py')
}

export interface IpcContext {
  db: Database.Database
  store: Store<Record<string, unknown>>
  userData: string
  getHfToken: () => string | undefined
  setHfToken: (t: string | undefined) => void
  getRuntime: () => RuntimeAdapter | null
  setRuntime: (r: RuntimeAdapter | null) => void
}

export function registerIpc(ctx: IpcContext): void {
  const { db, store, userData, getHfToken, setHfToken, getRuntime, setRuntime } = ctx

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

  ipcMain.handle(IPC.GET_PATHS, () => ({
    userData,
    logs: join(userData, 'logs'),
    modelsDefault: modelsDir(),
    db: join(userData, 'app.sqlite'),
    vectors: join(userData, 'vectors'),
    platform: process.platform
  }))

  ipcMain.handle(IPC.HARDWARE_SUMMARY, (_e, destDir?: unknown) => {
    const base = modelsDir()
    let diskPath = base
    if (typeof destDir === 'string') {
      const t = destDir.trim()
      if (t && existsSync(t)) diskPath = t
    }
    return collectHardwareSummary(diskPath)
  })

  ipcMain.handle(IPC.GET_CONFIG, () => ({
    ...store.store,
    hfTokenSet: !!getHfToken()
  }))

  ipcMain.handle(IPC.SET_CONFIG, (_e, raw: unknown) => {
    const parsed = configSchema.partial().safeParse(raw)
    if (!parsed.success) return { ok: false, error: parsed.error.message }
    const reloadIntegration = Object.keys(parsed.data).some(
      (k) => k === 'integrationListenEnabled' || k === 'integrationPort' || k === 'integrationToken'
    )
    Object.entries(parsed.data).forEach(([k, v]) => {
      if (v === undefined || k === 'hfTokenEncrypted') return
      if (k === 'modelsDir' && v === null) {
        store.delete('modelsDir')
        return
      }
      store.set(k, v as never)
    })
    if (reloadIntegration) {
      configureIntegrationServer({ store, getRuntime })
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
    const localName = hfDownloadDestFileName(payload.repoId, revision, payload.filename)
    const destPath = join(destBase, localName)
    const job = {
      id: randomUUID(),
      repoId: payload.repoId,
      revision,
      destPath,
      status: 'pending' as const,
      progress: 0,
      bytesReceived: 0,
      bytesTotal: 0,
      chatDisplayName:
        payload.chatDisplayName?.trim() ||
        `${payload.repoId} · ${basename(payload.filename.replace(/\\/g, '/'))}`
    }
    const token = getHfToken()
    const url = `https://huggingface.co/${payload.repoId}/resolve/${encodeURIComponent(job.revision)}/${payload.filename
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/')}`

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

  ipcMain.handle(IPC.HF_CANCEL_DOWNLOAD, (_e, jobId: string) => cancelDownload(jobId))

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
    setHfToken(undefined)
    logLine('info', 'factory_config_reset')
    return { ok: true as const }
  })

  ipcMain.handle(IPC.RUNTIME_LIST, () => [
    { id: 'llamacpp', label: 'llama.cpp server' },
    { id: 'ollama', label: 'Ollama (local daemon)' }
  ])

  ipcMain.handle(IPC.RUNTIME_LIST_LOCAL_MODELS, () => {
    const dir = modelsDir()
    const paths = listGgufModelsInDir(dir)
    return { modelsDir: dir, paths }
  })

  ipcMain.handle(IPC.RUNTIME_OLLAMA_TAGS, async () => {
    const raw = (store.get('ollamaBaseUrl') as string | undefined)?.trim()
    const ollamaBase = raw || 'http://127.0.0.1:11434'
    return fetchOllamaModelTags(ollamaBase)
  })

  ipcMain.handle(IPC.RUNTIME_INSTALL_PATH, async () => {
    const configured = (store.get('llamaBinaryPath') as string | undefined) ?? ''
    const trimmed = configured.trim()
    const configuredValid = Boolean(trimmed && existsSync(trimmed))
    const resolved = resolveLlamaBinary(configured.trim() ? configured : undefined)
    const ollamaBase = (store.get('ollamaBaseUrl') as string | undefined) ?? 'http://127.0.0.1:11434'
    const ollamaReachable = await probeOllamaReachable(ollamaBase)
    return {
      llamaBinary: configured,
      ollamaBase,
      llamaResolvedPath: resolved ?? '',
      llamaDetected: Boolean(resolved),
      llamaConfiguredPathValid: configuredValid,
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

  ipcMain.handle(
    IPC.RUNTIME_START,
    async (event, opts: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => {
      const existing = getRuntime()
      if (existing?.getStatus().running) {
        throw new Error('A model is already loaded. Unload it before loading another.')
      }
      await existing?.stop()
      const adapter = createRuntime(opts.kind, {
        ollamaBaseUrl: (store.get('ollamaBaseUrl') as string | undefined) ?? 'http://127.0.0.1:11434'
      })
      const configuredBin = store.get('llamaBinaryPath') as string | undefined
      const binaryPath =
        opts.kind === 'llamacpp'
          ? resolveLlamaBinary(typeof configuredBin === 'string' ? configuredBin : undefined)
          : undefined
      const sendLoad = (p: { phase: string; message: string; percent?: number }): void => {
        event.sender.send(IPC.RUNTIME_LOAD_PROGRESS, p)
      }
      await adapter.start({
        modelPath: opts.modelPath,
        binaryPath,
        port: (store.get('llamaPort') as number | undefined) ?? 8080,
        onLoadProgress: sendLoad
      })
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
      }
    ) => {
      const rt = getRuntime()
      if (!rt) throw new Error('Runtime not started')
      const rawMax = store.get('chatMaxTokens')
      const chatMaxTokens =
        typeof rawMax === 'number' && Number.isFinite(rawMax)
          ? Math.min(262_144, Math.max(1, Math.floor(rawMax)))
          : 512
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : ''
      const emit = (
        data:
          | { kind: 'token'; text: string }
          | { kind: 'error'; message: string }
          | { kind: 'usage'; promptTokens?: number; completionTokens?: number }
      ): void => {
        if (!requestId) return
        event.sender.send(IPC.RUNTIME_CHAT_PROGRESS, { requestId, ...data })
      }
      const chatStarted = Date.now()
      try {
        const reply = await rt.chat(payload.messages, {
          maxTokens: chatMaxTokens,
          ...(requestId
            ? {
                onStreamChunk: (text: string) => emit({ kind: 'token', text }),
                onStreamUsage: (u) =>
                  emit({
                    kind: 'usage',
                    promptTokens: u.promptTokens,
                    completionTokens: u.completionTokens
                  })
              }
            : {})
        })
        recordChatRoundtripMs(Date.now() - chatStarted)
        return reply
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
    ) => chatService.appendMessage(db, cid, role, content, modelId, usage)
  )

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

  ipcMain.handle(IPC.KB_INGEST_FILE, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Text', extensions: ['txt', 'md', 'html'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    return kbService.ingestFile(db, r.filePaths[0])
  })

  ipcMain.handle(IPC.KB_SOURCES, () => kbService.listSources(db))
  ipcMain.handle(IPC.KB_SEARCH, (_e, query: string, limit?: number) =>
    kbService.searchChunks(db, query, limit ?? 8).map((c) => c.text)
  )
  ipcMain.handle(IPC.KB_SEARCH_HITS, (_e, query: string, limit?: number) =>
    kbService.searchKbHits(db, query, limit ?? 16)
  )
  ipcMain.handle(IPC.KB_CHUNKS, (_e, sourceId: string) => kbService.listChunksForSource(db, sourceId))
  ipcMain.handle(IPC.KB_WIKI_TOPICS, () => kbService.listWikiTopics(db))
  ipcMain.handle(IPC.KB_WIKI_PAGE, (_e, sourceId: string) =>
    kbService.buildWikiPagePayload(db, sourceId)
  )
  ipcMain.handle(IPC.KB_WIKI_HIGHLIGHT_TERMS, () => kbService.listWikiChatHighlightTerms(db))
  ipcMain.handle(IPC.KB_DELETE_SOURCE, (_e, sourceId: string) => {
    const id = typeof sourceId === 'string' ? sourceId.trim() : ''
    if (!id) throw new Error('source id required')
    kbService.deleteKbSource(db, id)
    return { ok: true as const }
  })
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
      const displayTitle = `Note: ${title}`
      const source = kbService.ingestText(
        db,
        displayTitle,
        uri,
        body,
        undefined,
        parsed.data.conversationId
      )
      logLine('info', 'wiki_extract_ingested', { sourceId: source.id, conversationId: parsed.data.conversationId })
      return { ok: true as const, skipped: false, sourceId: source.id, title: displayTitle }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      logLine('warn', 'wiki_extract_failed', { error: message })
      return { ok: false as const, skipped: false, error: message }
    }
  })

  ipcMain.handle(IPC.METRICS_SNAPSHOT, async (_e, opts?: { persist?: boolean }) => {
    if (opts?.persist === false) {
      return metricsService.peekSnapshot(getRuntime())
    }
    return metricsService.collectSnapshot(db, getRuntime())
  })
  ipcMain.handle(IPC.METRICS_HISTORY, (_e, limit?: number) => metricsService.recentHistory(db, limit ?? 60))

  ipcMain.handle(
    IPC.TRAIN_START,
    (_e, opts: { baseModelPath: string; datasetPath: string; pythonPath?: string }) =>
      trainOrchestrator.startTrainJob(db, userData, trainingScriptPath(), {
        baseModelPath: opts.baseModelPath,
        datasetPath: opts.datasetPath,
        pythonPath: opts.pythonPath
      })
  )

  ipcMain.handle(IPC.TRAIN_STATUS, (_e, id: string) => trainOrchestrator.getTrainJob(db, id))
  ipcMain.handle(IPC.TRAIN_LIST_JOBS, () => trainOrchestrator.listTrainJobs(db))

  /** Persist HF token with safeStorage */
  ipcMain.handle(IPC.INTEGRATION_PLUGIN_REPORTS_LIST, () => getPluginReportHistory())

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

  configureIntegrationServer({ store, getRuntime })
}
