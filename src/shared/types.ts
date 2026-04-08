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
  /** llama.cpp child RSS or Ollama model size (approx.), MiB */
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
