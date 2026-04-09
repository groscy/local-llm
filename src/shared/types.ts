export interface AppPaths {
  userData: string
  logs: string
  modelsDefault: string
  db: string
  vectors: string
}

export interface HfModelSummary {
  id: string
  author?: string
  downloads?: number
  likes?: number
  tags?: string[]
  pipeline_tag?: string
  private?: boolean
  /** Short card blurb when available (e.g. recommendations). */
  description?: string
  /** Sum of file sizes from the Hub file tree when listing succeeds (~download footprint). */
  totalSizeBytes?: number
}

export interface HfModelDetail extends HfModelSummary {
  description?: string
  readme?: string
  siblings: { path: string; size?: number }[]
  totalSizeBytes: number
  license?: string
  sha?: string
}

/** Snapshot from the main process for model-vs-hardware hints. */
export interface HardwareSummary {
  totalRamBytes: number
  freeRamBytes: number
  logicalCores: number
  platform: string
  /** Free space on the volume that contains the resolved download directory, when readable. */
  downloadVolumeFreeBytes?: number
  gpu?: {
    name: string
    totalVramMb: number
    usedVramMb: number
  }
}

export interface DownloadJob {
  id: string
  repoId: string
  revision: string
  destPath: string
  status: 'pending' | 'downloading' | 'complete' | 'error' | 'cancelled'
  progress: number
  bytesReceived: number
  bytesTotal: number
  error?: string
  /** Hub model id (e.g. org/name) saved at download time for chat author label when this file is loaded. */
  chatDisplayName?: string
}

/** Row from `downloads` table (SQLite column names). */
export interface DownloadRow {
  id: string
  repo_id: string
  revision: string
  local_path: string
  status: string
  bytes_total: number
  verified: number
  created_at: number
  updated_at: number
  /** Present while the file is actively downloading (merged from main-process job). */
  bytes_received?: number
  progress_percent?: number
  /** Hugging Face model id (or custom label) stored when the file was downloaded; used as chat “author” when loaded. */
  chat_display_name?: string
}

export interface RuntimeStatus {
  running: boolean
  kind: 'llamacpp' | 'ollama' | 'none'
  endpoint?: string
  modelPath?: string
  pid?: number
  lastError?: string
}

export interface ConversationRow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface MessageRow {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  modelId?: string
  /** Prompt tokens for this turn (stored on the user message once the assistant reply completes). */
  promptTokens?: number | null
  /** Completion tokens for this reply (stored on the assistant message). */
  completionTokens?: number | null
  promptTokensIsEstimate?: boolean | null
  completionTokensIsEstimate?: boolean | null
}

/** Optional usage snapshot when appending the assistant message after a chat completion. */
export interface MessageAppendUsage {
  promptTokens?: number
  completionTokens?: number
  promptIsEstimate?: boolean
  completionIsEstimate?: boolean
}

export interface KbSource {
  id: string
  title: string
  uri: string
  createdAt: number
  /** When set, this source was created from a chat thread; removable with that conversation. */
  conversationId?: string | null
}

export interface KbChunk {
  id: string
  sourceId: string
  text: string
  heading?: string
  ord: number
}

export interface WikiTopic {
  id: string
  title: string
  chunkCount: number
}

export interface MetricsSnapshot {
  ts: number
  runtimeTokensPerSec?: number
  runtimeCtxUsed?: number
  processCpuPercent?: number
  processRssMb?: number
  gpuMemUsedMb?: number
  gpuMemTotalMb?: number
  /** llama.cpp child resident set or Ollama model size (approx.), MiB */
  modelMemoryMb?: number
}

export interface TrainJob {
  id: string
  status: 'queued' | 'running' | 'complete' | 'error'
  baseModelPath: string
  outputDir: string
  message?: string
  startedAt?: number
  finishedAt?: number
}

/** Main → renderer while `runtime:start` is working (pull, GGUF import, server spawn). */
export interface RuntimeLoadProgress {
  phase: string
  message: string
  /** 0–100 when known (e.g. Ollama layer pull or GGUF upload). */
  percent?: number
}

/** Main → renderer while a chat completion is streaming. */
export interface RuntimeChatProgress {
  requestId: string
  kind: 'token' | 'error' | 'usage'
  text?: string
  message?: string
  /** From Ollama / llama.cpp when the stream finishes (exact counts). */
  promptTokens?: number
  completionTokens?: number
}
