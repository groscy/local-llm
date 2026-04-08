import type { DownloadRow, RuntimeStatus } from '@shared/types'

export {}

type Api = {
  getPaths: () => Promise<{
    userData: string
    logs: string
    modelsDefault: string
    db: string
    vectors: string
  }>
  getConfig: () => Promise<Record<string, unknown> & { hfTokenSet?: boolean }>
  setConfig: (c: unknown) => Promise<{ ok: boolean; error?: string }>
  /** Native folder picker; returns absolute path or null if cancelled. */
  pickModelsDirectory: () => Promise<string | null>
  clearDownloadCache: () => Promise<{ downloadsRemoved: number; hfCacheRemoved: number }>
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
  runtimeInstallPath: () => Promise<{
    llamaBinary: string
    ollamaBase: string
    llamaResolvedPath: string
    llamaDetected: boolean
    llamaConfiguredPathValid: boolean
  }>
  openExternalUrl: (url: string) => Promise<{ ok: boolean }>
  runtimeStart: (p: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => Promise<RuntimeStatus>
  runtimeStop: () => Promise<RuntimeStatus>
  runtimeStatus: () => Promise<RuntimeStatus>
  runtimeChat: (messages: { role: string; content: string }[]) => Promise<string>
  conversationsList: () => Promise<unknown[]>
  conversationCreate: (title?: string) => Promise<unknown>
  conversationMessages: (id: string) => Promise<unknown[]>
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
