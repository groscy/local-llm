import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('api', {
  getPaths: () => invoke(IPC.GET_PATHS),
  getConfig: () => invoke(IPC.GET_CONFIG),
  setConfig: (c: unknown) => invoke(IPC.SET_CONFIG, c),
  pickModelsDirectory: () => invoke<string | null>(IPC.PICK_MODELS_DIRECTORY),
  clearDownloadCache: () =>
    invoke<{ downloadsRemoved: number; hfCacheRemoved: number }>(IPC.CLEAR_DOWNLOAD_CACHE),
  hfSearch: (q: string, limit?: number) => invoke(IPC.HF_SEARCH, q, limit),
  hfRecommended: (limit?: number) => invoke(IPC.HF_RECOMMENDED, limit),
  hfModelInfo: (id: string) => invoke(IPC.HF_MODEL_INFO, id),
  hfDownload: (p: { repoId: string; revision: string; filename: string; destDir?: string }) =>
    invoke(IPC.HF_DOWNLOAD, p),
  hfDownloadStatus: (id: string) => invoke(IPC.HF_DOWNLOAD_STATUS, id),
  hfCancelDownload: (id: string) => invoke(IPC.HF_CANCEL_DOWNLOAD, id),
  downloadsList: () => invoke(IPC.DOWNLOADS_LIST),
  runtimeList: () => invoke(IPC.RUNTIME_LIST),
  runtimeInstallPath: () => invoke(IPC.RUNTIME_INSTALL_PATH),
  openExternalUrl: (url: string) => invoke(IPC.OPEN_EXTERNAL_URL, url),
  runtimeStart: (p: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => invoke(IPC.RUNTIME_START, p),
  runtimeStop: () => invoke(IPC.RUNTIME_STOP),
  runtimeStatus: () => invoke(IPC.RUNTIME_STATUS),
  runtimeChat: (messages: { role: string; content: string }[]) => invoke(IPC.RUNTIME_CHAT, { messages }),
  conversationsList: () => invoke(IPC.CONVERSATIONS_LIST),
  conversationCreate: (title?: string) => invoke(IPC.CONVERSATION_CREATE, title),
  conversationMessages: (id: string) => invoke(IPC.CONVERSATION_MESSAGES, id),
  conversationDelete: (payload: { id: string; removeLinkedKnowledge: boolean }) =>
    invoke(IPC.CONVERSATION_DELETE, payload),
  messageAppend: (cid: string, role: 'user' | 'assistant' | 'system', content: string, modelId?: string) =>
    invoke(IPC.MESSAGE_APPEND, cid, role, content, modelId),
  kbIngestText: (title: string, uri: string, body: string) => invoke(IPC.KB_INGEST_TEXT, title, uri, body),
  kbIngestConversation: (conversationId: string) => invoke(IPC.KB_INGEST_CONVERSATION, conversationId),
  kbIngestFile: () => invoke(IPC.KB_INGEST_FILE),
  kbSources: () => invoke(IPC.KB_SOURCES),
  kbSearch: (query: string, limit?: number) => invoke(IPC.KB_SEARCH, query, limit),
  kbChunks: (sourceId: string) => invoke(IPC.KB_CHUNKS, sourceId),
  kbWikiTopics: () => invoke(IPC.KB_WIKI_TOPICS),
  kbWikiPage: (sourceId: string) => invoke(IPC.KB_WIKI_PAGE, sourceId),
  metricsSnapshot: (opts?: { persist?: boolean }) => invoke(IPC.METRICS_SNAPSHOT, opts),
  metricsHistory: (limit?: number) => invoke(IPC.METRICS_HISTORY, limit),
  trainStart: (p: { baseModelPath: string; datasetPath: string; pythonPath?: string }) =>
    invoke(IPC.TRAIN_START, p),
  trainStatus: (id: string) => invoke(IPC.TRAIN_STATUS, id),
  trainListJobs: () => invoke(IPC.TRAIN_LIST_JOBS),
  setHfToken: (token: string | null) => invoke(IPC.SECRETS_SET_HF_TOKEN, token)
})
