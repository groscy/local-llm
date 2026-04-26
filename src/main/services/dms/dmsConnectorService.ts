import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type Store from 'electron-store'
import type {
  DmsConnectResult,
  DmsConnectStartResponse,
  DmsConnectionSummary,
  DmsFolderSummary,
  DmsImportRootSummary,
  DmsProvider
} from '@shared/types'
import type {
  DmsAuthConfig,
  DmsConnectionRow,
  DmsConnectionSecret,
  DmsImportItemRow,
  DmsImportRootRow,
  DmsProviderClient,
  DmsProviderFactory
} from './dmsTypes'
import { readDmsSecret, removeDmsSecret, upsertDmsSecret } from './dmsSecrets'
import { createGoogleDriveProvider } from './providers/googleDriveProvider'
import { createOneDriveProvider } from './providers/oneDriveProvider'
import { createSharePointProvider } from './providers/sharePointProvider'

const providerFactories: Record<DmsProvider, DmsProviderFactory> = {
  'google-drive': createGoogleDriveProvider,
  onedrive: createOneDriveProvider,
  sharepoint: createSharePointProvider
}

const pendingAuthState = new Map<string, { provider: DmsProvider; config: DmsAuthConfig; createdAt: number }>()

function normalizeConnection(row: DmsConnectionRow): DmsConnectionSummary {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.displayName,
    accountEmail: row.accountEmail,
    tenantId: row.tenantId,
    siteId: row.siteId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSyncedAt: row.lastSyncedAt
  }
}

export function listDmsConnections(db: Database.Database): DmsConnectionSummary[] {
  const rows = db
    .prepare(
      `SELECT id, provider, display_name as displayName, account_email as accountEmail, tenant_id as tenantId,
              site_id as siteId, token_ref as tokenRef, status, created_at as createdAt, updated_at as updatedAt,
              last_synced_at as lastSyncedAt
       FROM dms_connections
       ORDER BY updated_at DESC`
    )
    .all() as DmsConnectionRow[]
  return rows.map(normalizeConnection)
}

export function getDmsConnectionById(db: Database.Database, connectionId: string): DmsConnectionRow | null {
  const row = db
    .prepare(
      `SELECT id, provider, display_name as displayName, account_email as accountEmail, tenant_id as tenantId,
              site_id as siteId, token_ref as tokenRef, status, created_at as createdAt, updated_at as updatedAt,
              last_synced_at as lastSyncedAt
       FROM dms_connections WHERE id = ?`
    )
    .get(connectionId) as DmsConnectionRow | undefined
  return row ?? null
}

function tokenEndpoint(provider: DmsProvider, tenantId?: string): string {
  if (provider === 'google-drive') return 'https://oauth2.googleapis.com/token'
  const tenant = tenantId?.trim() || 'common'
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
}

function authEndpoint(provider: DmsProvider, tenantId?: string): string {
  if (provider === 'google-drive') return 'https://accounts.google.com/o/oauth2/v2/auth'
  const tenant = tenantId?.trim() || 'common'
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`
}

function defaultScopes(provider: DmsProvider): string[] {
  if (provider === 'google-drive') return ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.readonly']
  return ['offline_access', 'Files.Read.All', 'Sites.Read.All', 'User.Read']
}

function upsertConnectionRow(
  db: Database.Database,
  payload: {
    id?: string
    provider: DmsProvider
    displayName: string
    accountEmail?: string | null
    tenantId?: string | null
    siteId?: string | null
    tokenRef: string
    status?: 'connected' | 'error' | 'expired'
  }
): DmsConnectionSummary {
  const now = Date.now()
  const id = payload.id ?? randomUUID()
  db.prepare(
    `INSERT INTO dms_connections (id, provider, display_name, account_email, tenant_id, site_id, token_ref, status, created_at, updated_at, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       display_name = excluded.display_name,
       account_email = excluded.account_email,
       tenant_id = excluded.tenant_id,
       site_id = excluded.site_id,
       token_ref = excluded.token_ref,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(
    id,
    payload.provider,
    payload.displayName.trim(),
    payload.accountEmail?.trim() || null,
    payload.tenantId?.trim() || null,
    payload.siteId?.trim() || null,
    payload.tokenRef,
    payload.status ?? 'connected',
    now,
    now
  )
  const row = getDmsConnectionById(db, id)
  if (!row) throw new Error('Could not read persisted DMS connection.')
  return normalizeConnection(row)
}

function decodeJwtEmail(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const candidates = [payload.email, payload.upn, payload.preferred_username, payload.unique_name]
    const hit = candidates.find((v) => typeof v === 'string' && v.trim())
    return typeof hit === 'string' ? hit.trim() : null
  } catch {
    return null
  }
}

