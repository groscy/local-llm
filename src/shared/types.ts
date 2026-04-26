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

/** Main→renderer progress updates while importing one file into the wiki knowledge base. */
export type KbIngestFileProgress =
  | { kind: 'selected'; filePath: string }
  | { kind: 'reading'; filePath: string; format: 'pdf' | 'text' }
  | { kind: 'chunking'; chunkCount: number }
  | { kind: 'indexing'; inserted: number; total: number }
  | { kind: 'done'; sourceId: string; title: string; chunkCount: number }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

export interface KbChunk {
  id: string
  sourceId: string
  text: string
  heading?: string
  ord: number
}

/** How a KB source was created; derived from its `uri` for library grouping. */
export type WikiSourceKind = 'document' | 'extracted_note' | 'saved_chat' | 'codebase_analysis' | 'other'

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

export interface WikiReanalyzeResult {
  ok: boolean
  processedSources: number
  processedEntries: number
  mergedEntries: number
  skippedSources: number
  modelId: string
  promptVersion: string
  error?: string
}

export type WikiReanalyzeProgress =
  | { kind: 'started'; totalSources: number }
  | { kind: 'source'; index: number; totalSources: number; sourceId: string; title: string }
  | { kind: 'merging'; totalKeywords: number }
  | { kind: 'done'; summary: WikiReanalyzeResult }

export type DmsProvider = 'google-drive' | 'onedrive' | 'sharepoint'

export interface DmsConnectionSummary {
  id: string
  provider: DmsProvider
  displayName: string
  accountEmail?: string | null
  tenantId?: string | null
  siteId?: string | null
  status: 'connected' | 'error' | 'expired'
  createdAt: number
  updatedAt: number
  lastSyncedAt?: number | null
}

export interface DmsFolderSummary {
  id: string
  name: string
  path: string
}

export interface DmsImportRootSummary {
  id: string
  connectionId: string
  externalFolderId: string
  displayName: string
  externalPath: string
  createdAt: number
  updatedAt: number
  lastSyncedAt?: number | null
}

export type DmsConnectStartResponse =
  | {
      ok: true
      authUrl: string
      state: string
    }
  | { ok: false; error: string }

export type DmsConnectResult =
  | {
      ok: true
      connection: DmsConnectionSummary
    }
  | { ok: false; error: string }

export type DmsSyncRunResult =
  | {
      ok: true
      runId: string
      importedCount: number
      updatedCount: number
      skippedCount: number
      removedCount: number
      reportSourceId?: string
      graphReportSourceId?: string
    }
  | { ok: false; error: string; runId?: string }

export type DmsSyncProgress =
  | { kind: 'started'; runId: string; rootId: string; message: string; totalDiscovered?: number }
  | { kind: 'scan'; runId: string; rootId: string; message: string; totalDiscovered: number }
  | { kind: 'file'; runId: string; rootId: string; message: string; processed: number; totalDiscovered: number }
  | { kind: 'analysis'; runId: string; rootId: string; message: string }
  | {
      kind: 'done'
      runId: string
      rootId: string
      importedCount: number
      updatedCount: number
      skippedCount: number
      removedCount: number
      reportSourceId?: string
      graphReportSourceId?: string
    }
  | { kind: 'error'; runId: string; rootId: string; message: string }

export type WikiExportZipResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }

/** Save dialog for the JetBrains plugin distribution (local copy or GitHub latest). */
export type SaveIntellijPluginZipResult =
  | { ok: true; path: string; source: 'bundled' | 'local-build' | 'download' }
  | { ok: false; canceled?: true; error?: string }

/** Nodes and edges for the in-app knowledge graph visualization (sources, chunks, wiki pages). */
export type KnowledgeGraphNodeKind = 'source' | 'chunk' | 'wiki'
export type KnowledgeGraphClusterMode = 'related' | 'domain'

export interface KnowledgeGraphSourceGroup {
  id: string
  mode: KnowledgeGraphClusterMode
  label: string
  sourceIds: string[]
}

