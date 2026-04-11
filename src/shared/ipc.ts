/** IPC channel names and payload shapes (Zod validated in main). */

export const IPC = {
  // App / config
  GET_PATHS: 'app:getPaths',
  GET_CONFIG: 'app:getConfig',
  SET_CONFIG: 'app:setConfig',
  PICK_MODELS_DIRECTORY: 'app:pickModelsDirectory',
  CLEAR_DOWNLOAD_CACHE: 'app:clearDownloadCache',
  CLEAR_ALL_CACHES: 'app:clearAllCaches',
  DELETE_ALL_MODELS: 'app:deleteAllModels',
  RESET_FACTORY_CONFIG: 'app:resetFactoryConfig',
  /** Native warning dialog; returns true if user chose the confirm action (second button). */
  APP_CONFIRM_DESTRUCTIVE: 'app:confirmDestructive',
  HARDWARE_SUMMARY: 'app:hardwareSummary',
  LOG: 'app:log',

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
  OPEN_EXTERNAL_URL: 'shell:openExternalUrl',

  // Chat / persistence
  CONVERSATIONS_LIST: 'chat:conversationsList',
  CONVERSATION_CREATE: 'chat:conversationCreate',
  CONVERSATION_MESSAGES: 'chat:conversationMessages',
  CONVERSATION_RENAME: 'chat:conversationRename',
  MESSAGE_APPEND: 'chat:messageAppend',
  CONVERSATION_DELETE: 'chat:conversationDelete',

  // Knowledge / RAG
  KB_INGEST_TEXT: 'kb:ingestText',
  KB_INGEST_FILE: 'kb:ingestFile',
  KB_INGEST_CONVERSATION: 'kb:ingestConversation',
  KB_SOURCES: 'kb:sources',
  KB_SEARCH: 'kb:search',
  /** Full-text search with source id/title and snippet (deduped per source). */
  KB_SEARCH_HITS: 'kb:searchHits',
  KB_CHUNKS: 'kb:chunks',
  KB_WIKI_TOPICS: 'kb:wikiTopics',
  KB_WIKI_PAGE: 'kb:wikiPage',
  /** Phrases from wiki titles, chunk headings, and glossary blocks for in-chat highlighting. */
  KB_WIKI_HIGHLIGHT_TERMS: 'kb:wikiHighlightTerms',
  /** Remove one KB source (chunks, FTS, compiled wiki page, links). */
  KB_DELETE_SOURCE: 'kb:deleteSource',
  /** Save dialog → write all wiki sources + manifest to a ZIP. */
  KB_EXPORT_WIKI_ZIP: 'kb:exportWikiZip',
  /** Structural graph: sources → chunks, wiki pages → chunks, optional related sources. */
  KB_KNOWLEDGE_GRAPH: 'kb:knowledgeGraph',
  /** After a chat turn: run a short local model pass to extract wiki notes and ingest (optional). */
  KB_WIKI_EXTRACT_TURN: 'kb:wikiExtractTurn',

  // Metrics
  METRICS_SNAPSHOT: 'metrics:snapshot',
  METRICS_HISTORY: 'metrics:history',

  // Training
  TRAIN_START: 'train:start',
  TRAIN_STATUS: 'train:status',
  TRAIN_LIST_JOBS: 'train:listJobs',

  SECRETS_SET_HF_TOKEN: 'secrets:setHfToken',

  /** Main → renderer: IDE plugin posted activity to the HTTP bridge. */
  INTEGRATION_PLUGIN_REPORT: 'integration:pluginReport',
  /** Renderer → main: last N reports (for initial load). */
  INTEGRATION_PLUGIN_REPORTS_LIST: 'integration:pluginReportsList'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
