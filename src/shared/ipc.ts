/** IPC channel names and payload shapes (Zod validated in main). */

export const IPC = {
  // App / config
  GET_PATHS: 'app:getPaths',
  GET_CONFIG: 'app:getConfig',
  SET_CONFIG: 'app:setConfig',
  PICK_MODELS_DIRECTORY: 'app:pickModelsDirectory',
  CLEAR_DOWNLOAD_CACHE: 'app:clearDownloadCache',
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
  RUNTIME_START: 'runtime:start',
  RUNTIME_STOP: 'runtime:stop',
  RUNTIME_STATUS: 'runtime:status',
  RUNTIME_CHAT: 'runtime:chat',

  // Chat / persistence
  CONVERSATIONS_LIST: 'chat:conversationsList',
  CONVERSATION_CREATE: 'chat:conversationCreate',
  CONVERSATION_MESSAGES: 'chat:conversationMessages',
  MESSAGE_APPEND: 'chat:messageAppend',
  CONVERSATION_DELETE: 'chat:conversationDelete',

  // Knowledge / RAG
  KB_INGEST_TEXT: 'kb:ingestText',
  KB_INGEST_FILE: 'kb:ingestFile',
  KB_INGEST_CONVERSATION: 'kb:ingestConversation',
  KB_SOURCES: 'kb:sources',
  KB_SEARCH: 'kb:search',
  KB_CHUNKS: 'kb:chunks',
  KB_WIKI_TOPICS: 'kb:wikiTopics',
  KB_WIKI_PAGE: 'kb:wikiPage',

  // Metrics
  METRICS_SNAPSHOT: 'metrics:snapshot',
  METRICS_HISTORY: 'metrics:history',

  // Training
  TRAIN_START: 'train:start',
  TRAIN_STATUS: 'train:status',
  TRAIN_LIST_JOBS: 'train:listJobs',

  SECRETS_SET_HF_TOKEN: 'secrets:setHfToken'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
