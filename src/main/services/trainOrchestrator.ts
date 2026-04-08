import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import type { TrainJob } from '@shared/types'
import { logLine } from '../logger'

const running = new Map<string, ReturnType<typeof spawn>>()

export function listTrainJobs(db: Database.Database): TrainJob[] {
  return db
    .prepare(
      `SELECT id, status, base_model_path as baseModelPath, output_dir as outputDir, message,
              started_at as startedAt, finished_at as finishedAt
       FROM train_jobs ORDER BY created_at DESC`
    )
    .all() as TrainJob[]
}

export function startTrainJob(
  db: Database.Database,
  userData: string,
  scriptPath: string,
  opts: { baseModelPath: string; datasetPath: string; pythonPath?: string }
): TrainJob {
  const id = randomUUID()
  const t = Date.now()
  const outputDir = join(userData, 'train_outputs', id)
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  db.prepare(
    `INSERT INTO train_jobs (id, status, base_model_path, output_dir, message, started_at, finished_at, created_at)
     VALUES (?, 'queued', ?, ?, NULL, NULL, NULL, ?)`
  ).run(id, opts.baseModelPath, outputDir, t)

  const script = scriptPath
  const py = opts.pythonPath ?? 'python'

  const job: TrainJob = {
    id,
    status: 'queued',
    baseModelPath: opts.baseModelPath,
    outputDir,
    startedAt: t
  }

  if (!existsSync(script)) {
    db.prepare(`UPDATE train_jobs SET status = ?, message = ? WHERE id = ?`).run(
      'error',
      'train_lora.py not found; add training/train_lora.py',
      id
    )
    job.status = 'error'
    job.message = 'train_lora.py not found'
    return job
  }

  db.prepare(`UPDATE train_jobs SET status = ?, started_at = ? WHERE id = ?`).run('running', Date.now(), id)
  job.status = 'running'

  const proc = spawn(
    py,
    [script, '--base_model', opts.baseModelPath, '--dataset', opts.datasetPath, '--output', outputDir],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  running.set(id, proc)
  let out = ''
  proc.stdout?.on('data', (d) => {
    out += d.toString().slice(-2000)
  })
  proc.stderr?.on('data', (d) => {
    out += d.toString().slice(-2000)
  })
  proc.on('exit', (code) => {
    running.delete(id)
    const done = Date.now()
    if (code === 0) {
      db.prepare(`UPDATE train_jobs SET status = ?, message = ?, finished_at = ? WHERE id = ?`).run(
        'complete',
        out.slice(-500) || 'ok',
        done,
        id
      )
    } else {
      db.prepare(`UPDATE train_jobs SET status = ?, message = ?, finished_at = ? WHERE id = ?`).run(
        'error',
        out.slice(-500) || `exit ${code}`,
        done,
        id
      )
    }
    logLine('info', 'train_job_finished', { id, code })
  })

  return job
}

/** Best-effort stop for in-flight training processes (does not update DB rows). */
export function cancelAllRunningTrainJobs(): number {
  let n = 0
  for (const [jobId, proc] of [...running.entries()]) {
    try {
      proc.kill()
      n++
    } catch {
      /* ignore */
    }
    running.delete(jobId)
  }
  return n
}

export function getTrainJob(db: Database.Database, id: string): TrainJob | undefined {
  return db
    .prepare(
      `SELECT id, status, base_model_path as baseModelPath, output_dir as outputDir, message,
              started_at as startedAt, finished_at as finishedAt FROM train_jobs WHERE id = ?`
    )
    .get(id) as TrainJob | undefined
}
