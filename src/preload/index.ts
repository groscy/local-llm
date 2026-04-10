import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  KbSearchHit,
  PluginIntegrationReport,
  RuntimeChatProgress,
  RuntimeLoadProgress,
  WikiChatHighlightTerm,
  WikiExportZipResult,
  WikiPagePayload,
  WikiTopic
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('api', {
  getPaths: () => invoke(IPC.GET_PATHS),
  getConfig: () => invoke(IPC.GET_CONFIG),
  setConfig: (c: unknown) => invoke(IPC.SET_CONFIG, c),
  pickModelsDirectory: () => invoke<string | null>(IPC.PICK_MODELS_DIRECTORY),
  clearDownloadCache: () =>
    invoke<{ downloadsRemoved: number; hfCacheRemoved: number; downloadsCancelled: number }>(
      IPC.CLEAR_DOWNLOAD_CACHE
    ),
  clearAllCaches: () => invoke(IPC.CLEAR_ALL_CACHES),
  deleteAllModels: () => invoke(IPC.DELETE_ALL_MODELS),
  resetFactoryConfig: () => invoke(IPC.RESET_FACTORY_CONFIG),
  hardwareSummary: (destDir?: string) => invoke(IPC.HARDWARE_SUMMARY, destDir),
  hfSearch: (q: string, limit?: number) => invoke(IPC.HF_SEARCH, q, limit),
  hfRecommended: (limit?: number) => invoke(IPC.HF_RECOMMENDED, limit),
  hfModelInfo: (id: string) => invoke(IPC.HF_MODEL_INFO, id),
  hfDownload: (p: {
    repoId: string
    revision: string
    filename: string
    destDir?: string
    /** Defaults to repoId in main process when omitted. */
    chatDisplayName?: string
  }) => invoke(IPC.HF_DOWNLOAD, p),
  hfDownloadStatus: (id: string) => invoke(IPC.HF_DOWNLOAD_STATUS, id),
  hfCancelDownload: (id: string) => invoke(IPC.HF_CANCEL_DOWNLOAD, id),
  downloadsList: () => invoke(IPC.DOWNLOADS_LIST),
  runtimeList: () => invoke(IPC.RUNTIME_LIST),
  runtimeInstallPath: () => invoke(IPC.RUNTIME_INSTALL_PATH),
  listLocalModelsInDownloadDir: () => invoke<{ modelsDir: string; paths: string[] }>(IPC.RUNTIME_LIST_LOCAL_MODELS),
  installOllama: () => invoke(IPC.RUNTIME_INSTALL_OLLAMA),
  onOllamaInstallProgress: (callback: (payload: { message: string }) => void) => {
    const channel = IPC.RUNTIME_INSTALL_OLLAMA_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: { message: string }) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onRuntimeLoadProgress: (callback: (payload: RuntimeLoadProgress) => void) => {
    const channel = IPC.RUNTIME_LOAD_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: RuntimeLoadProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onRuntimeChatProgress: (callback: (payload: RuntimeChatProgress) => void) => {
    const channel = IPC.RUNTIME_CHAT_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: RuntimeChatProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  integrationPluginReportsList: () => invoke<PluginIntegrationReport[]>(IPC.INTEGRATION_PLUGIN_REPORTS_LIST),
  onIntegrationPluginReport: (callback: (payload: PluginIntegrationReport) => void) => {
    const channel = IPC.INTEGRATION_PLUGIN_REPORT
    const listener = (_e: IpcRendererEvent, payload: PluginIntegrationReport) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  openExternalUrl: (url: string) => invoke(IPC.OPEN_EXTERNAL_URL, url),
  runtimeStart: (p: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => invoke(IPC.RUNTIME_START, p),
  runtimeStop: () => invoke(IPC.RUNTIME_STOP),
  runtimeStatus: () => invoke(IPC.RUNTIME_STATUS),
  ollamaListTags: () => invoke<{ names: string[]; error?: string }>(IPC.RUNTIME_OLLAMA_TAGS),
  ollamaPullModel: (modelName: string) => invoke<{ ok: true }>(IPC.RUNTIME_OLLAMA_PULL, modelName),
  onOllamaPullProgress: (callback: (payload: RuntimeLoadProgress) => void) => {
    const channel = IPC.OLLAMA_PULL_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: RuntimeLoadProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  deleteLocalGgufModel: (absolutePath: string) => invoke<{ ok: true }>(IPC.RUNTIME_DELETE_LOCAL_GGUF, absolutePath),
  deleteOllamaModel: (modelName: string) => invoke<{ ok: true }>(IPC.RUNTIME_DELETE_OLLAMA_MODEL, modelName),
  runtimeChat: (messages: { role: string; content: string }[], requestId: string) =>
    invoke(IPC.RUNTIME_CHAT, { messages, requestId }),
  conversationsList: () => invoke(IPC.CONVERSATIONS_LIST),
  conversationCreate: (title?: string) => invoke(IPC.CONVERSATION_CREATE, title),
  conversationMessages: (id: string) => invoke(IPC.CONVERSATION_MESSAGES, id),
  conversationRename: (id: string, title: string) =>
    invoke(IPC.CONVERSATION_RENAME, { id, title }),
  conversationDelete: (payload: { id: string; removeLinkedKnowledge: boolean }) =>
    invoke(IPC.CONVERSATION_DELETE, payload),
  messageAppend: (
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
  ) => invoke(IPC.MESSAGE_APPEND, cid, role, content, modelId, usage),
  kbIngestText: (title: string, uri: string, body: string) => invoke(IPC.KB_INGEST_TEXT, title, uri, body),
  kbIngestConversation: (conversationId: string) => invoke(IPC.KB_INGEST_CONVERSATION, conversationId),
  kbIngestFile: () => invoke(IPC.KB_INGEST_FILE),
  kbSources: () => invoke(IPC.KB_SOURCES),
  kbSearch: (query: string, limit?: number) => invoke(IPC.KB_SEARCH, query, limit),
  kbSearchHits: (query: string, limit?: number) => invoke<KbSearchHit[]>(IPC.KB_SEARCH_HITS, query, limit),
  kbChunks: (sourceId: string) => invoke(IPC.KB_CHUNKS, sourceId),
  kbWikiTopics: () => invoke<WikiTopic[]>(IPC.KB_WIKI_TOPICS),
  kbWikiPage: (sourceId: string) => invoke<WikiPagePayload>(IPC.KB_WIKI_PAGE, sourceId),
  kbWikiHighlightTerms: () => invoke<WikiChatHighlightTerm[]>(IPC.KB_WIKI_HIGHLIGHT_TERMS),
  kbDeleteSource: (sourceId: string) => invoke<{ ok: true }>(IPC.KB_DELETE_SOURCE, sourceId),
  kbExportWikiZip: () => invoke<WikiExportZipResult>(IPC.KB_EXPORT_WIKI_ZIP),
  kbKnowledgeGraph: () => invoke(IPC.KB_KNOWLEDGE_GRAPH),
  kbWikiExtractTurn: (p: {
    conversationId: string
    conversationTitle?: string
    userMessage: string
    assistantMessage: string
  }) => invoke(IPC.KB_WIKI_EXTRACT_TURN, p),
  metricsSnapshot: (opts?: { persist?: boolean }) => invoke(IPC.METRICS_SNAPSHOT, opts),
  metricsHistory: (limit?: number) => invoke(IPC.METRICS_HISTORY, limit),
  trainStart: (p: { baseModelPath: string; datasetPath: string; pythonPath?: string }) =>
    invoke(IPC.TRAIN_START, p),
  trainStatus: (id: string) => invoke(IPC.TRAIN_STATUS, id),
  trainListJobs: () => invoke(IPC.TRAIN_LIST_JOBS),
  setHfToken: (token: string | null) => invoke(IPC.SECRETS_SET_HF_TOKEN, token)
})
