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
  /**
   * When set, installing from the library in Ollama mode runs `ollama pull` for this tag
   * (see curated Hub ↔ registry map in the main process).
   */
  ollamaLibraryName?: string
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
  /** Repo-relative path (e.g. Q4_K_M/model.gguf). Required to resume after app restart. */
  hfFilename?: string
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
  /**
   * Human-readable label stored at download time (repo, Hub path / file, optional task type).
   * Shown in download progress, Run → Hub downloads, and the top-bar file picker when it matches `local_path`.
   */
  chat_display_name?: string
  /** HF file path inside the repo; used to rebuild the resolve URL when resuming. */
  hf_filename?: string
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

/** Topic cluster inferred from user chat prompts (keyword overlap; merged / split heuristically). */
export interface PromptDomainRow {
  id: string
  title: string
  keywords: string[]
  /** Optional extra system instructions when this domain matches a user message (bounded). */
  systemSuffix: string
  createdAt: number
  updatedAt: number
  messageCount: number
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

/** `messageAppend` may attach `promptDomainSuffix` for user messages when domain enhancement is on. */
export type MessageAppendResponse = MessageRow & {
  promptDomainSuffix?: string
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

/** How a KB source was created; derived from its `uri` for library grouping. */
export type WikiSourceKind = 'document' | 'extracted_note' | 'saved_chat' | 'other'

export interface WikiTopic {
  id: string
  title: string
  chunkCount: number
  kind: WikiSourceKind
}

/** One ranked KB hit per source for wiki / library search (snippet from best-matching chunk). */
export interface KbSearchHit {
  sourceId: string
  sourceTitle: string
  chunkId: string
  heading: string | null
  snippet: string
  kind: WikiSourceKind
}

/** A defined term extracted from a `::: glossary` block in wiki Markdown. */
export interface WikiGlossaryEntry {
  term: string
  definition: string
}

/** Phrase linked from chat text to a wiki/KB source (title, heading, or glossary term). */
export interface WikiChatHighlightTerm {
  sourceId: string
  /** Match this text case-insensitively in chat (trimmed). */
  phrase: string
  /** Short preview for hover tooltip (excerpt from KB chunk, glossary, or title). */
  snippet: string
  /** Knowledge-graph context (chunk count, wiki link, related sources) for the hover popup. */
  graphSummary?: string
}

/** Another KB source related by overlapping topical tokens (title + early chunks). */
export interface WikiRelatedSource {
  id: string
  title: string
  kind: WikiSourceKind
  /** Shared tokens (4+ chars) linking this article to the related source. */
  sharedTerms: string[]
}

/** Wiki article returned to the renderer (body has glossary fences removed). */
export interface WikiPagePayload {
  id: string
  title: string
  body: string
  glossary: WikiGlossaryEntry[]
  relatedSources: WikiRelatedSource[]
}

export type WikiExportZipResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }

/** Save dialog for the JetBrains plugin distribution (local copy or GitHub latest). */
export type SaveIntellijPluginZipResult =
  | { ok: true; path: string; source: 'bundled' | 'local-build' | 'download' }
  | { ok: false; canceled?: true; error?: string }

/** Nodes and edges for the in-app knowledge graph visualization (sources, chunks, wiki pages). */
export type KnowledgeGraphNodeKind = 'source' | 'chunk' | 'wiki'

export interface KnowledgeGraphNode {
  id: string
  kind: KnowledgeGraphNodeKind
  label: string
  sublabel?: string
  /** Parent KB source id when `kind === 'chunk'`. */
  sourceId?: string
}

export type KnowledgeGraphEdgeKind = 'contains' | 'indexes' | 'compiled_from' | 'related'

export interface KnowledgeGraphEdge {
  from: string
  to: string
  kind: KnowledgeGraphEdgeKind
}

export interface KnowledgeGraphPayload {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  /** True when some chunks were omitted from the graph for performance. */
  truncated: boolean
}

/** Result of distilling a chat turn into a wiki note (`kb:wikiExtractTurn`). */
export interface WikiExtractTurnResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  sourceId?: string
  title?: string
  error?: string
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
  /**
   * Mean wall time (ms) for the last several successful chat completions (prompt sent → full reply),
   * sampled when this snapshot was taken.
   */
  avgPromptToResponseMs?: number
}

export interface TrainJob {
  id: string
  status: 'queued' | 'running' | 'complete' | 'error'
  baseModelPath: string
  outputDir: string
  message?: string
  startedAt?: number
  finishedAt?: number
  /** KB source ids when the dataset was exported from the knowledge base */
  kbSourceIds?: string[]
  /** User label for this fine-tune (used in filenames under models/finetunes) */
  displayName?: string
  /** JSONL path passed to the training script */
  datasetPath?: string
  /** Copied merged / exported GGUF under the models directory when present after training */
  artifactPath?: string
}

/** Main → renderer while `runtime:start` is working (pull, GGUF import, server spawn). */
export interface RuntimeLoadProgress {
  /**
   * High-level step. Includes `load_log` for raw llama-server stderr chunks (append-only in UI;
   * `message` holds the text chunk, other fields optional).
   */
  phase: string
  message: string
  /** 0–100 when known (e.g. Ollama layer pull or GGUF upload). */
  percent?: number
  /** Server health summary, llama-server stderr tail, conversion log, pull digest, etc. */
  detail?: string
}

/** Main → renderer while a chat completion is streaming. */
export interface RuntimeChatProgress {
  requestId: string
  kind: 'token' | 'error' | 'usage' | 'started'
  text?: string
  message?: string
  /** From Ollama / llama.cpp when the stream finishes (exact counts). */
  promptTokens?: number
  completionTokens?: number
}

/** Event kinds POSTed by IDE plugins to `/v1/plugin/report`. */
export type PluginIntegrationReportKind =
  | 'chat_completed'
  | 'chat_failed'
  | 'apply_completed'
  | 'apply_failed'
  | 'apply_cancelled'
  | 'send_cancelled'
  | 'agent_step'
  | 'agent_stop'

/** Normalized report after the desktop app accepts a plugin POST (includes server receipt time). */
export interface PluginIntegrationReport {
  receivedAt: number
  source: string
  kind: PluginIntegrationReportKind
  message?: string
  /** Small structured fields (token counts, file counts, project name, etc.). */
  meta?: Record<string, string | number | boolean | null>
}
