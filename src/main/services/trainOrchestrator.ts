import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { basename, join, resolve } from 'path'
import type Database from 'better-sqlite3'
import type { TrainJob } from '@shared/types'
import { logLine } from '../logger'
import { exportKbSourcesToTrainingJsonl } from './trainKbExport'

const running = new Map<string, ReturnType<typeof spawn>>()

function findGgufFilesRecursive(dir: string): string[] {
  const out: string[] = []
  function walk(d: string): void {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      const p = join(d, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (/\.gguf$/i.test(name)) out.push(p)
    }
  }
  walk(dir)
  return out
}

function pickPrimaryGguf(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined
  const merged = paths.find((p) => basename(p).toLowerCase() === 'merged.gguf')
  if (merged) return merged
  let best = paths[0]
  let bestSize = -1
  for (const p of paths) {
    try {
      const sz = statSync(p).size
      if (sz > bestSize) {
        bestSize = sz
        best = p
      }
    } catch {
      /* skip */
    }
  }
  return best
}

function safeFinetuneFileStem(displayName: string, jobId: string): string {
  const raw = displayName.trim() || 'finetune'
  const slug = raw
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '')
  const shortId = jobId.replace(/-/g, '').slice(0, 8)
  return (slug || 'finetune') + '-' + shortId
}

function copyArtifactToModelsDir(sourceGguf: string, modelsDir: string, displayName: string, jobId: string): string {
  const finetunes = join(modelsDir, 'finetunes')
  mkdirSync(finetunes, { recursive: true })
  const stem = safeFinetuneFileStem(displayName, jobId)
  const dest = join(finetunes, `${stem}.gguf`)
  copyFileSync(sourceGguf, dest)
  return dest
}

export function listTrainJobs(db: Database.Database): TrainJob[] {
  return db
    .prepare(
      `SELECT id, status, base_model_path as baseModelPath, output_dir as outputDir, message,
              started_at as startedAt, finished_at as finishedAt,
              kb_source_ids_json as kbSourceIdsJson, display_name as displayName,
              dataset_path as datasetPath, artifact_path as artifactPath
       FROM train_jobs ORDER BY created_at DESC`
    )
    .all()
    .map((row) => mapRow(row as Record<string, unknown>)) as TrainJob[]
}

function mapRow(row: Record<string, unknown>): TrainJob {
  let kbSourceIds: string[] | undefined
  const j = row.kbSourceIdsJson ?? row.kb_source_ids_json
  if (typeof j === 'string' && j.trim()) {
    try {
      const p = JSON.parse(j) as unknown
      if (Array.isArray(p)) kbSourceIds = p.filter((x): x is string => typeof x === 'string')
    } catch {
      /* ignore */
    }
  }
  return {
    id: String(row.id),
    status: row.status as TrainJob['status'],
    baseModelPath: String(row.baseModelPath),
    outputDir: String(row.outputDir),
    message: row.message != null ? String(row.message) : undefined,
    startedAt: typeof row.startedAt === 'number' ? row.startedAt : undefined,
    finishedAt: typeof row.finishedAt === 'number' ? row.finishedAt : undefined,
    kbSourceIds,
    displayName: row.displayName != null ? String(row.displayName) : undefined,
    datasetPath: row.datasetPath != null ? String(row.datasetPath) : undefined,
    artifactPath: row.artifactPath != null ? String(row.artifactPath) : undefined
  }
}

export interface StartTrainJobOpts {
  baseModelPath: string
  /** Explicit JSONL on disk (when not using KB export) */
  datasetPath?: string
  /** When set, export KB chunks to JSONL inside the job output dir */
  kbSourceIds?: string[]
  pythonPath?: string
  /** Shown in the UI and used in finetunes/*.gguf filename */
  displayName?: string
  modelsDir: string
}

