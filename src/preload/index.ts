import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { KnowledgeGraphAnalysisRunResponse } from '@shared/knowledgeGraphAnalysis'
import type {
  CodebaseAnalysisSnapshot,
  CodebaseWikiAnalysisProgress,
  DmsConnectResult,
  DmsConnectStartResponse,
  DmsConnectionSummary,
  DmsFolderSummary,
  DmsImportRootSummary,
  DmsSyncProgress,
  DmsSyncRunResult,
  DomainModelVersion,
  DomainProfile,
  DeepLearnRunProgress,
  DeepLearnRunResult,
  EvidenceCard,
  IntegrationModelActivityEvent,
  KbSearchHit,
  KbIngestJobSummary,
  PluginIntegrationReport,
  OntologyEntityDetails,
  OntologyQueryRequest,
  OntologyStats,
  OntologySubgraphPayload,
  RuntimeChatProgress,
  RuntimeLoadProgress,
  SaveIntellijPluginZipResult,
  TrainStartValidationResult,
  TrainingManifest,
  KbIngestFileProgress,
  WikiChatHighlightTerm,
  WikiExtractArticleResult,
  WikiKeywordCandidate,
  WikiPassageSummary,
  WikiExportZipResult,
  WikiTermResolutionResult,
  WikiPagePayload,
  WikiReanalyzeProgress,
  WikiReanalyzeResult,
  WikiTopic
} from '@shared/types'
import type { IntegrationBridgeSelfTestResult } from '@shared/ideJourney'
import type { ArchitectureRepositoryScanRequest, ArchitectureRepositoryScanResponse } from '@shared/architectureRepository'
import type { AppUpdateStatusPayload } from '@shared/appUpdate'
import type {
  CodebaseFormalBundle,
  CodebaseRecord,
  FormalToolProfile,
  FormalVerificationProgressPayload,
  FormalVerificationRun
} from '@shared/codebaseRegistry'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