export function startDmsOauth(input: {
  provider: DmsProvider
  clientId: string
  clientSecret?: string
  redirectUri: string
  scopes?: string[]
  tenantId?: string
  siteId?: string
}): DmsConnectStartResponse {
  const clientId = input.clientId.trim()
  const redirectUri = input.redirectUri.trim()
  if (!clientId || !redirectUri) {
    return { ok: false, error: 'clientId and redirectUri are required.' }
  }
  const scopes = input.scopes?.map((s) => s.trim()).filter(Boolean)
  const cfg: DmsAuthConfig = {
    clientId,
    clientSecret: input.clientSecret?.trim() || undefined,
    redirectUri,
    scopes: scopes && scopes.length > 0 ? scopes : defaultScopes(input.provider),
    tenantId: input.tenantId?.trim() || undefined,
    siteId: input.siteId?.trim() || undefined
  }
  const state = randomUUID()
  pendingAuthState.set(state, { provider: input.provider, config: cfg, createdAt: Date.now() })
  const u = new URL(authEndpoint(input.provider, cfg.tenantId))
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('scope', cfg.scopes.join(' '))
  u.searchParams.set('state', state)
  if (input.provider !== 'google-drive') {
    u.searchParams.set('response_mode', 'query')
  }
  return { ok: true, authUrl: u.toString(), state }
}

export async function completeDmsOauth(
  db: Database.Database,
  store: Store<Record<string, unknown>>,
  input: { code: string; state: string; displayName?: string }
): Promise<DmsConnectResult> {
  const state = input.state.trim()
  const code = input.code.trim()
  if (!state || !code) return { ok: false, error: 'state and code are required.' }
  const pending = pendingAuthState.get(state)
  if (!pending) return { ok: false, error: 'OAuth state expired or unknown.' }
  pendingAuthState.delete(state)
  const cfg = pending.config
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri
  })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  const tokenUrl = tokenEndpoint(pending.provider, cfg.tenantId)
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500)
    return { ok: false, error: `Token exchange failed (${res.status}): ${detail}` }
  }
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    token_type?: string
  }
  const accessToken = json.access_token?.trim()
  if (!accessToken) return { ok: false, error: 'OAuth did not return access_token.' }
  const tokenRef = randomUUID()
  const secret: DmsConnectionSecret = {
    accessToken,
    refreshToken: json.refresh_token?.trim() || undefined,
    expiresAt:
      typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
        ? Date.now() + json.expires_in * 1000
        : undefined,
    scope: json.scope,
    tokenType: json.token_type,
    tokenUrl,
    authConfig: cfg
  }
  upsertDmsSecret(store, tokenRef, secret)
  const connection = upsertConnectionRow(db, {
    provider: pending.provider,
    displayName: input.displayName?.trim() || `${pending.provider} connection`,
    accountEmail: decodeJwtEmail(accessToken),
    tenantId: cfg.tenantId ?? null,
    siteId: cfg.siteId ?? null,
    tokenRef
  })
  return { ok: true, connection }
}

export function connectDmsWithToken(
  db: Database.Database,
  store: Store<Record<string, unknown>>,
  input: {
    provider: DmsProvider
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    displayName?: string
    accountEmail?: string
    tenantId?: string
    siteId?: string
  }
): DmsConnectResult {
  const access = input.accessToken.trim()
  if (!access) return { ok: false, error: 'accessToken is required.' }
  const tokenRef = randomUUID()
  upsertDmsSecret(store, tokenRef, {
    accessToken: access,
    refreshToken: input.refreshToken?.trim() || undefined,
    expiresAt: input.expiresAt,
    tokenUrl: tokenEndpoint(input.provider, input.tenantId),
    authConfig: {
      clientId: '',
      redirectUri: '',
      scopes: defaultScopes(input.provider),
      tenantId: input.tenantId?.trim() || undefined,
      siteId: input.siteId?.trim() || undefined
    }
  })
  const connection = upsertConnectionRow(db, {
    provider: input.provider,
    displayName: input.displayName?.trim() || `${input.provider} connection`,
    accountEmail: input.accountEmail?.trim() || decodeJwtEmail(access),
    tenantId: input.tenantId?.trim() || null,
    siteId: input.siteId?.trim() || null,
    tokenRef
  })
  return { ok: true, connection }
}

export function listDmsImportRoots(
  db: Database.Database,
  connectionId?: string
): DmsImportRootSummary[] {
  const rows = connectionId
    ? (db
        .prepare(
          `SELECT id, connection_id as connectionId, external_folder_id as externalFolderId, display_name as displayName,
                  external_path as externalPath, created_at as createdAt, updated_at as updatedAt, last_synced_at as lastSyncedAt
           FROM dms_import_roots
           WHERE connection_id = ?
           ORDER BY updated_at DESC`
        )
        .all(connectionId) as DmsImportRootRow[])
    : (db
        .prepare(
          `SELECT id, connection_id as connectionId, external_folder_id as externalFolderId, display_name as displayName,
                  external_path as externalPath, created_at as createdAt, updated_at as updatedAt, last_synced_at as lastSyncedAt
           FROM dms_import_roots
           ORDER BY updated_at DESC`
        )
        .all() as DmsImportRootRow[])
  return rows
}

