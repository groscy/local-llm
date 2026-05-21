import type Database from 'better-sqlite3'
import type Store from 'electron-store'
import { randomUUID } from 'crypto'
import { basename, extname } from 'path'
import type { DmsSyncProgress, DmsSyncRunResult } from '@shared/types'
import { analyzeKnowledgeGraph, knowledgeGraphAnalysisToMarkdown } from '@shared/knowledgeGraphAnalysis'
import { parseDocumentFromBytes } from '../documentParser'
import * as kbService from '../kbService'
import {
  DMS_MAX_FILE_BYTES_DEFAULT,
  DMS_MAX_FILES_PER_RUN_DEFAULT,
  DMS_SYNC_TIMEOUT_MS_DEFAULT,
  type DmsConnectionRow,
  type DmsImportItemRow,
  type DmsImportRootRow
} from './dmsTypes'
import {
  listDmsImportItemsByRoot,
  touchDmsRootSync,
  upsertDmsImportItem,
  withDmsProviderClient
} from './dmsConnectorService'

type DiscoveredFile = {
  id: string
  path: string
  name: string
  mimeType?: string
  etag?: string
  sizeBytes?: number
}

type SyncStats = {
  importedCount: number
  updatedCount: number
  skippedCount: number
  removedCount: number
  reportSourceId?: string
  graphReportSourceId?: string
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function isSupportedFile(name: string, mimeType?: string): boolean {
  const ext = extname(name).toLowerCase()
  if (ext === '.txt' || ext === '.md' || ext === '.html' || ext === '.htm' || ext === '.pdf') return true
  const mime = (mimeType ?? '').toLowerCase()
  return mime.startsWith('text/') || mime === 'application/pdf' || mime === 'application/json'
}

async function fileBodyFromBytes(
  file: DiscoveredFile,
  bytes: Uint8Array
): Promise<{ body: string; source: 'pdf' | 'text'; diagnostics?: Record<string, unknown> }> {
  const parsed = await parseDocumentFromBytes({
    fileName: file.name,
    bytes,
    mimeType: file.mimeType
  })
  const fallback = decodeText(bytes)
  const body = parsed.normalizedText.trim() ? parsed.normalizedText : fallback
  return {
    body,
    source: parsed.sourceKind,
    diagnostics: {
      parserWarnings: parsed.warnings,
      truncated: parsed.parserDiagnostics?.truncated === true,
      cleanupEdits: Number(parsed.parserDiagnostics?.cleanupEdits ?? 0),
      parserEngine: parsed.parserEngine,
      parserMode: parsed.parserMode,
      parseDurationMs: parsed.parseDurationMs,
      ocrApplied: parsed.ocrApplied,
      ocrCoverage: parsed.ocrCoverage,
      extractionVersion: parsed.extractionVersion
    }
  }
}

export function sourceUri(provider: string, externalFileId: string): string {
  return `dms:${provider}:${externalFileId}`
}

function sourceTitleFromPath(pathLabel: string): string {
  const leaf = basename(pathLabel)
  return leaf.trim() || pathLabel.trim() || 'DMS document'
}

function markdownSyncSummary(
  connection: DmsConnectionRow,
  root: DmsImportRootRow,
  stats: SyncStats,
  failures: string[]
): string {
  const lines = [
    `# DMS sync report`,
    ``,
    `- Provider: ${connection.provider}`,
    `- Source: ${root.displayName}`,
    `- Imported: ${stats.importedCount}`,
    `- Updated: ${stats.updatedCount}`,
    `- Skipped: ${stats.skippedCount}`,
    `- Removed: ${stats.removedCount}`
  ]
  if (failures.length > 0) {
    lines.push('', '## Failures', ...failures.slice(0, 80).map((f) => `- ${f}`))
  }
  return lines.join('\n')
}

function isUnchanged(discovered: DiscoveredFile, existing?: DmsImportItemRow): boolean {
  if (!existing) return false
  if (existing.state !== 'active') return false
  if (!existing.kbSourceId) return false
  if (discovered.etag && existing.etag && discovered.etag === existing.etag) return true
  return false
}

function pruneDeletedSources(
  db: Database.Database,
  rootId: string,
  seenFileIds: Set<string>,
  existingByExternalId: Map<string, DmsImportItemRow>
): number {
  let removed = 0
  for (const [externalId, item] of existingByExternalId.entries()) {
    if (seenFileIds.has(externalId)) continue
    if (item.state === 'removed') continue
    if (item.kbSourceId) {
      try {
        kbService.deleteKbSource(db, item.kbSourceId)
      } catch {
        /* ignore stale source ids */
      }
    }
    upsertDmsImportItem(db, {
      rootId,
      externalFileId: externalId,
      externalPath: item.externalPath,
      etag: item.etag ?? undefined,
      mimeType: item.mimeType ?? undefined,
      kbSourceId: null,
      state: 'removed'
    })
    removed++
  }
  return removed
}

async function runPostIngestAnalysis(
  db: Database.Database,
  connection: DmsConnectionRow,
  root: DmsImportRootRow,
  runId: string,
  stats: SyncStats,
  failures: string[]
): Promise<Pick<SyncStats, 'reportSourceId' | 'graphReportSourceId'>> {
  const reportBody = markdownSyncSummary(connection, root, stats, failures)
  const report = kbService.ingestText(
    db,
    `DMS sync report · ${root.displayName}`,
    `analysis:dms-sync:${runId}:summary`,
    reportBody
  )
  const payload = kbService.getKnowledgeGraph(db)
  const analysis = analyzeKnowledgeGraph(payload)
  const markdown = knowledgeGraphAnalysisToMarkdown(payload, analysis)
  const graph = kbService.ingestText(
    db,
    `DMS graph analysis · ${root.displayName}`,
    `analysis:dms-sync:${runId}:graph`,
    markdown
  )
  return { reportSourceId: report.id, graphReportSourceId: graph.id }
}

function startSyncRun(db: Database.Database, rootId: string): string {
  const runId = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO dms_sync_runs (
      id, root_id, started_at, finished_at, status, imported_count, updated_count, skipped_count, removed_count, error_text, artifacts_json
    ) VALUES (?, ?, ?, NULL, 'running', 0, 0, 0, 0, NULL, NULL)`
  ).run(runId, rootId, now)
  return runId
}

function finishSyncRun(
  db: Database.Database,
  runId: string,
  status: 'success' | 'error',
  stats: SyncStats,
  errorText?: string
): void {
  db.prepare(
    `UPDATE dms_sync_runs
     SET finished_at = ?, status = ?, imported_count = ?, updated_count = ?, skipped_count = ?, removed_count = ?, error_text = ?, artifacts_json = ?
     WHERE id = ?`
  ).run(
    Date.now(),
    status,
    stats.importedCount,
    stats.updatedCount,
    stats.skippedCount,
    stats.removedCount,
    errorText ?? null,
    JSON.stringify({
      reportSourceId: stats.reportSourceId ?? null,
      graphReportSourceId: stats.graphReportSourceId ?? null
    }),
    runId
  )
}

export async function runDmsRootSync(
  db: Database.Database,
  store: Store<Record<string, unknown>>,
  input: {
    connectionId: string
    root: DmsImportRootRow
    onProgress?: (payload: DmsSyncProgress) => void
    limits?: {
      maxFilesPerRun?: number
      maxBytesPerFile?: number
      timeoutMs?: number
    }
  }
): Promise<DmsSyncRunResult> {
  const runId = startSyncRun(db, input.root.id)
  const startedAt = Date.now()
  const maxFiles = input.limits?.maxFilesPerRun ?? DMS_MAX_FILES_PER_RUN_DEFAULT
  const maxBytesPerFile = input.limits?.maxBytesPerFile ?? DMS_MAX_FILE_BYTES_DEFAULT
  const timeoutMs = input.limits?.timeoutMs ?? DMS_SYNC_TIMEOUT_MS_DEFAULT
  const failures: string[] = []
  const stats: SyncStats = { importedCount: 0, updatedCount: 0, skippedCount: 0, removedCount: 0 }
  const emit = (payload: DmsSyncProgress): void => input.onProgress?.(payload)

  emit({
    kind: 'started',
    runId,
    rootId: input.root.id,
    message: `Scanning ${input.root.displayName}…`
  })

  try {
    const existing = listDmsImportItemsByRoot(db, input.root.id)
    const existingByExternal = new Map(existing.map((item) => [item.externalFileId, item]))

    const discovered: DiscoveredFile[] = []
    await withDmsProviderClient(db, store, input.connectionId, async (client, connection) => {
      const queue: Array<{ id: string; path: string }> = [
        { id: input.root.externalFolderId, path: input.root.externalPath || input.root.displayName }
      ]
      while (queue.length > 0) {
        if (Date.now() - startedAt > timeoutMs) throw new Error('DMS sync timed out.')
        const current = queue.shift()!
        const children = await client.listFolderContents(current.id)
        for (const child of children) {
          const childPath = `${current.path}/${child.name}`.replace(/\/{2,}/g, '/')
          if (child.isFolder) {
            queue.push({ id: child.id, path: childPath })
            continue
          }
          if (!isSupportedFile(child.name, child.mimeType)) {
            continue
          }
          discovered.push({
            id: child.id,
            path: childPath,
            name: child.name,
            mimeType: child.mimeType,
            etag: child.etag,
            sizeBytes: child.sizeBytes
          })
          if (discovered.length >= maxFiles) break
        }
        emit({
          kind: 'scan',
          runId,
          rootId: input.root.id,
          message: `Discovered ${discovered.length} files…`,
          totalDiscovered: discovered.length
        })
        if (discovered.length >= maxFiles) break
      }

      const seen = new Set<string>()
      let processed = 0
      for (const file of discovered) {
        if (Date.now() - startedAt > timeoutMs) throw new Error('DMS sync timed out.')
        processed++
        seen.add(file.id)
        const existingItem = existingByExternal.get(file.id)
        if (isUnchanged(file, existingItem)) {
          stats.skippedCount++
          emit({
            kind: 'file',
            runId,
            rootId: input.root.id,
            message: `Skipping unchanged: ${file.path}`,
            processed,
            totalDiscovered: discovered.length
          })
          continue
        }
        if (file.sizeBytes && file.sizeBytes > maxBytesPerFile) {
          stats.skippedCount++
          failures.push(`Skipped (too large): ${file.path}`)
          continue
        }
        try {
          const dl = await client.downloadFile(file.id)
          const parsed = await fileBodyFromBytes(file, dl.bytes)
          if (!parsed.body.trim()) {
            stats.skippedCount++
            failures.push(`Skipped (empty text): ${file.path}`)
            continue
          }
          const uri = sourceUri(connection.provider, file.id)
          const title = sourceTitleFromPath(file.path)
          const source = kbService.ingestTextWithMetadata(db, {
            title,
            uri,
            body: parsed.body,
            source: parsed.source,
            diagnostics: parsed.diagnostics
          })
          upsertDmsImportItem(db, {
            rootId: input.root.id,
            externalFileId: file.id,
            externalPath: file.path,
            etag: file.etag,
            mimeType: file.mimeType,
            kbSourceId: source.id,
            state: 'active'
          })
          if (existingItem?.kbSourceId) {
            stats.updatedCount++
            try {
              kbService.deleteKbSource(db, existingItem.kbSourceId)
            } catch {
              /* ignore stale source ids */
            }
          } else {
            stats.importedCount++
          }
          emit({
            kind: 'file',
            runId,
            rootId: input.root.id,
            message: `Indexed: ${file.path}`,
            processed,
            totalDiscovered: discovered.length
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          failures.push(`Failed ${file.path}: ${msg}`)
          upsertDmsImportItem(db, {
            rootId: input.root.id,
            externalFileId: file.id,
            externalPath: file.path,
            etag: file.etag,
            mimeType: file.mimeType,
            kbSourceId: existingItem?.kbSourceId ?? null,
            state: 'failed'
          })
        }
      }

      stats.removedCount = pruneDeletedSources(db, input.root.id, seen, existingByExternal)
    })

    emit({ kind: 'analysis', runId, rootId: input.root.id, message: 'Generating sync analysis artifacts…' })
    const rootRow = db
      .prepare(
        `SELECT id, connection_id as connectionId, external_folder_id as externalFolderId,
                display_name as displayName, external_path as externalPath, created_at as createdAt,
                updated_at as updatedAt, last_synced_at as lastSyncedAt
         FROM dms_import_roots WHERE id = ?`
      )
      .get(input.root.id) as DmsImportRootRow | undefined
    const conn = db
      .prepare(
        `SELECT id, provider, display_name as displayName, account_email as accountEmail, tenant_id as tenantId,
                site_id as siteId, token_ref as tokenRef, status, created_at as createdAt, updated_at as updatedAt,
                last_synced_at as lastSyncedAt
         FROM dms_connections WHERE id = ?`
      )
      .get(input.connectionId) as DmsConnectionRow | undefined
    if (rootRow && conn) {
      const artifacts = await runPostIngestAnalysis(db, conn, rootRow, runId, stats, failures)
      stats.reportSourceId = artifacts.reportSourceId
      stats.graphReportSourceId = artifacts.graphReportSourceId
    }
    touchDmsRootSync(db, input.root.id, Date.now())
    finishSyncRun(db, runId, 'success', stats)
    emit({
      kind: 'done',
      runId,
      rootId: input.root.id,
      importedCount: stats.importedCount,
      updatedCount: stats.updatedCount,
      skippedCount: stats.skippedCount,
      removedCount: stats.removedCount,
      reportSourceId: stats.reportSourceId,
      graphReportSourceId: stats.graphReportSourceId
    })
    return {
      ok: true,
      runId,
      importedCount: stats.importedCount,
      updatedCount: stats.updatedCount,
      skippedCount: stats.skippedCount,
      removedCount: stats.removedCount,
      reportSourceId: stats.reportSourceId,
      graphReportSourceId: stats.graphReportSourceId
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    finishSyncRun(db, runId, 'error', stats, message)
    emit({ kind: 'error', runId, rootId: input.root.id, message })
    return { ok: false, error: message, runId }
  }
}
