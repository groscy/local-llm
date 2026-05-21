/** IPC channel names and payload shapes (Zod validated in main). */

export const IPC = {
  // App / config
  GET_PATHS: 'app:getPaths',
  /** Open a folder (or file) in the system file manager / default handler. */
  OPEN_PATH_IN_EXPLORER: 'app:openPathInExplorer',
  GET_CONFIG: 'app:getConfig',
  SET_CONFIG: 'app:setConfig',
  PICK_MODELS_DIRECTORY: 'app:pickModelsDirectory',
  /** Folder picker for Architecture Repository workspace scan (TOGAF view; architect role). */
  ARCHITECTURE_REPO_PICK_ROOT: 'app:architectureRepoPickRoot',
  /** Bounded filesystem scan for Architecture Repository (uses persisted scan root). */
  ARCHITECTURE_REPO_SCAN: 'app:architectureRepoScan',
  CLEAR_DOWNLOAD_CACHE: 'app:clearDownloadCache',
  CLEAR_ALL_CACHES: 'app:clearAllCaches',
  DELETE_ALL_MODELS: 'app:deleteAllModels',
  RESET_FACTORY_CONFIG: 'app:resetFactoryConfig',
  /** Native warning dialog; returns true if user chose the confirm action (second button). */
  APP_CONFIRM_DESTRUCTIVE: 'app:confirmDestructive',
  HARDWARE_SUMMARY: 'app:hardwareSummary',
  LOG: 'app:log',
  /** Renderer → main: trigger `electron-updater` check (packaged app only). */
  APP_UPDATE_CHECK: 'app:updateCheck',
  /** Main → renderer: auto-update lifecycle (check, download, errors). */
  APP_UPDATE_STATUS: 'app:updateStatus',

  // Hugging Face
  HF_SEARCH: 'hf:search',
  HF_RECOMMENDED: 'hf:recommended',
  HF_MODEL_INFO: 'hf:modelInfo',
  HF_DOWNLOAD: 'hf:download',
  HF_DOWNLOAD_STATUS: 'hf:downloadStatus',
  HF_CANCEL_DOWNLOAD: 'hf:cancelDownload',

  // Downloads registry
  DOWNLOADS_LIST: 'downloads:list',

  // Runtime
  RUNTIME_LIST: 'runtime:list',
  RUNTIME_INSTALL_PATH: 'runtime:installPath',
  RUNTIME_LIST_LOCAL_MODELS: 'runtime:listLocalModels',
  RUNTIME_INSTALL_OLLAMA: 'runtime:installOllama',
  /** Main → renderer: `{ message: string }` lines while install is running. */
  RUNTIME_INSTALL_OLLAMA_PROGRESS: 'runtime:installOllamaProgress',
  /** Main → renderer: load progress while `runtime:start` is in flight. */
  RUNTIME_LOAD_PROGRESS: 'runtime:loadProgress',
  RUNTIME_START: 'runtime:start',
  RUNTIME_STOP: 'runtime:stop',
  RUNTIME_STATUS: 'runtime:status',
  /** Renderer → main: list local Ollama tags from configured base URL. */
  RUNTIME_OLLAMA_TAGS: 'runtime:ollamaTags',
  /** Pull a model into the Ollama library (does not start the chat runtime). */
  RUNTIME_OLLAMA_PULL: 'runtime:ollamaPull',
  /** Main → renderer: progress during `RUNTIME_OLLAMA_PULL`. */
  OLLAMA_PULL_PROGRESS: 'runtime:ollamaPullProgress',
  /** Delete one local weight file (`.gguf` / `.safetensors` / `.safetensor`) under the models directory (must unload if active). */
  RUNTIME_DELETE_LOCAL_GGUF: 'runtime:deleteLocalGguf',
  /** Remove one model from the Ollama daemon (`/api/delete`). */
  RUNTIME_DELETE_OLLAMA_MODEL: 'runtime:deleteOllamaModel',
  RUNTIME_CHAT: 'runtime:chat',
  /** Main → renderer: streamed assistant tokens; correlate with `requestId` from `RUNTIME_CHAT`. */
  RUNTIME_CHAT_PROGRESS: 'runtime:chatProgress',
  ONTOLOGY_STATS: 'ontology:stats',
  ONTOLOGY_QUERY_SUBGRAPH: 'ontology:querySubgraph',
  ONTOLOGY_ENTITY_DETAILS: 'ontology:entityDetails',
  ONTOLOGY_REBUILD: 'ontology:rebuild',
  ONTOLOGY_EXPORT: 'ontology:export',
  OPEN_EXTERNAL_URL: 'shell:openExternalUrl',
  /** Save dialog → copy bundled / dev-built plugin ZIP, or download from GitHub latest release. */
  APP_SAVE_INTELLIJ_PLUGIN_ZIP: 'app:saveIntellijPluginZip',

  // Chat / persistence
  CONVERSATIONS_LIST: 'chat:conversationsList',
  CONVERSATION_CREATE: 'chat:conversationCreate',
  CONVERSATION_MESSAGES: 'chat:conversationMessages',
  CONVERSATION_RENAME: 'chat:conversationRename',
  MESSAGE_APPEND: 'chat:messageAppend',
  MESSAGE_DELETE: 'chat:messageDelete',
  CONVERSATION_DELETE: 'chat:conversationDelete',
  /** Keyword-based domains learned from user prompts (see `promptDomainService`). */
  PROMPT_DOMAINS_LIST: 'chat:promptDomainsList',
  PROMPT_DOMAIN_SET_SUFFIX: 'chat:promptDomainSetSuffix',

  /** Resolve base GGUF path for a finetune artifact recorded on a completed train job. */
  TRAIN_BASE_FOR_FINETUNE_PATH: 'train:baseForFinetunePath',

  // Knowledge / RAG
  KB_INGEST_TEXT: 'kb:ingestText',
  KB_INGEST_FILE: 'kb:ingestFile',
  KB_INGEST_FILE_PROGRESS: 'kb:ingestFileProgress',
  KB_INGEST_JOBS: 'kb:ingestJobs',
  KB_INGEST_CONVERSATION: 'kb:ingestConversation',
  KB_SOURCES: 'kb:sources',
  KB_SEARCH: 'kb:search',
  KB_SEARCH_RETRIEVAL: 'kb:searchRetrieval',
  KB_DOMAINS_LIST: 'kb:domainsList',
  KB_SOURCE_SET_DOMAIN: 'kb:sourceSetDomain',
  /** Full-text search with source id/title and snippet (deduped per source). */
  KB_SEARCH_HITS: 'kb:searchHits',
  KB_CHUNKS: 'kb:chunks',
  KB_WIKI_TOPICS: 'kb:wikiTopics',
  KB_WIKI_PAGE: 'kb:wikiPage',
  KB_WIKI_CLEANUP_ARTICLE: 'kb:wikiCleanupArticle',
  KB_WIKI_CLEANUP_PROGRESS: 'kb:wikiCleanupProgress',
  KB_WIKI_PASSAGES: 'kb:wikiPassages',
  KB_WIKI_KEYWORDS: 'kb:wikiKeywords',
  KB_WIKI_EXTRACT_ARTICLE: 'kb:wikiExtractArticle',
  KB_WIKI_RESOLVE_TERM: 'kb:wikiResolveTerm',
  /** Phrases from wiki titles, chunk headings, and glossary blocks for in-chat highlighting. */
  KB_WIKI_HIGHLIGHT_TERMS: 'kb:wikiHighlightTerms',
  /** Remove one KB source (chunks, FTS, compiled wiki page, links). */
  KB_DELETE_SOURCE: 'kb:deleteSource',
  /** Remove all KB sources, wiki pages, message↔domain links, and all prompt-domain rows. */
  KB_RESET_WIKI_AND_KEYWORDS: 'kb:resetWikiAndKeywords',
  /** Save dialog → write all wiki sources + manifest to a ZIP. */
  KB_EXPORT_WIKI_ZIP: 'kb:exportWikiZip',
  /** Structural graph: sources → chunks, wiki pages → chunks, optional related sources. */
  KB_KNOWLEDGE_GRAPH: 'kb:knowledgeGraph',
  /** Semantic graph: noun entities, verb relations, adjective descriptors, and scope overlaps. */
  KB_SEMANTIC_GRAPH: 'kb:semanticGraph',
  /** Keyword-first graph with canonical entities and typed relations. */
  KB_KEYWORD_GRAPH: 'kb:keywordGraph',
  /** Bounded neighborhood expansion around one keyword node. */
  KB_KEYWORD_GRAPH_NEIGHBORS: 'kb:keywordGraphNeighbors',
  /** Fuzzy keyword lookup for graph search/focus. */
  KB_KEYWORD_GRAPH_SEARCH: 'kb:keywordGraphSearch',
  /** Deterministic cluster / hub / refinement analysis over the current graph; optional markdown ingest. */
  KB_GRAPH_ANALYSIS_RUN: 'kb:graphAnalysisRun',
  /** After a chat turn: run a short local model pass to extract wiki notes and ingest (optional). */
  KB_WIKI_EXTRACT_TURN: 'kb:wikiExtractTurn',
  /** Reanalyze and distill all wiki entries with the currently loaded model. */
  KB_WIKI_REANALYZE_RUN: 'kb:wikiReanalyzeRun',
  /** Main → renderer: progress while `KB_WIKI_REANALYZE_RUN` is executing. */
  KB_WIKI_REANALYZE_PROGRESS: 'kb:wikiReanalyzeProgress',
  /** Multi-round “learn everything about …” research → single KB ingest (wiki + graph). */
  KB_DEEP_LEARN_RUN: 'kb:deepLearnRun',
  /** Abort an in-flight `KB_DEEP_LEARN_RUN` by `jobId`. */
  KB_DEEP_LEARN_CANCEL: 'kb:deepLearnCancel',
  /** After `roundAwaitChoice` progress: continue another round (optional focus) or finish and ingest. */
  KB_DEEP_LEARN_RESUME: 'kb:deepLearnResume',
  /** Main → renderer: progress for deep-learn (`jobId` matches renderer request). */
  KB_DEEP_LEARN_PROGRESS: 'kb:deepLearnProgress',

  // DMS imports
  DMS_CONNECT_START: 'dms:connectStart',
  DMS_CONNECT_COMPLETE: 'dms:connectComplete',
  DMS_CONNECT_WITH_TOKEN: 'dms:connectWithToken',
  DMS_CONNECTIONS_LIST: 'dms:connectionsList',
  DMS_FOLDERS_LIST: 'dms:foldersList',
  DMS_IMPORT_ROOTS_LIST: 'dms:importRootsList',
  DMS_IMPORT_START: 'dms:importStart',
  DMS_SYNC_RUN: 'dms:syncRun',
  DMS_SYNC_PROGRESS: 'dms:syncProgress',
  DMS_DISCONNECT: 'dms:disconnect',

  // Metrics
  METRICS_SNAPSHOT: 'metrics:snapshot',
  METRICS_HISTORY: 'metrics:history',

  // Training
  TRAIN_VALIDATE_START: 'train:validateStart',
  TRAIN_START: 'train:start',
  TRAIN_STATUS: 'train:status',
  TRAIN_LIST_JOBS: 'train:listJobs',
  /** Re-scan a finished job’s output folder for new .gguf and copy to models/finetunes */
  TRAIN_RESCAN_ARTIFACT: 'train:rescanArtifact',
  /** Human-readable automatic evidence cards queued from local usage telemetry. */
  TRAIN_REVIEW_QUEUE: 'train:reviewQueue',
  /** Update one evidence card status (`approved`/`rejected`/`pending`). */
  TRAIN_REVIEW_SET_STATUS: 'train:reviewSetStatus',
  /** Build an inspectable training manifest from approved evidence before start. */
  TRAIN_MANIFEST_PREVIEW: 'train:manifestPreview',
  /** Domain profiles route learning events into domain-specific datasets. */
  TRAIN_DOMAIN_PROFILES_LIST: 'train:domainProfilesList',
  TRAIN_DOMAIN_PROFILE_UPSERT: 'train:domainProfileUpsert',
  /** Trained model versions + quality summaries per domain. */
  TRAIN_DOMAIN_MODEL_VERSIONS: 'train:domainModelVersions',

  SECRETS_SET_HF_TOKEN: 'secrets:setHfToken',

  /** Main → renderer: IDE plugin posted activity to the HTTP bridge. */
  INTEGRATION_PLUGIN_REPORT: 'integration:pluginReport',
  /** Main → renderer: live model activity for IDE `/v1/chat` requests. */
  INTEGRATION_MODEL_ACTIVITY: 'integration:modelActivity',
  /** Renderer → main: last N reports (for initial load). */
  INTEGRATION_PLUGIN_REPORTS_LIST: 'integration:pluginReportsList',
  /** Renderer → main: launch local Claude bridge wrapper process. */
  CLAUDE_BRIDGE_START: 'integration:claudeBridgeStart',
  /** Renderer → main: memory capture summary for Claude integration. */
  CLAUDE_MEMORY_STATUS: 'integration:claudeMemoryStatus',
  CLAUDE_MEMORY_SESSIONS: 'integration:claudeMemorySessions',
  CLAUDE_MEMORY_SESSION_EVENTS: 'integration:claudeMemorySessionEvents',
  CLAUDE_MEMORY_EXPORT_JSONL: 'integration:claudeMemoryExportJsonl',
  /** Renderer → main: GET http://127.0.0.1:{port}/health from the main process (loopback self-test). */
  INTEGRATION_BRIDGE_SELF_TEST: 'integration:bridgeSelfTest',

  /** Codebase registry + formal (external tool) verification — persisted bundle. */
  CODEBASE_FORMAL_GET: 'codebaseFormal:get',
  CODEBASE_FORMAL_ADD: 'codebaseFormal:add',
  CODEBASE_FORMAL_ADD_GIT: 'codebaseFormal:addGit',
  CODEBASE_FORMAL_UPDATE: 'codebaseFormal:update',
  CODEBASE_FORMAL_REMOVE: 'codebaseFormal:remove',
  CODEBASE_FORMAL_PICK_ROOT: 'codebaseFormal:pickRoot',
  CODEBASE_FORMAL_PROFILE_ADD: 'codebaseFormal:profileAdd',
  CODEBASE_FORMAL_PROFILE_UPDATE: 'codebaseFormal:profileUpdate',
  CODEBASE_FORMAL_PROFILE_REMOVE: 'codebaseFormal:profileRemove',
  CODEBASE_FORMAL_RUN_START: 'codebaseFormal:runStart',
  CODEBASE_FORMAL_RUN_GET: 'codebaseFormal:runGet',
  CODEBASE_FORMAL_RUN_LIST: 'codebaseFormal:runList',
  CODEBASE_FORMAL_RUN_EXPORT_JSON: 'codebaseFormal:runExportJson',
  /** Renderer → main: summarize a completed run with the local model (advisory). */
  CODEBASE_FORMAL_INTERPRET_RUN: 'codebaseFormal:interpretRun',
  /** Main → renderer: formal verification stdout/stderr chunks and final row. */
  CODEBASE_FORMAL_VERIFICATION_PROGRESS: 'codebaseFormal:verificationProgress',
  CODEBASE_WIKI_ANALYZE: 'codebaseWiki:analyze',
  CODEBASE_WIKI_ANALYSIS_LATEST: 'codebaseWiki:analysisLatest',
  /** Main → renderer: progress for codebase scan + enrichment pipeline. */
  CODEBASE_WIKI_ANALYSIS_PROGRESS: 'codebaseWiki:analysisProgress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
