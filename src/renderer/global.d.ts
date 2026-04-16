import type { KnowledgeGraphAnalysisRunResponse } from '@shared/knowledgeGraphAnalysis'
import type {
  DownloadRow,
  HardwareSummary,
  KbSearchHit,
  KnowledgeGraphPayload,
  WikiExtractTurnResult,
  PluginIntegrationReport,
  RuntimeChatProgress,
  RuntimeLoadProgress,
  RuntimeStatus,
  WikiChatHighlightTerm,
  WikiExportZipResult,
  WikiPagePayload,
  WikiTopic,
  PromptDomainRow
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
  /** OS modal attached to the window; use instead of `window.confirm` so the prompt stays above in-app drawers. */
  confirmDestructive: (p: { message: string; detail?: string; confirmLabel?: string }) => Promise<boolean>
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
    /** Shown as chat author when this file is loaded; defaults to repoId. */
    chatDisplayName?: string
  }) => Promise<{ id: string; destPath: string }>
  hfDownloadStatus: (id: string) => Promise<unknown>
  hfCancelDownload: (id: string) => Promise<boolean>
  downloadsList: () => Promise<DownloadRow[]>
  runtimeList: () => Promise<{ id: string; label: string }[]>
  /** `.gguf` / `.safetensors` / `.safetensor` under the configured models dir and optional extra folders (e.g. Hub save path). */
  listLocalModelsInDownloadDir: (additionalRoots?: string[]) => Promise<{ modelsDir: string; paths: string[] }>
  runtimeInstallPath: () => Promise<{
    llamaBinary: string
    ollamaBase: string
    llamaResolvedPath: string
    llamaDetected: boolean
    llamaConfiguredPathValid: boolean
    /** True when `llamaResolvedPath` passes a llama-server --help probe. */
    llamaBinaryValid: boolean
    /** Set when the binary exists but is not usable (wrong tool, missing DLL, etc.). */
    llamaValidateError: string | null
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
  integrationPluginReportsList: () => Promise<PluginIntegrationReport[]>
  onIntegrationPluginReport: (callback: (payload: PluginIntegrationReport) => void) => () => void
  openExternalUrl: (url: string) => Promise<{ ok: boolean }>
  runtimeStart: (p: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => Promise<RuntimeStatus>
  runtimeStop: () => Promise<RuntimeStatus>
  runtimeStatus: () => Promise<RuntimeStatus>
  ollamaListTags: () => Promise<{ names: string[]; error?: string }>
  /** Pull a model into the Ollama library at the configured base URL (does not start the runtime). */
  ollamaPullModel: (modelName: string) => Promise<{ ok: true }>
  /** Progress events during `ollamaPullModel`; returns unsubscribe. */
  onOllamaPullProgress: (callback: (payload: RuntimeLoadProgress) => void) => () => void
  /** Permanently delete one weight file (`.gguf`, `.safetensors`, or `.safetensor`) under the models directory (unload first if loaded). */
  deleteLocalGgufModel: (absolutePath: string) => Promise<{ ok: true }>
  /** Remove one model from the Ollama library. Unload first if it is the active model. */
  deleteOllamaModel: (modelName: string) => Promise<{ ok: true }>
  /**
   * Chat via the active runtime (Ollama or llama.cpp). Omitted `maxTokens` uses Settings → Max response tokens.
   */
  runtimeChat: (
    messages: { role: string; content: string }[],
    requestId: string,
    opts?: { maxTokens?: number; ollamaModel?: string; ollamaBaseUrl?: string }
  ) => Promise<string>
  conversationsList: () => Promise<unknown[]>
  conversationCreate: (title?: string) => Promise<unknown>
  conversationMessages: (id: string) => Promise<unknown[]>
  conversationRename: (id: string, title: string) => Promise<unknown>
  conversationDelete: (payload: { id: string; removeLinkedKnowledge: boolean }) => Promise<{ ok: boolean }>
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
  ) => Promise<unknown>
  messageDelete: (conversationId: string, messageId: string) => Promise<{ ok: boolean }>
  promptDomainsList: () => Promise<PromptDomainRow[]>
  promptDomainSetSuffix: (p: { domainId: string; systemSuffix: string }) => Promise<{ ok: true }>
  trainBaseForFinetunePath: (artifactPath: string) => Promise<{ baseModelPath: string | null }>
  kbIngestText: (title: string, uri: string, body: string) => Promise<unknown>
  kbIngestConversation: (conversationId: string) => Promise<unknown>
  kbIngestFile: () => Promise<unknown>
  kbSources: () => Promise<unknown[]>
  kbSearch: (query: string, limit?: number) => Promise<string[]>
  kbSearchHits: (query: string, limit?: number) => Promise<KbSearchHit[]>
  kbChunks: (sourceId: string) => Promise<unknown[]>
  kbWikiTopics: () => Promise<WikiTopic[]>
  kbWikiPage: (sourceId: string) => Promise<WikiPagePayload>
  kbWikiHighlightTerms: () => Promise<WikiChatHighlightTerm[]>
  kbDeleteSource: (sourceId: string) => Promise<{ ok: true }>
  kbExportWikiZip: () => Promise<WikiExportZipResult>
  kbKnowledgeGraph: () => Promise<KnowledgeGraphPayload>
  kbGraphAnalysisRun: (opts?: { ingestReport?: boolean }) => Promise<KnowledgeGraphAnalysisRunResponse>
  kbWikiExtractTurn: (p: {
    conversationId: string
    conversationTitle?: string
    userMessage: string
    assistantMessage: string
  }) => Promise<WikiExtractTurnResult>
  metricsSnapshot: (opts?: { persist?: boolean }) => Promise<unknown>
  metricsHistory: (limit?: number) => Promise<unknown[]>
  trainStart: (p: {
    baseModelPath: string
    datasetPath?: string
    kbSourceIds?: string[]
    displayName?: string
    pythonPath?: string
  }) => Promise<unknown>
  trainStatus: (id: string) => Promise<unknown>
  trainListJobs: () => Promise<unknown[]>
  trainRescanArtifact: (jobId: string) => Promise<unknown>
  setHfToken: (token: string | null) => Promise<{ ok: boolean; warn?: string }>
}

declare global {
  interface Window {
    api: Api
  }
}
