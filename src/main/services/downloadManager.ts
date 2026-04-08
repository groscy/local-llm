import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { request as httpsRequest } from 'https'
import { request as httpRequest } from 'http'
import type Database from 'better-sqlite3'
import { logLine } from '../logger'
import type { DownloadJob } from '@shared/types'

type ActiveJob = {
  job: DownloadJob
  abort: AbortController
}

const active = new Map<string, ActiveJob>()

function httpGet(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  redirectAuth?: { token?: string }
): Promise<{ statusCode: number; headers: NodeJS.Dict<string | string[]>; body: Readable }> {
  return new Promise((resolve, reject) => {
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
          const nextHeaders = { ...headers }
          if (redirectAuth?.token && res.headers.location.includes('huggingface.co')) {
            nextHeaders.Authorization = `Bearer ${redirectAuth.token}`
          }
          httpGet(res.headers.location, nextHeaders, signal, redirectAuth).then(resolve).catch(reject)
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

/** Resolve HF LFS file download URL via redirects. */
export async function downloadHfFile(
  url: string,
  destPath: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
  hfToken?: string
): Promise<void> {
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

  const headers: Record<string, string> = {}
  if (startByte > 0) headers.Range = `bytes=${startByte}-`
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`

  const { statusCode, headers: resHeaders, body } = await httpGet(url, headers, signal, { token: hfToken })
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
  }
): void {
  const t = Date.now()
  db.prepare(
    `INSERT INTO downloads (id, repo_id, revision, local_path, status, bytes_total, verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       bytes_total = excluded.bytes_total,
       local_path = excluded.local_path,
       updated_at = excluded.updated_at`
  ).run(row.id, row.repoId, row.revision, row.localPath, row.status, row.bytesTotal, t, t)
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
    bytesTotal: job.bytesTotal
  })

  ;(async () => {
    try {
      const url = await resolveUrl()
      await downloadHfFile(
        url,
        job.destPath,
        (received, total) => {
          job.bytesReceived = received
          job.bytesTotal = total
          job.progress = total ? Math.min(99, Math.round((100 * received) / total)) : 0
          onUpdate({ ...job })
        },
        abort.signal,
        hfToken
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

export function getActiveDownload(jobId: string): DownloadJob | undefined {
  return active.get(jobId)?.job
}
