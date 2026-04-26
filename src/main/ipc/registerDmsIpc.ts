import { BrowserWindow, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import type Store from 'electron-store'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { DmsProvider } from '@shared/types'
import {
  completeDmsOauth,
  connectDmsWithToken,
  disconnectDmsConnection,
  getDmsConnectionById,
  listDmsConnections,
  listDmsFolders,
  listDmsImportRoots,
  startDmsOauth,
  upsertDmsImportRoot
} from '../services/dms/dmsConnectorService'
import { runDmsRootSync } from '../services/dms/dmsSyncOrchestrator'
import type { DmsImportRootRow } from '../services/dms/dmsTypes'

type DmsIpcContext = {
  db: Database.Database
  store: Store<Record<string, unknown>>
}

function sendDmsSyncProgress(payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.DMS_SYNC_PROGRESS, payload)
  }
}

export function registerDmsIpc(ctx: DmsIpcContext): void {
  const { db, store } = ctx
  const providerSchema = z.enum(['google-drive', 'onedrive', 'sharepoint'] as const)

  ipcMain.handle(IPC.DMS_CONNECTIONS_LIST, () => listDmsConnections(db))

  ipcMain.handle(IPC.DMS_CONNECT_START, (_e, raw: unknown) => {
    const parsed = z
      .object({
        provider: providerSchema,
        clientId: z.string().min(1).max(512),
        clientSecret: z.string().max(512).optional(),
        redirectUri: z.string().min(1).max(2048),
        scopes: z.array(z.string().min(1).max(256)).max(32).optional(),
        tenantId: z.string().max(256).optional(),
        siteId: z.string().max(512).optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid connect payload.' }
    return startDmsOauth(parsed.data)
  })

  ipcMain.handle(IPC.DMS_CONNECT_COMPLETE, async (_e, raw: unknown) => {
    const parsed = z
      .object({
        code: z.string().min(1).max(4096),
        state: z.string().min(1).max(256),
        displayName: z.string().max(180).optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid OAuth completion payload.' }
    return await completeDmsOauth(db, store, parsed.data)
  })

  ipcMain.handle(IPC.DMS_CONNECT_WITH_TOKEN, (_e, raw: unknown) => {
    const parsed = z
      .object({
        provider: providerSchema,
        accessToken: z.string().min(1).max(40_000),
        refreshToken: z.string().max(40_000).optional(),
        expiresAt: z.number().int().optional(),
        displayName: z.string().max(180).optional(),
        accountEmail: z.string().max(320).optional(),
        tenantId: z.string().max(256).optional(),
        siteId: z.string().max(512).optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid token connect payload.' }
    return connectDmsWithToken(db, store, parsed.data)
  })

  ipcMain.handle(IPC.DMS_FOLDERS_LIST, async (_e, raw: unknown) => {
    const parsed = z.string().uuid().safeParse(raw)
    if (!parsed.success) throw new Error('connection id required')
    return await listDmsFolders(db, store, parsed.data)
  })

  ipcMain.handle(IPC.DMS_IMPORT_ROOTS_LIST, (_e, raw: unknown) => {
    const parsed = z.union([z.string().uuid(), z.null(), z.undefined()]).safeParse(raw)
    if (!parsed.success) throw new Error('Invalid connection filter')
    return listDmsImportRoots(db, parsed.data ?? undefined)
  })

  ipcMain.handle(IPC.DMS_IMPORT_START, (_e, raw: unknown) => {
    const parsed = z
      .object({
        connectionId: z.string().uuid(),
        folderId: z.string().min(1).max(1000),
        folderName: z.string().min(1).max(300),
        folderPath: z.string().max(1200).optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid import payload.' }
    const conn = getDmsConnectionById(db, parsed.data.connectionId)
    if (!conn) return { ok: false as const, error: 'Connection not found.' }
    const root = upsertDmsImportRoot(db, {
      connectionId: conn.id,
      externalFolderId: parsed.data.folderId,
      displayName: parsed.data.folderName.trim(),
      externalPath: parsed.data.folderPath?.trim() || parsed.data.folderName.trim()
    })
    return { ok: true as const, root }
  })

  ipcMain.handle(IPC.DMS_SYNC_RUN, async (_e, raw: unknown) => {
    const parsed = z
      .object({
        rootId: z.string().uuid(),
        maxFilesPerRun: z.number().int().min(1).max(20_000).optional(),
        maxBytesPerFile: z.number().int().min(1024).max(100 * 1024 * 1024).optional(),
        timeoutMs: z.number().int().min(5000).max(3 * 60 * 60 * 1000).optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid sync payload.' }
    const root = db
      .prepare(
        `SELECT id, connection_id as connectionId, external_folder_id as externalFolderId, display_name as displayName,
                external_path as externalPath, created_at as createdAt, updated_at as updatedAt, last_synced_at as lastSyncedAt
         FROM dms_import_roots
         WHERE id = ?`
      )
      .get(parsed.data.rootId) as DmsImportRootRow | undefined
    if (!root) return { ok: false as const, error: 'Import root not found.' }
    return await runDmsRootSync(db, store, {
      connectionId: root.connectionId,
      root,
      limits: {
        maxFilesPerRun: parsed.data.maxFilesPerRun,
        maxBytesPerFile: parsed.data.maxBytesPerFile,
        timeoutMs: parsed.data.timeoutMs
      },
      onProgress: (payload) => sendDmsSyncProgress(payload)
    })
  })

  ipcMain.handle(IPC.DMS_DISCONNECT, (_e, raw: unknown) => {
    const parsed = z.string().uuid().safeParse(raw)
    if (!parsed.success) return { ok: false as const }
    return disconnectDmsConnection(db, store, parsed.data)
  })
}

export type { DmsProvider }