export interface KnowledgeGraphNode {
  id: string
  kind: KnowledgeGraphNodeKind
  label: string
  /** Minimal-text token for zoomed-out / compact graph modes. */
  shortLabel?: string
  sublabel?: string
  /** Parent KB source id when `kind === 'chunk'`. */
  sourceId?: string
  /** Optional domain bucket used by domain clustering presets. */
  domainId?: string
  /** 0..1 confidence score for evidence-backed nodes. */
  confidence?: number
  /** 0..1 novelty score (higher means more unique/new). */
  novelty?: number
  /** Origin of the node's strongest evidence for trust overlays. */
  provenance?: 'electron' | 'intellij-plugin' | 'knowledge-base'
  /** Optional facet for analysis-derived nodes attached to codebase scans. */
  analysisFacet?: 'domain_model' | 'design_pattern' | 'architecture_pattern'
  /** Codebase registry id this node relates to when analysis-derived. */
  codebaseId?: string
  /** Optional layout metadata for force-directed tuning (renderer only). */
  layoutMass?: number
  /** Optional precomputed grouping key for renderer clustering. */
  layoutGroupId?: string
}

export type KnowledgeGraphEdgeKind = 'contains' | 'indexes' | 'compiled_from' | 'related' | 'semantic_related'

export interface KnowledgeGraphEdge {
  from: string
  to: string
  kind: KnowledgeGraphEdgeKind
  /** Optional evidence-weighted confidence used by layout gravity. */
  confidence?: number
  /** Optional recency score (0..1), newer links can pull stronger in some modes. */
  recency?: number
  /** Optional renderer salience hint (0..1) for edge clutter reduction. */
  salience?: number
}

export interface KnowledgeGraphPayload {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  /** True when some chunks were omitted from the graph for performance. */
  truncated: boolean
}

export interface OntologyNode {
  iri: string
  label: string
  type: string
  confidence: number
}

export interface OntologyEdge {
  id: string
  subjectIri: string
  predicateIri: string
  objectIri?: string | null
  objectLiteral?: string | null
  sourceType: string
  sourceRef: string
  confidence: number
  createdAt: number
}

export interface OntologySubgraphPayload {
  nodes: OntologyNode[]
  edges: OntologyEdge[]
  truncated: boolean
}

export interface OntologyStats {
  entityCount: number
  tripleCount: number
  recentTripleCount: number
  predicateCount: number
  topPredicates: Array<{ predicate: string; count: number }>
  lastUpdatedAt?: number
}

export interface OntologyQueryRequest {
  query?: string
  limitEntities?: number
  limitTriples?: number
  maxHops?: number
  typeFilters?: string[]
  predicateFilters?: string[]
  recentOnlyMs?: number
}

export interface OntologyEntityDetails {
  entity: OntologyNode | null
  outgoing: OntologyEdge[]
  incoming: OntologyEdge[]
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

/** Suggested follow-up angle after a deep-learn model round (shown as clickable actions). */
export type DeepLearnExplorePath = {
  /** Short title for the button. */
  label: string
  /** Passed to the next round as the user’s chosen investigation focus. */
  prompt: string
}

/** Main → renderer while `kb:deepLearnRun` is in progress. */
export type DeepLearnRunProgress =
  | { kind: 'started'; jobId: string }
  | { kind: 'fetch'; jobId: string; url: string }
  | { kind: 'round'; jobId: string; round: number; maxRounds: number }
  | {
      kind: 'roundAwaitChoice'
      jobId: string
      roundCompleted: number
      maxRounds: number
      explorePaths: DeepLearnExplorePath[]
      /** False when the configured max rounds have already been used. */
      canContinueMore: boolean
      /** True when the model’s `<deep-learn-status>` was `done`. */
      modelSuggestsDone: boolean
    }
  | { kind: 'ingest'; jobId: string }
  | { kind: 'cancelled'; jobId: string }

/** Result of `kb:deepLearnRun` (multi-round research + optional URL fetch + KB ingest). */
export type DeepLearnRunResult =
  | {
      ok: true
      sourceId: string
      title: string
      roundsUsed: number
      fetchErrors?: string[]
      /** Suggestions from the last completed model round (for follow-up chats). */
      lastExplorePaths?: DeepLearnExplorePath[]
    }
  | { ok: false; error: string; cancelled?: boolean }

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
  /** Optional domain profile for domain-specific refinement. */
  domainId?: string | null
  /** Human-readable quality loop output for this run. */
  qualitySummary?: string
  /** Heuristic regression risk signal versus previous domain version. */
  regressionRisk?: 'low' | 'medium' | 'high'
  /** Associated approved-data manifest id when generated. */
  manifestId?: string
}