contextBridge.exposeInMainWorld('api', {
  getPaths: () => invoke(IPC.GET_PATHS),
  checkForUpdates: () => invoke<{ ok: boolean; error?: string }>(IPC.APP_UPDATE_CHECK),
  onAppUpdateStatus: (callback: (payload: AppUpdateStatusPayload) => void) => {
    const channel = IPC.APP_UPDATE_STATUS
    const listener = (_e: IpcRendererEvent, payload: AppUpdateStatusPayload) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  openPathInExplorer: (absolutePath: string) =>
    invoke<{ ok: boolean; error?: string }>(IPC.OPEN_PATH_IN_EXPLORER, absolutePath),
  getConfig: () => invoke(IPC.GET_CONFIG),
  setConfig: (c: unknown) => invoke(IPC.SET_CONFIG, c),
  pickModelsDirectory: () => invoke<string | null>(IPC.PICK_MODELS_DIRECTORY),
  pickArchitectureRepositoryRoot: () => invoke<string | null>(IPC.ARCHITECTURE_REPO_PICK_ROOT),
  architectureRepositoryScan: (request?: ArchitectureRepositoryScanRequest) =>
    invoke<ArchitectureRepositoryScanResponse>(IPC.ARCHITECTURE_REPO_SCAN, request),
  clearDownloadCache: () =>
    invoke<{ downloadsRemoved: number; hfCacheRemoved: number; downloadsCancelled: number }>(
      IPC.CLEAR_DOWNLOAD_CACHE
    ),
  clearAllCaches: () => invoke(IPC.CLEAR_ALL_CACHES),
  deleteAllModels: () => invoke(IPC.DELETE_ALL_MODELS),
  resetFactoryConfig: () => invoke(IPC.RESET_FACTORY_CONFIG),
  confirmDestructive: (p: { message: string; detail?: string; confirmLabel?: string }) =>
    invoke<boolean>(IPC.APP_CONFIRM_DESTRUCTIVE, p),
  hardwareSummary: (destDir?: string) => invoke(IPC.HARDWARE_SUMMARY, destDir),
  hfSearch: (q: string, limit?: number) => invoke(IPC.HF_SEARCH, q, limit),
  hfRecommended: (limit?: number) => invoke(IPC.HF_RECOMMENDED, limit),
  hfModelInfo: (id: string) => invoke(IPC.HF_MODEL_INFO, id),
  hfDownload: (p: {
    repoId: string
    revision: string
    filename: string
    destDir?: string
    /** Defaults to repoId in main process when omitted. */
    chatDisplayName?: string
  }) => invoke(IPC.HF_DOWNLOAD, p),
  hfDownloadStatus: (id: string) => invoke(IPC.HF_DOWNLOAD_STATUS, id),
  hfCancelDownload: (id: string) => invoke(IPC.HF_CANCEL_DOWNLOAD, id),
  downloadsList: () => invoke(IPC.DOWNLOADS_LIST),
  runtimeList: () => invoke(IPC.RUNTIME_LIST),
  runtimeInstallPath: () => invoke(IPC.RUNTIME_INSTALL_PATH),
  listLocalModelsInDownloadDir: (additionalRoots?: string[]) =>
    invoke<{ modelsDir: string; paths: string[] }>(IPC.RUNTIME_LIST_LOCAL_MODELS, {
      additionalRoots: additionalRoots?.length ? additionalRoots : undefined
    }),
  installOllama: () => invoke(IPC.RUNTIME_INSTALL_OLLAMA),
  onOllamaInstallProgress: (callback: (payload: { message: string }) => void) => {
    const channel = IPC.RUNTIME_INSTALL_OLLAMA_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: { message: string }) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onRuntimeLoadProgress: (callback: (payload: RuntimeLoadProgress) => void) => {
    const channel = IPC.RUNTIME_LOAD_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: RuntimeLoadProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onRuntimeChatProgress: (callback: (payload: RuntimeChatProgress) => void) => {
    const channel = IPC.RUNTIME_CHAT_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: RuntimeChatProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  integrationPluginReportsList: () => invoke<PluginIntegrationReport[]>(IPC.INTEGRATION_PLUGIN_REPORTS_LIST),
  integrationBridgeSelfTest: (opts?: { smokeChat?: boolean }) =>
    invoke<IntegrationBridgeSelfTestResult>(IPC.INTEGRATION_BRIDGE_SELF_TEST, opts ?? {}),
  onIntegrationPluginReport: (callback: (payload: PluginIntegrationReport) => void) => {
    const channel = IPC.INTEGRATION_PLUGIN_REPORT
    const listener = (_e: IpcRendererEvent, payload: PluginIntegrationReport) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onIntegrationModelActivity: (callback: (payload: IntegrationModelActivityEvent) => void) => {
    const channel = IPC.INTEGRATION_MODEL_ACTIVITY
    const listener = (_e: IpcRendererEvent, payload: IntegrationModelActivityEvent) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  codebaseFormalGet: () => invoke<CodebaseFormalBundle>(IPC.CODEBASE_FORMAL_GET),
  codebaseFormalPickRoot: () => invoke<string | null>(IPC.CODEBASE_FORMAL_PICK_ROOT),
  codebaseFormalAdd: (p: { rootPath: string; displayName?: string }) =>
    invoke<{ ok: true; record: CodebaseRecord } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_ADD, p),
  codebaseFormalAddGit: (p: { gitUrl: string; displayName?: string }) =>
    invoke<{ ok: true; record: CodebaseRecord } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_ADD_GIT, p),
  codebaseFormalUpdate: (p: { id: string; displayName?: string; disabled?: boolean }) =>
    invoke<{ ok: true; record: CodebaseRecord } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_UPDATE, p),
  codebaseFormalRemove: (id: string) =>
    invoke<{ ok: true } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_REMOVE, id),
  codebaseFormalProfileAdd: (p: {
    label: string
    commandTemplate: string
    spawnMode?: 'shell' | 'exec'
    timeoutMs?: number
    expectedExitCodes?: number[]
    interpretWithLlm?: boolean
  }) =>
    invoke<{ ok: true; profile: FormalToolProfile } | { ok: false; error: string }>(
      IPC.CODEBASE_FORMAL_PROFILE_ADD,
      p
    ),
  codebaseFormalProfileUpdate: (p: { id: string; interpretWithLlm: 'inherit' | 'on' | 'off' }) =>
    invoke<{ ok: true; profile: FormalToolProfile } | { ok: false; error: string }>(
      IPC.CODEBASE_FORMAL_PROFILE_UPDATE,
      p
    ),
  codebaseFormalProfileRemove: (id: string) =>
    invoke<{ ok: true } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_PROFILE_REMOVE, id),
  codebaseFormalRunStart: (p: { codebaseId: string; profileId: string }) =>
    invoke<{ ok: true; runId: string } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_RUN_START, p),
  codebaseFormalRunList: () => invoke<FormalVerificationRun[]>(IPC.CODEBASE_FORMAL_RUN_LIST),
  codebaseFormalRunGet: (runId: string) =>
    invoke<FormalVerificationRun | null>(IPC.CODEBASE_FORMAL_RUN_GET, runId),
  codebaseFormalRunExportJson: (runId: string) =>
    invoke<{ ok: true; json: string } | { ok: false; error: string }>(IPC.CODEBASE_FORMAL_RUN_EXPORT_JSON, runId),
  codebaseFormalInterpretRun: (p: { runId: string; includeContext?: boolean }) =>
    invoke<{ ok: true; run: FormalVerificationRun } | { ok: false; error: string }>(
      IPC.CODEBASE_FORMAL_INTERPRET_RUN,
      p
    ),
  onCodebaseFormalVerificationProgress: (callback: (payload: FormalVerificationProgressPayload) => void) => {
    const channel = IPC.CODEBASE_FORMAL_VERIFICATION_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: FormalVerificationProgressPayload) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  codebaseWikiAnalyze: (p: { codebaseId: string }) =>
    invoke<{ ok: true; snapshot: CodebaseAnalysisSnapshot } | { ok: false; error: string }>(IPC.CODEBASE_WIKI_ANALYZE, p),
  codebaseWikiAnalysisLatest: () => invoke<CodebaseAnalysisSnapshot[]>(IPC.CODEBASE_WIKI_ANALYSIS_LATEST),
  onCodebaseWikiAnalysisProgress: (callback: (payload: CodebaseWikiAnalysisProgress) => void) => {
    const channel = IPC.CODEBASE_WIKI_ANALYSIS_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: CodebaseWikiAnalysisProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  openExternalUrl: (url: string) => invoke(IPC.OPEN_EXTERNAL_URL, url),
  saveIntellijPluginZip: () => invoke<SaveIntellijPluginZipResult>(IPC.APP_SAVE_INTELLIJ_PLUGIN_ZIP),
  runtimeStart: (p: { kind: 'llamacpp' | 'ollama'; modelPath: string }) => invoke(IPC.RUNTIME_START, p),
  runtimeStop: () => invoke(IPC.RUNTIME_STOP),
  runtimeStatus: () => invoke(IPC.RUNTIME_STATUS),
  ollamaListTags: () => invoke<{ names: string[]; error?: string }>(IPC.RUNTIME_OLLAMA_TAGS),
  ollamaPullModel: (modelName: string) => invoke<{ ok: true }>(IPC.RUNTIME_OLLAMA_PULL, modelName),
  onOllamaPullProgress: (callback: (payload: RuntimeLoadProgress) => void) => {
    const channel = IPC.OLLAMA_PULL_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: RuntimeLoadProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  deleteLocalGgufModel: (absolutePath: string) => invoke<{ ok: true }>(IPC.RUNTIME_DELETE_LOCAL_GGUF, absolutePath),
  deleteOllamaModel: (modelName: string) => invoke<{ ok: true }>(IPC.RUNTIME_DELETE_OLLAMA_MODEL, modelName),
  runtimeChat: (
    messages: { role: string; content: string }[],
    requestId: string,
    opts?: { maxTokens?: number; ollamaModel?: string; ollamaBaseUrl?: string }
  ) => invoke(IPC.RUNTIME_CHAT, { messages, requestId, ...opts }),
  conversationsList: () => invoke(IPC.CONVERSATIONS_LIST),
  conversationCreate: (title?: string) => invoke(IPC.CONVERSATION_CREATE, title),
  conversationMessages: (id: string) => invoke(IPC.CONVERSATION_MESSAGES, id),
  conversationRename: (id: string, title: string) =>
    invoke(IPC.CONVERSATION_RENAME, { id, title }),
  conversationDelete: (payload: { id: string; removeLinkedKnowledge: boolean }) =>
    invoke(IPC.CONVERSATION_DELETE, payload),
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
  ) => invoke(IPC.MESSAGE_APPEND, cid, role, content, modelId, usage),
  messageDelete: (conversationId: string, messageId: string) =>
    invoke<{ ok: boolean }>(IPC.MESSAGE_DELETE, { conversationId, messageId }),
  promptDomainsList: () => invoke(IPC.PROMPT_DOMAINS_LIST),
  promptDomainSetSuffix: (p: { domainId: string; systemSuffix: string }) =>
    invoke<{ ok: true }>(IPC.PROMPT_DOMAIN_SET_SUFFIX, p),
  trainBaseForFinetunePath: (artifactPath: string) =>
    invoke<{ baseModelPath: string | null }>(IPC.TRAIN_BASE_FOR_FINETUNE_PATH, artifactPath),
  kbIngestText: (title: string, uri: string, body: string) => invoke(IPC.KB_INGEST_TEXT, title, uri, body),
  kbIngestConversation: (conversationId: string) => invoke(IPC.KB_INGEST_CONVERSATION, conversationId),
  kbIngestFile: () => invoke(IPC.KB_INGEST_FILE),
  kbIngestJobs: (limit?: number) => invoke<KbIngestJobSummary[]>(IPC.KB_INGEST_JOBS, limit),
  onKbIngestFileProgress: (callback: (payload: KbIngestFileProgress) => void) => {
    const channel = IPC.KB_INGEST_FILE_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: KbIngestFileProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  kbSources: () => invoke(IPC.KB_SOURCES),
  kbSearch: (query: string, limit?: number) => invoke(IPC.KB_SEARCH, query, limit),
  kbSearchRetrieval: (p: { query: string; limit?: number; domainIds?: string[] }) =>
    invoke<KbSearchHit[]>(IPC.KB_SEARCH_RETRIEVAL, p),
  kbSearchHits: (query: string, limit?: number) => invoke<KbSearchHit[]>(IPC.KB_SEARCH_HITS, query, limit),
  kbChunks: (sourceId: string) => invoke(IPC.KB_CHUNKS, sourceId),
  kbWikiTopics: () => invoke<WikiTopic[]>(IPC.KB_WIKI_TOPICS),
  kbWikiPage: (sourceId: string) => invoke<WikiPagePayload>(IPC.KB_WIKI_PAGE, sourceId),
  kbWikiPassages: (sourceId: string) => invoke<WikiPassageSummary[]>(IPC.KB_WIKI_PASSAGES, sourceId),
  kbWikiKeywords: (p: { sourceId: string; chunkIds?: string[]; limit?: number }) =>
    invoke<WikiKeywordCandidate[]>(IPC.KB_WIKI_KEYWORDS, p),
  kbWikiExtractArticle: (p: { sourceId: string; keyword: string; chunkIds: string[]; title?: string }) =>
    invoke<WikiExtractArticleResult>(IPC.KB_WIKI_EXTRACT_ARTICLE, p),
  kbWikiResolveTerm: (p: { term: string; contextSourceId?: string; contextSnippet?: string }) =>
    invoke<WikiTermResolutionResult>(IPC.KB_WIKI_RESOLVE_TERM, p),
  kbWikiHighlightTerms: () => invoke<WikiChatHighlightTerm[]>(IPC.KB_WIKI_HIGHLIGHT_TERMS),
  kbDeleteSource: (sourceId: string) => invoke<{ ok: true }>(IPC.KB_DELETE_SOURCE, sourceId),
  kbResetWikiAndKeywords: () =>
    invoke<{ sourcesRemoved: number; promptDomainsRemoved: number }>(IPC.KB_RESET_WIKI_AND_KEYWORDS),
  kbExportWikiZip: () => invoke<WikiExportZipResult>(IPC.KB_EXPORT_WIKI_ZIP),
  kbKnowledgeGraph: () => invoke(IPC.KB_KNOWLEDGE_GRAPH),
  kbGraphAnalysisRun: (opts?: { ingestReport?: boolean }) =>
    invoke<KnowledgeGraphAnalysisRunResponse>(IPC.KB_GRAPH_ANALYSIS_RUN, opts ?? {}),
  ontologyStats: () => invoke<OntologyStats>(IPC.ONTOLOGY_STATS),
  ontologyQuerySubgraph: (request?: OntologyQueryRequest) =>
    invoke<OntologySubgraphPayload>(IPC.ONTOLOGY_QUERY_SUBGRAPH, request ?? {}),
  ontologyEntityDetails: (iri: string, limit?: number) =>
    invoke<OntologyEntityDetails>(IPC.ONTOLOGY_ENTITY_DETAILS, { iri, limit }),
  ontologyRebuild: () => invoke<{ ok: true; snapshotId: string }>(IPC.ONTOLOGY_REBUILD),
  ontologyExport: () => invoke<Record<string, unknown>>(IPC.ONTOLOGY_EXPORT),
  kbWikiReanalyzeRun: () => invoke<WikiReanalyzeResult>(IPC.KB_WIKI_REANALYZE_RUN),
  onWikiReanalyzeProgress: (callback: (payload: WikiReanalyzeProgress) => void) => {
    const channel = IPC.KB_WIKI_REANALYZE_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: WikiReanalyzeProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  kbWikiExtractTurn: (p: {
    conversationId: string
    conversationTitle?: string
    userMessage: string
    assistantMessage: string
  }) => invoke(IPC.KB_WIKI_EXTRACT_TURN, p),
  kbDeepLearnRun: (p: {
    jobId: string
    conversationId: string
    subject: string
    userMessage: string
    approvedFetchUrls: string[]
  }) => invoke<DeepLearnRunResult>(IPC.KB_DEEP_LEARN_RUN, p),
  kbDeepLearnCancel: (p: { jobId: string }) => invoke<{ ok: boolean }>(IPC.KB_DEEP_LEARN_CANCEL, p),
  kbDeepLearnResume: (p: { jobId: string; action: 'continue' | 'finish'; followUp?: string }) =>
    invoke<{ ok: boolean }>(IPC.KB_DEEP_LEARN_RESUME, p),
  onDeepLearnProgress: (callback: (payload: DeepLearnRunProgress) => void) => {
    const channel = IPC.KB_DEEP_LEARN_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: DeepLearnRunProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  dmsConnectStart: (p: {
    provider: 'google-drive' | 'onedrive' | 'sharepoint'
    clientId: string
    clientSecret?: string
    redirectUri: string
    scopes?: string[]
    tenantId?: string
    siteId?: string
  }) => invoke<DmsConnectStartResponse>(IPC.DMS_CONNECT_START, p),
  dmsConnectComplete: (p: { state: string; code: string; displayName?: string }) =>
    invoke<DmsConnectResult>(IPC.DMS_CONNECT_COMPLETE, p),
  dmsConnectWithToken: (p: {
    provider: 'google-drive' | 'onedrive' | 'sharepoint'
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    displayName?: string
    accountEmail?: string
    tenantId?: string
    siteId?: string
  }) => invoke<DmsConnectResult>(IPC.DMS_CONNECT_WITH_TOKEN, p),
  dmsConnectionsList: () => invoke<DmsConnectionSummary[]>(IPC.DMS_CONNECTIONS_LIST),
  dmsFoldersList: (connectionId: string) => invoke<DmsFolderSummary[]>(IPC.DMS_FOLDERS_LIST, connectionId),
  dmsImportRootsList: (connectionId?: string) =>
    invoke<DmsImportRootSummary[]>(IPC.DMS_IMPORT_ROOTS_LIST, connectionId ?? null),
  dmsImportStart: (p: {
    connectionId: string
    folderId: string
    folderName: string
    folderPath?: string
  }) => invoke<{ ok: true; root: DmsImportRootSummary } | { ok: false; error: string }>(IPC.DMS_IMPORT_START, p),
  dmsSyncRun: (p: {
    rootId: string
    maxFilesPerRun?: number
    maxBytesPerFile?: number
    timeoutMs?: number
  }) => invoke<DmsSyncRunResult>(IPC.DMS_SYNC_RUN, p),
  onDmsSyncProgress: (callback: (payload: DmsSyncProgress) => void) => {
    const channel = IPC.DMS_SYNC_PROGRESS
    const listener = (_e: IpcRendererEvent, payload: DmsSyncProgress) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  dmsDisconnect: (connectionId: string) => invoke<{ ok: boolean }>(IPC.DMS_DISCONNECT, connectionId),
  metricsSnapshot: (opts?: { persist?: boolean }) => invoke(IPC.METRICS_SNAPSHOT, opts),
  metricsHistory: (limit?: number) => invoke(IPC.METRICS_HISTORY, limit),
  trainStart: (p: {
    baseModelPath: string
    datasetPath?: string
    kbSourceIds?: string[]
    displayName?: string
    domainId?: string
  }) => invoke(IPC.TRAIN_START, p),
  trainValidateStart: (p: { baseModelPath: string }) =>
    invoke<TrainStartValidationResult>(IPC.TRAIN_VALIDATE_START, p),
  trainStatus: (id: string) => invoke(IPC.TRAIN_STATUS, id),
  trainListJobs: () => invoke(IPC.TRAIN_LIST_JOBS),
  trainRescanArtifact: (jobId: string) => invoke(IPC.TRAIN_RESCAN_ARTIFACT, jobId),
  trainReviewQueue: (opts?: { status?: 'pending' | 'approved' | 'rejected'; domainId?: string; limit?: number }) =>
    invoke<EvidenceCard[]>(IPC.TRAIN_REVIEW_QUEUE, opts ?? {}),
  trainReviewSetStatus: (p: { cardId: string; status: 'pending' | 'approved' | 'rejected' }) =>
    invoke<EvidenceCard>(IPC.TRAIN_REVIEW_SET_STATUS, p),
  trainManifestPreview: (p: {
    id?: string
    domainId?: string
    baseModelPath: string
    datasetPath: string
    outputDir: string
    sourceIds?: string[]
  }) => invoke<TrainingManifest>(IPC.TRAIN_MANIFEST_PREVIEW, p),
  trainDomainProfilesList: () => invoke<DomainProfile[]>(IPC.TRAIN_DOMAIN_PROFILES_LIST),
  trainDomainProfileUpsert: (p: {
    id?: string
    name: string
    terminology: string[]
    objective: string
    allowedSources: ('electron' | 'intellij-plugin')[]
    retentionDays: number
  }) => invoke<DomainProfile>(IPC.TRAIN_DOMAIN_PROFILE_UPSERT, p),
  trainDomainModelVersions: (opts?: { domainId?: string }) =>
    invoke<DomainModelVersion[]>(IPC.TRAIN_DOMAIN_MODEL_VERSIONS, opts ?? {}),
  setHfToken: (token: string | null) => invoke(IPC.SECRETS_SET_HF_TOKEN, token)
})
