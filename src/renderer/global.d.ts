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
  DownloadRow,
  EvidenceCard,
  HardwareSummary,
  KbIngestJobSummary,
  KbIngestFileProgress,
  KbDomainOption,
  KbSourceDomainUpdateResult,
  KbSearchHit,
  IntegrationModelActivityEvent,
  KnowledgeGraphPayload,
  OntologyEntityDetails,
  OntologyQueryRequest,
  OntologyStats,
  OntologySubgraphPayload,
  WikiExtractTurnResult,
  PluginIntegrationReport,
  RuntimeChatProgress,
  RuntimeLoadProgress,
  RuntimeStatus,
  TrainStartValidationResult,
  TrainingManifest,
  WikiChatHighlightTerm,
  WikiExtractArticleResult,
  WikiArticleCleanupResult,
  WikiArticleCleanupProgress,
  SaveIntellijPluginZipResult,
  WikiExportZipResult,
  WikiKeywordCandidate,
  WikiTermResolutionResult,
  WikiPagePayload,
  WikiPassageSummary,
  WikiReanalyzeProgress,
  WikiReanalyzeResult,
  WikiTopic,
  PromptDomainRow
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

export {}

type Api = {
  getPaths: () => Promise<{
    userData: string
    logs: string
    modelsDefault: string
    db: string
    vectors: string
    platform: NodeJS.Platform
    appVersion: string
    /** True when `electron-updater` can run (packaged app, not dev). */
    updatesSupported: boolean
  }>
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>
  onAppUpdateStatus: (callback: (payload: AppUpdateStatusPayload) => void) => () => void
  openPathInExplorer: (absolutePath: string) => Promise<{ ok: boolean; error?: string }>
  getConfig: () => Promise<
    Record<string, unknown> & {
      hfTokenSet?: boolean
      showElectronDevMainView?: boolean
      uiRole?: string
      workspaceDensity?: string
      releaseFeatureSet?: Record<string, boolean>
      navRailShowLabels?: boolean
      setupTourVersion?: number
      setupTourOnStartup?: boolean
      typographyComfort?: string
      typographyFontFamily?: string
      typographyLineHeightFactor?: number
      typographyLetterSpacingExtraEm?: number
      typographyWordSpacingEm?: number
      formalVerificationInterpretWithLlm?: boolean
      formalVerificationInterpretIncludeKb?: boolean
    }
  >
  setConfig: (c: unknown) => Promise<{ ok: boolean; error?: string }>
  /** Native folder picker; returns absolute path or null if cancelled. */
  pickModelsDirectory: () => Promise<string | null>
  /** Pick workspace root for Architecture Repository scan (does not persist until setConfig). */
  pickArchitectureRepositoryRoot: () => Promise<string | null>
  /** Bounded scan of `architectureRepositoryScanRoot` from settings. */
  architectureRepositoryScan: (request?: ArchitectureRepositoryScanRequest) => Promise<ArchitectureRepositoryScanResponse>
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
  integrationBridgeSelfTest: (opts?: { smokeChat?: boolean }) => Promise<IntegrationBridgeSelfTestResult>
  onIntegrationPluginReport: (callback: (payload: PluginIntegrationReport) => void) => () => void
  onIntegrationModelActivity: (callback: (payload: IntegrationModelActivityEvent) => void) => () => void
  codebaseFormalGet: () => Promise<CodebaseFormalBundle>
  codebaseFormalPickRoot: () => Promise<string | null>
  codebaseFormalAdd: (p: {
    rootPath: string
    displayName?: string
  }) => Promise<{ ok: true; record: CodebaseRecord } | { ok: false; error: string }>
  codebaseFormalAddGit: (p: {
    gitUrl: string
    displayName?: string
  }) => Promise<{ ok: true; record: CodebaseRecord } | { ok: false; error: string }>
  codebaseFormalUpdate: (p: {
    id: string
    displayName?: string
    disabled?: boolean
  }) => Promise<{ ok: true; record: CodebaseRecord } | { ok: false; error: string }>
  codebaseFormalRemove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  codebaseFormalProfileAdd: (p: {
    label: string
    commandTemplate: string
    spawnMode?: 'shell' | 'exec'
    timeoutMs?: number
    expectedExitCodes?: number[]
    interpretWithLlm?: boolean
  }) => Promise<{ ok: true; profile: FormalToolProfile } | { ok: false; error: string }>
  codebaseFormalProfileUpdate: (p: {
    id: string
    interpretWithLlm: 'inherit' | 'on' | 'off'
  }) => Promise<{ ok: true; profile: FormalToolProfile } | { ok: false; error: string }>
  codebaseFormalProfileRemove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  codebaseFormalRunStart: (p: {
    codebaseId: string
    profileId: string
  }) => Promise<{ ok: true; runId: string } | { ok: false; error: string }>
  codebaseFormalRunList: () => Promise<FormalVerificationRun[]>
  codebaseFormalRunGet: (runId: string) => Promise<FormalVerificationRun | null>
  codebaseFormalRunExportJson: (runId: string) => Promise<{ ok: true; json: string } | { ok: false; error: string }>
  codebaseFormalInterpretRun: (p: {
    runId: string
    includeContext?: boolean
  }) => Promise<{ ok: true; run: FormalVerificationRun } | { ok: false; error: string }>
  onCodebaseFormalVerificationProgress: (
    callback: (payload: FormalVerificationProgressPayload) => void
  ) => () => void
  codebaseWikiAnalyze: (
    p: { codebaseId: string }
  ) => Promise<{ ok: true; snapshot: CodebaseAnalysisSnapshot } | { ok: false; error: string }>
  codebaseWikiAnalysisLatest: () => Promise<CodebaseAnalysisSnapshot[]>
  onCodebaseWikiAnalysisProgress: (
    callback: (payload: CodebaseWikiAnalysisProgress) => void
  ) => () => void
  openExternalUrl: (url: string) => Promise<{ ok: boolean }>
  /** Save dialog: copy local/bundled Gradle ZIP when present, else download from GitHub latest. */
  saveIntellijPluginZip: () => Promise<SaveIntellijPluginZipResult>
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
  kbIngestJobs: (limit?: number) => Promise<KbIngestJobSummary[]>
  onKbIngestFileProgress: (callback: (payload: KbIngestFileProgress) => void) => () => void
  kbSources: () => Promise<unknown[]>
  kbSearch: (query: string, limit?: number) => Promise<string[]>
  kbSearchRetrieval: (p: { query: string; limit?: number; domainIds?: string[] }) => Promise<KbSearchHit[]>
  kbDomainsList: (limit?: number) => Promise<KbDomainOption[]>
  kbSourceSetDomain: (p: { sourceId: string; domainTitle: string }) => Promise<KbSourceDomainUpdateResult>
  kbSearchHits: (query: string, limit?: number) => Promise<KbSearchHit[]>
  kbChunks: (sourceId: string) => Promise<unknown[]>
  kbWikiTopics: () => Promise<WikiTopic[]>
  kbWikiPage: (sourceId: string) => Promise<WikiPagePayload>
  kbWikiCleanupArticle: (sourceId: string) => Promise<WikiArticleCleanupResult>
  onWikiArticleCleanupProgress: (callback: (payload: WikiArticleCleanupProgress) => void) => () => void
  kbWikiPassages: (sourceId: string) => Promise<WikiPassageSummary[]>
  kbWikiKeywords: (p: {
    sourceId: string
    chunkIds?: string[]
    limit?: number
  }) => Promise<WikiKeywordCandidate[]>
  kbWikiExtractArticle: (p: {
    sourceId: string
    keyword: string
    chunkIds: string[]
    title?: string
  }) => Promise<WikiExtractArticleResult>
  kbWikiResolveTerm: (p: {
    term: string
    contextSourceId?: string
    contextSnippet?: string
  }) => Promise<WikiTermResolutionResult>
  kbWikiHighlightTerms: () => Promise<WikiChatHighlightTerm[]>
  kbDeleteSource: (sourceId: string) => Promise<{ ok: true }>
  kbResetWikiAndKeywords: () => Promise<{ sourcesRemoved: number; promptDomainsRemoved: number }>
  kbExportWikiZip: () => Promise<WikiExportZipResult>
  kbKnowledgeGraph: () => Promise<KnowledgeGraphPayload>
  kbGraphAnalysisRun: (opts?: { ingestReport?: boolean }) => Promise<KnowledgeGraphAnalysisRunResponse>
  ontologyStats: () => Promise<OntologyStats>
  ontologyQuerySubgraph: (request?: OntologyQueryRequest) => Promise<OntologySubgraphPayload>
  ontologyEntityDetails: (iri: string, limit?: number) => Promise<OntologyEntityDetails>
  ontologyRebuild: () => Promise<{ ok: true; snapshotId: string }>
  ontologyExport: () => Promise<Record<string, unknown>>
  kbWikiReanalyzeRun: () => Promise<WikiReanalyzeResult>
  onWikiReanalyzeProgress: (callback: (payload: WikiReanalyzeProgress) => void) => () => void
  kbWikiExtractTurn: (p: {
    conversationId: string
    conversationTitle?: string
    userMessage: string
    assistantMessage: string
  }) => Promise<WikiExtractTurnResult>
  kbDeepLearnRun: (p: {
    jobId: string
    conversationId: string
    subject: string
    userMessage: string
    approvedFetchUrls: string[]
  }) => Promise<DeepLearnRunResult>
  kbDeepLearnCancel: (p: { jobId: string }) => Promise<{ ok: boolean }>
  kbDeepLearnResume: (p: {
    jobId: string
    action: 'continue' | 'finish'
    followUp?: string
  }) => Promise<{ ok: boolean }>
  onDeepLearnProgress: (callback: (payload: DeepLearnRunProgress) => void) => () => void
  dmsConnectStart: (p: {
    provider: 'google-drive' | 'onedrive' | 'sharepoint'
    clientId: string
    clientSecret?: string
    redirectUri: string
    scopes?: string[]
    tenantId?: string
    siteId?: string
  }) => Promise<DmsConnectStartResponse>
  dmsConnectComplete: (p: { state: string; code: string; displayName?: string }) => Promise<DmsConnectResult>
  dmsConnectWithToken: (p: {
    provider: 'google-drive' | 'onedrive' | 'sharepoint'
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    displayName?: string
    accountEmail?: string
    tenantId?: string
    siteId?: string
  }) => Promise<DmsConnectResult>
  dmsConnectionsList: () => Promise<DmsConnectionSummary[]>
  dmsFoldersList: (connectionId: string) => Promise<DmsFolderSummary[]>
  dmsImportRootsList: (connectionId?: string) => Promise<DmsImportRootSummary[]>
  dmsImportStart: (p: {
    connectionId: string
    folderId: string
    folderName: string
    folderPath?: string
  }) => Promise<{ ok: true; root: DmsImportRootSummary } | { ok: false; error: string }>
  dmsSyncRun: (p: {
    rootId: string
    maxFilesPerRun?: number
    maxBytesPerFile?: number
    timeoutMs?: number
  }) => Promise<DmsSyncRunResult>
  onDmsSyncProgress: (callback: (payload: DmsSyncProgress) => void) => () => void
  dmsDisconnect: (connectionId: string) => Promise<{ ok: boolean }>
  metricsSnapshot: (opts?: { persist?: boolean }) => Promise<unknown>
  metricsHistory: (limit?: number) => Promise<unknown[]>
  trainStart: (p: {
    baseModelPath: string
    datasetPath?: string
    kbSourceIds?: string[]
    displayName?: string
    domainId?: string
  }) => Promise<unknown>
  trainValidateStart: (p: { baseModelPath: string }) => Promise<TrainStartValidationResult>
  trainStatus: (id: string) => Promise<unknown>
  trainListJobs: () => Promise<unknown[]>
  trainRescanArtifact: (jobId: string) => Promise<unknown>
  trainReviewQueue: (opts?: {
    status?: 'pending' | 'approved' | 'rejected'
    domainId?: string
    limit?: number
  }) => Promise<EvidenceCard[]>
  trainReviewSetStatus: (p: { cardId: string; status: 'pending' | 'approved' | 'rejected' }) => Promise<EvidenceCard>
  trainManifestPreview: (p: {
    id?: string
    domainId?: string
    baseModelPath: string
    datasetPath: string
    outputDir: string
    sourceIds?: string[]
  }) => Promise<TrainingManifest>
  trainDomainProfilesList: () => Promise<DomainProfile[]>
  trainDomainProfileUpsert: (p: {
    id?: string
    name: string
    terminology: string[]
    objective: string
    allowedSources: ('electron' | 'intellij-plugin')[]
    retentionDays: number
  }) => Promise<DomainProfile>
  trainDomainModelVersions: (opts?: { domainId?: string }) => Promise<DomainModelVersion[]>
  setHfToken: (token: string | null) => Promise<{ ok: boolean; warn?: string }>
}

declare global {
  interface Window {
    api: Api
  }
}