export function startTrainJob(
  db: Database.Database,
  userData: string,
  scriptPath: string,
  opts: StartTrainJobOpts
): TrainJob {
  const id = randomUUID()
  const t = Date.now()
  const outputDir = join(userData, 'train_outputs', id)
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  const displayName = (opts.displayName ?? '').trim() || `Fine-tune ${id.slice(0, 8)}`
  const kbIds = opts.kbSourceIds?.filter((x) => x.trim()) ?? []
  let datasetPathResolved: string
  let kbJson: string | null = null

  try {
    if (kbIds.length > 0) {
      datasetPathResolved = join(outputDir, 'kb_training_dataset.jsonl')
      exportKbSourcesToTrainingJsonl(db, kbIds, datasetPathResolved)
      kbJson = JSON.stringify(kbIds)
    } else if (opts.datasetPath?.trim()) {
      datasetPathResolved = opts.datasetPath.trim()
      if (!existsSync(datasetPathResolved)) {
        throw new Error(`Dataset file not found: ${datasetPathResolved}`)
      }
    } else {
      throw new Error('Select knowledge sources or set a dataset JSONL path.')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    db.prepare(
      `INSERT INTO train_jobs (id, status, base_model_path, output_dir, message, started_at, finished_at, created_at,
       kb_source_ids_json, display_name, dataset_path, artifact_path)
       VALUES (?, 'error', ?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, NULL)`
    ).run(id, opts.baseModelPath, outputDir, msg, t, displayName)
    const row = getTrainJob(db, id)
    if (!row) throw new Error('Failed to record train job')
    return row
  }

  db.prepare(
    `INSERT INTO train_jobs (id, status, base_model_path, output_dir, message, started_at, finished_at, created_at,
     kb_source_ids_json, display_name, dataset_path, artifact_path)
     VALUES (?, 'queued', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL)`
  ).run(id, opts.baseModelPath, outputDir, t, kbJson, displayName, datasetPathResolved)

  const script = scriptPath
  const py = opts.pythonPath ?? 'python'

  const job: TrainJob = {
    id,
    status: 'queued',
    baseModelPath: opts.baseModelPath,
    outputDir,
    startedAt: t,
    kbSourceIds: kbIds.length ? kbIds : undefined,
    displayName,
    datasetPath: datasetPathResolved
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
    [script, '--base_model', opts.baseModelPath, '--dataset', datasetPathResolved, '--output', outputDir],
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
      const ggufs = findGgufFilesRecursive(outputDir)
      const primary = pickPrimaryGguf(ggufs)
      let artifactPath: string | undefined
      let msg = out.slice(-500) || 'ok'
      if (primary && existsSync(opts.modelsDir)) {
        try {
          artifactPath = copyArtifactToModelsDir(primary, opts.modelsDir, displayName, id)
          msg = `${msg}\nRegistered GGUF for Run picker: ${artifactPath}`
        } catch (e) {
          logLine('warn', 'train_artifact_copy_failed', {
            id,
            error: e instanceof Error ? e.message : String(e)
          })
          msg = `${msg}\n(Could not copy GGUF to models/finetunes — copy manually from job folder.)`
        }
      } else if (!primary) {
        msg = `${msg}\nNo .gguf found in output — install a full training stack to produce merged.gguf, then use Rescan on this job.`
      }
      db.prepare(
        `UPDATE train_jobs SET status = ?, message = ?, finished_at = ?, artifact_path = ? WHERE id = ?`
      ).run('complete', msg.slice(-4000), done, artifactPath ?? null, id)
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

/** Re-scan job output for new .gguf files and register under models/finetunes */
export function rescanTrainJobArtifacts(
  db: Database.Database,
  jobId: string,
  modelsDir: string
): TrainJob | undefined {
  const row = db
    .prepare(
      `SELECT id, status, base_model_path as baseModelPath, output_dir as outputDir, message,
              started_at as startedAt, finished_at as finishedAt,
              kb_source_ids_json as kbSourceIdsJson, display_name as displayName,
              dataset_path as datasetPath, artifact_path as artifactPath
       FROM train_jobs WHERE id = ?`
    )
    .get(jobId) as Record<string, unknown> | undefined
  if (!row) return undefined
  const outputDir = String(row.outputDir)
  if (!existsSync(outputDir)) return mapRow(row)

  const ggufs = findGgufFilesRecursive(outputDir)
  const primary = pickPrimaryGguf(ggufs)
  const displayName = row.displayName != null ? String(row.displayName) : 'finetune'
  let artifactPath: string | null = null
  let msg = row.message != null ? String(row.message) : ''

  if (primary && existsSync(modelsDir)) {
    try {
      artifactPath = copyArtifactToModelsDir(primary, modelsDir, displayName, String(row.id))
      msg = `${msg}\nRescanned — registered: ${artifactPath}`.slice(-4000)
    } catch (e) {
      msg = `${msg}\nRescan copy failed: ${e instanceof Error ? e.message : String(e)}`.slice(-4000)
    }
  } else {
    msg = `${msg}\nRescan: no .gguf under job output.`.slice(-4000)
  }

  db.prepare(`UPDATE train_jobs SET artifact_path = ?, message = ? WHERE id = ?`).run(
    artifactPath,
    msg,
    jobId
  )
  return getTrainJob(db, jobId)
}

export function cancelAllRunningTrainJobs(): number {
  let n = 0
  for (const [, proc] of [...running.entries()]) {
    try {
      proc.kill()
      n++
    } catch {
      /* ignore */
    }
  }
  running.clear()
  return n
}

export function getTrainJob(db: Database.Database, id: string): TrainJob | undefined {
  const row = db
    .prepare(
      `SELECT id, status, base_model_path as baseModelPath, output_dir as outputDir, message,
              started_at as startedAt, finished_at as finishedAt,
              kb_source_ids_json as kbSourceIdsJson, display_name as displayName,
              dataset_path as datasetPath, artifact_path as artifactPath
       FROM train_jobs WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? mapRow(row) : undefined
}

function normalizeGgufPathKey(p: string): string {
  const t = p.trim().replace(/^file:\/\//i, '')
  try {
    return resolve(t).replace(/\\/g, '/').toLowerCase()
  } catch {
    return t.replace(/\\/g, '/').toLowerCase()
  }
}

/** If this GGUF was registered from a train job, return that job’s base model path. */
export function findBaseModelForFinetuneArtifact(db: Database.Database, artifactAbsolutePath: string): string | undefined {
  const want = normalizeGgufPathKey(artifactAbsolutePath)
  if (!want) return undefined
  const rows = db
    .prepare(
      `SELECT base_model_path AS b, artifact_path AS a
       FROM train_jobs
       WHERE status = 'complete' AND artifact_path IS NOT NULL AND TRIM(artifact_path) != ''`
    )
    .all() as { b: string; a: string }[]
  for (const r of rows) {
    if (!r.a || !r.b) continue
    if (normalizeGgufPathKey(r.a) === want) return r.b.trim()
  }
  const baseName = basename(want).toLowerCase()
  if (!baseName) return undefined
  for (const r of rows) {
    if (!r.a || !r.b) continue
    if (basename(normalizeGgufPathKey(r.a)) === baseName) return r.b.trim()
  }
  return undefined
}
