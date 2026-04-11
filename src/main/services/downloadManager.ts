import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { request as httpsRequest } from 'https'
import { request as httpRequest } from 'http'
import type Database from 'better-sqlite3'
import { logLine } from '../logger'
import type { DownloadJob } from '@shared/types'

/** Build the same resolve URL as HF download IPC (revision + path segments encoded). */
export function hfResolveDownloadUrl(repoId: string, revision: string, hfFilename: string): string {
  const norm = hfFilename.replace(/\\/g, '/')
  const tail = norm.split('/').map((s) => encodeURIComponent(s)).join('/')
  return `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(revision)}/${tail}`
}

type ActiveJob = {
  job: DownloadJob
  abort: AbortController
}

const active = new Map<string, ActiveJob>()

const MAX_REDIRECTS = 24

function httpGet(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  redirectDepth = 0
): Promise<{ statusCode: number; headers: NodeJS.Dict<string | string[]>; body: Readable }> {
  return new Promise((resolve, reject) => {
    if (redirectDepth > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'))
      return
    }
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? httpsRequest : httpRequest
    const req = lib(
      u,
      {
        method: 'GET',
        headers
      },
      (res) => {
        const code = res.statusCode ?? 0
        if (code >= 300 && code < 400 && res.headers.location) {
          const nextAbs = new URL(res.headers.location, u.href).href
          const nextHeaders = { ...headers }
          // Presigned CDN URLs (S3, CloudFront, hf.co bridges, etc.) must not receive HF Bearer —
          // it breaks signatures and can corrupt the stream.
          delete nextHeaders.Authorization
          try {
            const nextHost = new URL(nextAbs).hostname
            if (nextHost !== u.hostname) {
              delete nextHeaders.Range
            }
          } catch {
            delete nextHeaders.Range
          }
          httpGet(nextAbs, nextHeaders, signal, redirectDepth + 1).then(resolve).catch(reject)
          return
        }
        resolve({ statusCode: code, headers: res.headers, body: res as unknown as Readable })
      }
    )
    signal.addEventListener('abort', () => {
      req.destroy()
      reject(new Error('aborted'))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Resolve HF LFS file download URL via redirects. Supports Range resume; handles 416 when the file is already complete. */
export async function downloadHfFile(
  url: string,
  destPath: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
  hfToken?: string,
  options?: { expectedFileBytes?: number; allow416Restart?: boolean }
): Promise<void> {
  const allow416Restart = options?.allow416Restart !== false
  const dir = join(destPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let startByte = 0
  if (existsSync(destPath)) {
    try {
      startByte = statSync(destPath).size
    } catch {
      startByte = 0
    }
  }

  const expected = options?.expectedFileBytes
  if (expected != null && expected > 0 && startByte >= expected) {
    onProgress(startByte, expected)
    return
  }

  const headers: Record<string, string> = {
    'Accept-Encoding': 'identity',
    'User-Agent': 'local-llm-desktop/0.1 (HF resolve; compatible download)'
  }
  if (startByte > 0) headers.Range = `bytes=${startByte}-`
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`

  const { statusCode, headers: resHeaders, body } = await httpGet(url, headers, signal)

  if (statusCode === 416) {
    if (expected != null && expected > 0 && existsSync(destPath)) {
      try {
        const sz = statSync(destPath).size
        if (sz >= expected) {
          onProgress(sz, expected)
          return
        }
      } catch {
        /* ignore */
      }
    }
    if (allow416Restart && startByte > 0) {
      try {
        if (existsSync(destPath)) unlinkSync(destPath)
      } catch {
        /* ignore */
      }
      return downloadHfFile(url, destPath, onProgress, signal, hfToken, {
        expectedFileBytes: expected,
        allow416Restart: false
      })
    }
    throw new Error(`HTTP ${statusCode}`)
  }

  if (statusCode !== 200 && statusCode !== 206) {
    throw new Error(`HTTP ${statusCode}`)
  }

  const total =
    resHeaders['content-range'] && typeof resHeaders['content-range'] === 'string'
      ? parseInt(resHeaders['content-range'].split('/')[1] ?? '0', 10)
      : parseInt(String(resHeaders['content-length'] ?? '0'), 10) + startByte

  const ws = createWriteStream(destPath, { flags: startByte > 0 ? 'a' : 'w' })
  let received = startByte
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress(received, total || received)
  })
  await pipeline(body, ws)
}

export function registerDownloadInDb(
  db: Database.Database,
  row: {
    id: string
    repoId: string
    revision: string
    localPath: string
    status: string
    bytesTotal: number
    chatDisplayName?: string
    hfFilename?: string
  }
): void {
  const t = Date.now()
  const hfFn = row.hfFilename?.trim() ? row.hfFilename.trim().replace(/\\/g, '/') : null
  db.prepare(
    `INSERT INTO downloads (id, repo_id, revision, local_path, status, bytes_total, verified, created_at, updated_at, chat_display_name, hf_filename)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       bytes_total = CASE WHEN excluded.bytes_total > 0 THEN excluded.bytes_total ELSE downloads.bytes_total END,
       local_path = excluded.local_path,
       chat_display_name = COALESCE(excluded.chat_display_name, downloads.chat_display_name),
       hf_filename = COALESCE(excluded.hf_filename, downloads.hf_filename),
       updated_at = excluded.updated_at`
  ).run(
    row.id,
    row.repoId,
    row.revision,
    row.localPath,
    row.status,
    row.bytesTotal,
    t,
    t,
    row.chatDisplayName?.trim() ? row.chatDisplayName.trim() : null,
    hfFn
  )
}

export function listDownloads(db: Database.Database): unknown[] {
  return db.prepare('SELECT * FROM downloads ORDER BY updated_at DESC').all()
}

/** DB rows plus live `bytes_received` / `progress_percent` when a download is still active in memory. */
export function listDownloadsWithProgress(db: Database.Database): unknown[] {
  const rows = db.prepare('SELECT * FROM downloads ORDER BY updated_at DESC').all() as Record<string, unknown>[]
  return rows.map((row) => {
    const id = row.id as string
    const status = String(row.status)
    const active = getActiveDownload(id)
    if (active && (status === 'downloading' || status === 'pending')) {
      const total =
        active.bytesTotal > 0 ? active.bytesTotal : typeof row.bytes_total === 'number' ? row.bytes_total : 0
      return {
        ...row,
        bytes_received: active.bytesReceived,
        bytes_total: total || row.bytes_total,
        progress_percent: active.progress
      }
    }
    if (status === 'downloading') {
      const lp = row.local_path
      let bytesReceived = 0
      if (typeof lp === 'string' && existsSync(lp)) {
        try {
          bytesReceived = statSync(lp).size
        } catch {
          bytesReceived = 0
        }
      }
      const btRaw = row.bytes_total
      const bytesTotal = typeof btRaw === 'number' && btRaw > 0 ? btRaw : 0
      const progressPercent =
        bytesTotal > 0 ? Math.min(99, Math.round((100 * bytesReceived) / bytesTotal)) : 0
      return {
        ...row,
        bytes_received: bytesReceived,
        bytes_total: bytesTotal || row.bytes_total,
        progress_percent: progressPercent
      }
    }
    return row
  })
}

export function startDownload(
  db: Database.Database,
  job: DownloadJob,
  resolveUrl: () => Promise<string>,
  onUpdate: (j: DownloadJob) => void,
  hfToken?: string
): void {
  const abort = new AbortController()
  active.set(job.id, { job, abort })

  registerDownloadInDb(db, {
    id: job.id,
    repoId: job.repoId,
    revision: job.revision,
    localPath: job.destPath,
    status: 'downloading',
    bytesTotal: job.bytesTotal,
    chatDisplayName: job.chatDisplayName,
    hfFilename: job.hfFilename
  })

  ;(async () => {
    let lastPersist = 0
    let lastKnownTotal = job.bytesTotal
    const persistProgress = (received: number, total: number): void => {
      const now = Date.now()
      const totalPositive = total > 0 ? total : 0
      const totalBecameKnown = totalPositive > 0 && lastKnownTotal === 0
      lastKnownTotal = totalPositive > 0 ? totalPositive : lastKnownTotal
      if (totalBecameKnown || now - lastPersist >= 2500) {
        lastPersist = now
        db.prepare(`UPDATE downloads SET bytes_total = ?, updated_at = ? WHERE id = ?`).run(
          totalPositive > 0 ? totalPositive : Math.max(0, lastKnownTotal),
          now,
          job.id
        )
      }
    }

    try {
      const url = await resolveUrl()
      const expectedBytes = job.bytesTotal > 0 ? job.bytesTotal : undefined
      await downloadHfFile(
        url,
        job.destPath,
        (received, total) => {
          job.bytesReceived = received
          job.bytesTotal = total
          job.progress = total ? Math.min(99, Math.round((100 * received) / total)) : 0
          persistProgress(received, total)
          onUpdate({ ...job })
        },
        abort.signal,
        hfToken,
        { expectedFileBytes: expectedBytes, allow416Restart: true }
      )
      job.status = 'complete'
      job.progress = 100
      db.prepare(
        `UPDATE downloads SET status = ?, verified = 1, updated_at = ? WHERE id = ?`
      ).run('complete', Date.now(), job.id)
      logLine('info', 'download_complete', { id: job.id, path: job.destPath })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'aborted') {
        job.status = 'cancelled'
        try {
          if (existsSync(job.destPath)) unlinkSync(job.destPath)
        } catch (unlinkErr) {
          logLine('warn', 'download_cancel_partial_unlink', {
            id: job.id,
            path: job.destPath,
            error: unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)
          })
        }
        db.prepare(`DELETE FROM downloads WHERE id = ?`).run(job.id)
        logLine('info', 'download_cancelled', { id: job.id, path: job.destPath })
      } else {
        job.status = 'error'
        job.error = msg
        db.prepare(`UPDATE downloads SET status = ?, updated_at = ? WHERE id = ?`).run(
          'error',
          Date.now(),
          job.id
        )
      }
      if (msg !== 'aborted') {
        logLine('error', 'download_failed', { id: job.id, error: msg })
      }
    } finally {
      active.delete(job.id)
      onUpdate({ ...job })
    }
  })()
}

export function cancelDownload(jobId: string): boolean {
  const a = active.get(jobId)
  if (!a) return false
  a.abort.abort()
  return true
}

export function cancelAllActiveDownloads(): number {
  const ids = [...active.keys()]
  for (const id of ids) cancelDownload(id)
  return ids.length
}

export function getActiveDownload(jobId: string): DownloadJob | undefined {
  return active.get(jobId)?.job
}

/**
 * Restart downloads that were in progress when the app last exited (DB status `downloading`).
 * Requires `hf_filename` on the row (new downloads); older rows are skipped.
 */
export function resumeInterruptedDownloads(
  db: Database.Database,
  getHfToken: () => string | undefined,
  onUpdate?: (j: DownloadJob) => void
): void {
  const rows = db.prepare(`SELECT * FROM downloads WHERE status = 'downloading'`).all() as Record<string, unknown>[]
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id || active.has(id)) continue
    const hfRaw = row.hf_filename
    const hfFilename = typeof hfRaw === 'string' ? hfRaw.trim() : ''
    if (!hfFilename) {
      logLine('warn', 'download_resume_skipped', {
        id,
        reason: 'missing_hf_filename',
        hint: 'Cancel the download in Models and start again to enable resume next time.'
      })
      continue
    }
    const repoId = typeof row.repo_id === 'string' ? row.repo_id : ''
    const revision = typeof row.revision === 'string' ? row.revision : 'main'
    const destPath = typeof row.local_path === 'string' ? row.local_path : ''
    if (!repoId || !destPath) continue
    const bt = typeof row.bytes_total === 'number' && row.bytes_total > 0 ? row.bytes_total : 0
    let bytesReceived = 0
    if (existsSync(destPath)) {
      try {
        bytesReceived = statSync(destPath).size
      } catch {
        bytesReceived = 0
      }
    }
    const chatName = row.chat_display_name
    const job: DownloadJob = {
      id,
      repoId,
      revision,
      destPath,
      status: 'downloading',
      progress: bt > 0 ? Math.min(99, Math.round((100 * bytesReceived) / bt)) : 0,
      bytesReceived,
      bytesTotal: bt,
      chatDisplayName: typeof chatName === 'string' && chatName.trim() ? chatName.trim() : undefined,
      hfFilename
    }
    const url = hfResolveDownloadUrl(repoId, revision, hfFilename)
    logLine('info', 'download_resume', { id, path: destPath, bytesReceived, bytesTotal: bt })
    startDownload(db, job, async () => url, onUpdate ?? (() => {}), getHfToken())
  }
}

/** Cancel in-flight downloads, clear the download registry, and drop Hugging Face model JSON cache. Does not delete files on disk. */
export function clearDownloadRegistryAndHfCache(db: Database.Database): {
  downloadsRemoved: number
  hfCacheRemoved: number
  downloadsCancelled: number
} {
  let downloadsCancelled = 0
  for (const id of [...active.keys()]) {
    if (cancelDownload(id)) downloadsCancelled++
  }
  const downloadsRemoved = db.prepare('DELETE FROM downloads').run().changes
  const hfCacheRemoved = db.prepare('DELETE FROM hf_model_cache').run().changes
  logLine('info', 'download_cache_cleared', { downloadsRemoved, hfCacheRemoved, downloadsCancelled })
  return { downloadsRemoved, hfCacheRemoved, downloadsCancelled }
}