export function upsertDmsImportRoot(
  db: Database.Database,
  input: {
    connectionId: string
    externalFolderId: string
    displayName: string
    externalPath: string
  }
): DmsImportRootSummary {
  const now = Date.now()
  const existing = db
    .prepare(
      `SELECT id FROM dms_import_roots WHERE connection_id = ? AND external_folder_id = ?`
    )
    .get(input.connectionId, input.externalFolderId) as { id: string } | undefined
  const id = existing?.id ?? randomUUID()
  db.prepare(
    `INSERT INTO dms_import_roots (id, connection_id, external_folder_id, display_name, external_path, created_at, updated_at, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      external_path = excluded.external_path,
      updated_at = excluded.updated_at`
  ).run(id, input.connectionId, input.externalFolderId, input.displayName, input.externalPath, now, now)
  const row = db
    .prepare(
      `SELECT id, connection_id as connectionId, external_folder_id as externalFolderId, display_name as displayName,
              external_path as externalPath, created_at as createdAt, updated_at as updatedAt, last_synced_at as lastSyncedAt
       FROM dms_import_roots WHERE id = ?`
    )
    .get(id) as DmsImportRootRow | undefined
  if (!row) throw new Error('Unable to read import root row.')
  return row
}

export function listDmsFolders(
  db: Database.Database,
  store: Store<Record<string, unknown>>,
  connectionId: string
): Promise<DmsFolderSummary[]> {
  return withDmsProviderClient(db, store, connectionId, async (client) => client.listFolders())
}

export async function withDmsProviderClient<T>(
  db: Database.Database,
  store: Store<Record<string, unknown>>,
  connectionId: string,
  fn: (client: DmsProviderClient, connection: DmsConnectionRow) => Promise<T>
): Promise<T> {
  const connection = getDmsConnectionById(db, connectionId)
  if (!connection) throw new Error('DMS connection not found.')
  const secret = readDmsSecret(store, connection.tokenRef)
  if (!secret) throw new Error('DMS token was not found for this connection.')
  const providerFactory = providerFactories[connection.provider]
  const client = providerFactory({
    connection,
    secret,
    onSecretRefresh: (next) => upsertDmsSecret(store, connection.tokenRef, next)
  })
  return fn(client, connection)
}

export function listDmsImportItemsByRoot(db: Database.Database, rootId: string): DmsImportItemRow[] {
  return db
    .prepare(
      `SELECT id, root_id as rootId, external_file_id as externalFileId, external_path as externalPath, etag,
              mime_type as mimeType, kb_source_id as kbSourceId, last_seen_at as lastSeenAt, state, updated_at as updatedAt
       FROM dms_import_items
       WHERE root_id = ?`
    )
    .all(rootId) as DmsImportItemRow[]
}

export function upsertDmsImportItem(
  db: Database.Database,
  input: {
    rootId: string
    externalFileId: string
    externalPath: string
    etag?: string
    mimeType?: string
    kbSourceId?: string | null
    state: 'active' | 'removed' | 'failed'
  }
): DmsImportItemRow {
  const now = Date.now()
  const existing = db
    .prepare('SELECT id FROM dms_import_items WHERE root_id = ? AND external_file_id = ?')
    .get(input.rootId, input.externalFileId) as { id: string } | undefined
  const id = existing?.id ?? randomUUID()
  db.prepare(
    `INSERT INTO dms_import_items (
      id, root_id, external_file_id, external_path, etag, mime_type, kb_source_id, last_seen_at, state, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      external_path = excluded.external_path,
      etag = excluded.etag,
      mime_type = excluded.mime_type,
      kb_source_id = excluded.kb_source_id,
      last_seen_at = excluded.last_seen_at,
      state = excluded.state,
      updated_at = excluded.updated_at`
  ).run(
    id,
    input.rootId,
    input.externalFileId,
    input.externalPath,
    input.etag ?? null,
    input.mimeType ?? null,
    input.kbSourceId ?? null,
    now,
    input.state,
    now
  )
  return db
    .prepare(
      `SELECT id, root_id as rootId, external_file_id as externalFileId, external_path as externalPath, etag,
              mime_type as mimeType, kb_source_id as kbSourceId, last_seen_at as lastSeenAt, state, updated_at as updatedAt
       FROM dms_import_items WHERE id = ?`
    )
    .get(id) as DmsImportItemRow
}

export function touchDmsRootSync(db: Database.Database, rootId: string, syncedAt: number): void {
  db.prepare('UPDATE dms_import_roots SET last_synced_at = ?, updated_at = ? WHERE id = ?').run(syncedAt, syncedAt, rootId)
  db.prepare(
    `UPDATE dms_connections
     SET last_synced_at = ?, updated_at = ?
     WHERE id = (SELECT connection_id FROM dms_import_roots WHERE id = ?)`
  ).run(syncedAt, syncedAt, rootId)
}

export function disconnectDmsConnection(
  db: Database.Database,
  store: Store<Record<string, unknown>>,
  connectionId: string
): { ok: boolean } {
  const conn = getDmsConnectionById(db, connectionId)
  if (!conn) return { ok: false }
  removeDmsSecret(store, conn.tokenRef)
  db.prepare('DELETE FROM dms_connections WHERE id = ?').run(connectionId)
  return { ok: true }
}
