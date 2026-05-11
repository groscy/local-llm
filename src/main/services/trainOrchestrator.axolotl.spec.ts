import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import { startTrainJob } from './trainOrchestrator'

const sqliteAvailable = (() => {
  try {
    const probe = new Database(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('trainOrchestrator Axolotl gate', () => {
  it('rejects unsupported models before launching training process', () => {
    const db = makeDb()
    const root = mkdtempSync(join(tmpdir(), 'axolotl-gate-'))
    try {
      const datasetPath = join(root, 'dataset.jsonl')
      writeFileSync(datasetPath, '{"instruction":"x","output":"y"}\n', 'utf8')
      const modelsDir = join(root, 'models')
      const job = startTrainJob(db, root, {
        baseModelPath: 'C:\\models\\custom-unsupported-arch.gguf',
        datasetPath,
        displayName: 'unsupported-model-check',
        modelsDir
      })
      expect(job.status).toBe('error')
      expect(job.message ?? '').toContain('Model is not supported by bundled Axolotl')
    } finally {
      rmSync(root, { recursive: true, force: true })
      db.close()
    }
  })

  it('records an error when dataset path is missing', () => {
    const db = makeDb()
    const root = mkdtempSync(join(tmpdir(), 'axolotl-dataset-'))
    try {
      const modelsDir = join(root, 'models')
      const job = startTrainJob(db, root, {
        baseModelPath: 'Qwen/Qwen2.5-0.5B',
        datasetPath: join(root, 'missing.jsonl'),
        displayName: 'missing-dataset-check',
        modelsDir
      })
      expect(job.status).toBe('error')
      expect(job.message ?? '').toContain('Dataset file not found')
    } finally {
      rmSync(root, { recursive: true, force: true })
      db.close()
    }
  })
})