export type LearningEventSource = 'electron' | 'intellij-plugin'
export type LearningEventPrivacyLevel = 'strict_private'
export type LearningEventInteractionType =
  | 'chat_turn'
  | 'wiki_extract'
  | 'deep_learn'
  | 'plugin_report'
  | 'tool_outcome'

export interface LearningEvent {
  id: string
  source: LearningEventSource
  domainId?: string | null
  actor: string
  timestamp: number
  interactionType: LearningEventInteractionType
  payloadRef: string
  privacyLevel: LearningEventPrivacyLevel
  summary: string
  detailsJson?: string
}

export interface EvidenceCard {
  id: string
  domainId?: string | null
  summary: string
  supportingEventIds: string[]
  confidence: number
  noveltyScore: number
  tags: string[]
  provenance: LearningEventSource
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  updatedAt: number
}

export interface TrainingExample {
  id: string
  domainId?: string | null
  instruction: string
  context: string
  preferredOutput: string
  rationale: string
  provenanceEventIds: string[]
}

export interface TrainingManifest {
  id: string
  domainId?: string | null
  datasetHash: string
  filters: {
    sourceIds?: string[]
    domainId?: string
    approvedOnly: boolean
  }
  counts: {
    events: number
    evidenceCards: number
    examples: number
  }
  modelBase: string
  runParams: {
    datasetPath: string
    outputDir: string
  }
  previewMarkdown: string
  createdAt: number
}

export interface DomainProfile {
  id: string
  name: string
  terminology: string[]
  objective: string
  allowedSources: LearningEventSource[]
  retentionDays: number
  createdAt: number
  updatedAt: number
}

export interface DomainModelVersion {
  id: string
  domainId: string
  trainJobId: string
  artifactPath: string
  qualitySummary: string
  regressionRisk: 'low' | 'medium' | 'high'
  createdAt: number
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
  /** IDE opened a project (optional; used for codebase registry without spamming chat events). */
  | 'workspace_seen'

/** Normalized report after the desktop app accepts a plugin POST (includes server receipt time). */
export interface PluginIntegrationReport {
  receivedAt: number
  source: string
  kind: PluginIntegrationReportKind
  message?: string
  /** Small structured fields (token counts, file counts, project name, etc.). */
  meta?: Record<string, string | number | boolean | null>
}

export type CodebaseAnalysisFacet = 'domain_model' | 'design_pattern' | 'architecture_pattern'

export interface CodebaseAnalysisItem {
  name: string
  summary: string
  confidence: number
  source: 'heuristic' | 'llm'
  evidencePaths?: string[]
}

export interface CodebaseAnalysisSnapshot {
  id: string
  codebaseId: string
  rootPath: string
  createdAt: number
  gitUrl?: string | null
  kbSourceId?: string | null
  wikiSourceIds?: {
    overview?: string
    domainModel?: string
    designPatterns?: string
    architecturePatterns?: string
  }
  summaryMarkdown: string
  domainModel: CodebaseAnalysisItem[]
  designPatterns: CodebaseAnalysisItem[]
  architecturePatterns: CodebaseAnalysisItem[]
}

export interface CodebaseAnalysisSummary {
  codebaseId: string
  rootPath: string
  createdAt: number
  domainModelCount: number
  designPatternCount: number
  architecturePatternCount: number
}

export type CodebaseWikiAnalysisProgress =
  | { phase: 'start'; message: string }
  | { phase: 'scan'; message: string; filesScanned: number }
  | { phase: 'llm'; message: string }
  | { phase: 'persist'; message: string }
  | { phase: 'done'; message: string; snapshot: CodebaseAnalysisSnapshot }
  | { phase: 'error'; message: string }
