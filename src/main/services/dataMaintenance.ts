import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { logLine } from '../logger'
import { clearDownloadRegistryAndHfCache } from './downloadManager'
import { cancelAllRunningTrainJobs } from './trainOrchestrator'

/**
 * Download registry + HF SQLite cache, metrics history, train job rows, and files under the vectors directory.
 * Does not remove chats, knowledge base, wiki, or model weight files.
 */
export function clearAllAppCaches(db: Database.Database, vectorsDir: string): {
  downloadsRemoved: number
  hfCacheRemoved: number
  metricsRemoved: number
  trainJobsRemoved: number
  vectorsEntriesCleared: number
  downloadsCancelled: number
  trainProcessesKilled: number
} {
  const trainProcessesKilled = cancelAllRunningTrainJobs()
  const { downloadsRemoved, hfCacheRemoved, downloadsCancelled } = clearDownloadRegistryAndHfCache(db)
  const metricsRemoved = db.prepare('DELETE FROM metrics_samples').run().changes
  const trainJobsRemoved = db.prepare('DELETE FROM train_jobs').run().changes

  let vectorsEntriesCleared = 0
  if (existsSync(vectorsDir)) {
    for (const name of readdirSync(vectorsDir)) {
      rmSync(join(vectorsDir, name), { recursive: true, force: true })
      vectorsEntriesCleared++
    }
  } else {
    try {
      mkdirSync(vectorsDir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  logLine('info', 'all_app_caches_cleared', {
    downloadsRemoved,
    hfCacheRemoved,
    metricsRemoved,
    trainJobsRemoved,
    vectorsEntriesCleared,
    downloadsCancelled,
    trainProcessesKilled
  })

  return {
    downloadsRemoved,
    hfCacheRemoved,
    metricsRemoved,
    trainJobsRemoved,
    vectorsEntriesCleared,
    downloadsCancelled,
    trainProcessesKilled
  }
}

/** Deletes every file and folder inside `absPath` (not the root directory itself). */
export function deleteAllChildrenInDirectory(absPath: string): { removed: number; errors: string[] } {
  if (!existsSync(absPath)) {
    try {
      mkdirSync(absPath, { recursive: true })
    } catch {
      /* ignore */
    }
    return { removed: 0, errors: [] }
  }
  const errors: string[] = []
  let removed = 0
  for (const name of readdirSync(absPath)) {
    const p = join(absPath, name)
    try {
      rmSync(p, { recursive: true, force: true })
      removed++
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { removed, errors }
}
