import type {
  DownloadRow,
  HardwareSummary,
  RuntimeChatProgress,
  RuntimeLoadProgress,
  RuntimeStatus
} from '@shared/types'

export {}

type Api = {
  getPaths: () => Promise<{
    userData: string
    logs: string
    modelsDefault: string
    db: string
    vectors: string
    platform: NodeJS.Platform
  }>
  getConfig: () => Promise<Record<string, unknown> & { hfTokenSet?: boolean }>
  setConfig: (c: unknown) => Promise<{ ok: boolean; error?: string }>
  /** Native folder picker; returns absolute path or null if cancelled. */
  pickModelsDirectory: () => Promise<string | null>
  clearDownloadCache: () => Promise<{
    downloadsRemoved: number
    hfCacheRemoved: number
    downloadsCancelled: number
  }>
  clearAllCaches: () => Promise<{
    downloadsRemoved: number
    hfCacheRemoved: number
    metricsRemoved: number
    trainJobsRemoved: number
    vectorsEntriesCleared: number
    downloadsCancelled: number
    trainProcessesKilled: number
  }>
  deleteAllModels: () => Promise<{ removed: number; errors: string[]; downloadsRemoved: number }>
  resetFactoryConfig: () => Promise<{ ok: boolean }>
  /** Optional destDir: when set and the path exists, free-disk is measured on that volume. */
  hardwareSummary: (destDir?: string) => Promise<HardwareSummary>
  hfSearch: (q: string, limit?: number) => Promise<unknown[]>
  hfRecommended: (limit?: number) => Promise<unknown[]>
  hfModelInfo: (id: string) => Promise<unknown>
  hfDownload: (p: {
    repoId: string
    revision: string
    filename: string
    destDir?: string
  }) => Promise<{ id: string; destPath: string }>
  hfDownloadStatus: (id: string) => Promise<unknown>
  hfCancelDownload: (id: string) => Promise<boolean>
  downloadsList: () => Promise<DownloadRow[]>
  runtimeList: () => Promise<{ id: string; label: string }[]>
  /** `.gguf` files under the configured models / download directory (recursive). */
  listLocalModelsInDownloadDir: () => Promise<{ modelsDir: string; paths: string[] }>
  runtimeInstallPath: () => Promise<{
    llamaBinary: string
    ollamaBase: string
    llamaResolvedPath: string
    llamaDetected: boolean
    llamaConfiguredPathValid: boolean
    /** Ollama daemon responds at `ollamaBase` (/api/tags). */
    ollamaReachable: boolean
  }>
  /** Download / install Ollama from ollama.com where supported; ensures default API URL works with this app. */
  installOllama: () => Promise<
    | { ok: true; detail?: string }
    | { ok: false; error: string }
    | { ok: true; needsManualFinish: true; hint: string }
  >
  /** Subscribe to install log lines; returns unsubscribe. */
  onOllamaInstallProgress: (callback: (payload: { message: string }) => void) => () => void
  /** Subscribe to model load progress during `runtimeStart`; returns unsubscribe. */
  onRuntimeLoadProgress: (callback: (payload: RuntimeLoadProgress) => void) => () => void
  /** Subscribe to streamed assistant tokens; correlate with `requestId` passed to `runtimeChat`. */
  onRuntimeChatProgress: (callback: (payload: RuntimeChatProgress) => void) => () => void
  openExternalUrl: (url: string) => Promise<{ ok: boolean }>
  runtimeStart: (p: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => Promise<RuntimeStatus>
  runtimeStop: () => Promise<RuntimeStatus>
  runtimeStatus: () => Promise<RuntimeStatus>
  runtimeChat: (messages: { role: string; content: string }[], requestId: string) => Promise<string>
  conversationsList: () => Promise<unknown[]>
  conversationCreate: (title?: string) => Promise<unknown>
  conversationMessages: (id: string) => Promise<unknown[]>
  conversationRename: (id: string, title: string) => Promise<unknown>
  conversationDelete: (payload: { id: string; removeLinkedKnowledge: boolean }) => Promise<{ ok: boolean }>
  messageAppend: (
    cid: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    modelId?: string
  ) => Promise<unknown>
  kbIngestText: (title: string, uri: string, body: string) => Promise<unknown>
  kbIngestConversation: (conversationId: string) => Promise<unknown>
  kbIngestFile: () => Promise<unknown>
  kbSources: () => Promise<unknown[]>
  kbSearch: (query: string, limit?: number) => Promise<string[]>
  kbChunks: (sourceId: string) => Promise<unknown[]>
  kbWikiTopics: () => Promise<unknown[]>
  kbWikiPage: (sourceId: string) => Promise<{ id: string; title: string; body: string }>
  metricsSnapshot: (opts?: { persist?: boolean }) => Promise<unknown>
  metricsHistory: (limit?: number) => Promise<unknown[]>
  trainStart: (p: { baseModelPath: string; datasetPath: string; pythonPath?: string }) => Promise<unknown>
  trainStatus: (id: string) => Promise<unknown>
  trainListJobs: () => Promise<unknown[]>
  setHfToken: (token: string | null) => Promise<{ ok: boolean; warn?: string }>
}

declare global {
  interface Window {
    api: Api
  }
}
