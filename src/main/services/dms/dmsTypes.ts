import type { DmsProvider, DmsSyncProgress } from '@shared/types'

export const DMS_MAX_FILE_BYTES_DEFAULT = 25 * 1024 * 1024
export const DMS_MAX_FILES_PER_RUN_DEFAULT = 2000
export const DMS_SYNC_TIMEOUT_MS_DEFAULT = 30 * 60 * 1000

export type DmsAuthConfig = {
  clientId: string
  clientSecret?: string
  redirectUri: string
  scopes: string[]
  tenantId?: string
  siteId?: string
}

export type DmsTokenSet = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
}

export type DmsConnectionSecret = DmsTokenSet & {
  tokenUrl?: string
  authConfig?: DmsAuthConfig
}

export type DmsConnectionRow = {
  id: string
  provider: DmsProvider
  displayName: string
  accountEmail: string | null
  tenantId: string | null
  siteId: string | null
  tokenRef: string
  status: 'connected' | 'error' | 'expired'
  createdAt: number
  updatedAt: number
  lastSyncedAt: number | null
}

export type DmsImportRootRow = {
  id: string
  connectionId: string
  externalFolderId: string
  displayName: string
  externalPath: string
  createdAt: number
  updatedAt: number
  lastSyncedAt: number | null
}

export type DmsImportItemRow = {
  id: string
  rootId: string
  externalFileId: string
  externalPath: string
  etag: string | null
  mimeType: string | null
  kbSourceId: string | null
  lastSeenAt: number
  state: 'active' | 'removed' | 'failed'
  updatedAt: number
}

export type DmsSyncRunRow = {
  id: string
  rootId: string
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'success' | 'error'
  importedCount: number
  updatedCount: number
  skippedCount: number
  removedCount: number
  errorText: string | null
  artifactsJson: string | null
}

export type DmsRemoteFolder = {
  id: string
  name: string
  path: string
}

export type DmsRemoteFile = {
  id: string
  name: string
  path: string
  mimeType?: string
  etag?: string
  sizeBytes?: number
  isFolder: boolean
}

export type DmsDownloadedFile = {
  file: DmsRemoteFile
  bytes: Uint8Array
}

export type DmsProviderClient = {
  listFolders: () => Promise<DmsRemoteFolder[]>
  listFolderContents: (folderId: string) => Promise<DmsRemoteFile[]>
  downloadFile: (fileId: string) => Promise<DmsDownloadedFile>
}

export type DmsProviderFactoryContext = {
  connection: DmsConnectionRow
  secret: DmsConnectionSecret
  onSecretRefresh?: (next: DmsConnectionSecret) => void
}

export type DmsProviderFactory = (ctx: DmsProviderFactoryContext) => DmsProviderClient

export type DmsSyncLimits = {
  maxFilesPerRun: number
  maxBytesPerFile: number
  timeoutMs: number
}

export type DmsSyncContext = {
  runId: string
  rootId: string
  onProgress?: (payload: DmsSyncProgress) => void
}
