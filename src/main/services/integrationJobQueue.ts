import { randomUUID } from 'crypto'
import type Store from 'electron-store'

export type IntegrationJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface IntegrationJobRecord<TPayload, TResult> {
  id: string
  payload: TPayload
  state: IntegrationJobState
  progressText: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  result?: TResult
}

type PersistedSnapshot<TPayload, TResult> = {
  records: IntegrationJobRecord<TPayload, TResult>[]
}

export class IntegrationJobQueue<TPayload, TResult> {
  private readonly records = new Map<string, IntegrationJobRecord<TPayload, TResult>>()
  private readonly queue: string[] = []
  private readonly concurrency: number
  private readonly maxRetained: number
  private running = 0
  private shuttingDown = false
  private readonly storeKey: string

  constructor(
    private readonly store: Store<Record<string, unknown>>,
    args: {
      storeKey?: string
      concurrency?: number
      maxRetained?: number
      initialProgressText?: string
      processor: (job: IntegrationJobRecord<TPayload, TResult>, setProgress: (text: string) => void) => Promise<TResult>
    }
  ) {
    this.storeKey = args.storeKey ?? 'integrationJobQueueState'
    this.concurrency = Math.max(1, Math.floor(args.concurrency ?? 1))
    this.maxRetained = Math.max(10, Math.floor(args.maxRetained ?? 120))
    this.initialProgressText = args.initialProgressText ?? 'Queued'
    this.processor = args.processor
    this.restore()
  }

  private readonly initialProgressText: string
  private readonly processor: (
    job: IntegrationJobRecord<TPayload, TResult>,
    setProgress: (text: string) => void
  ) => Promise<TResult>

  submit(payload: TPayload): IntegrationJobRecord<TPayload, TResult> {
    const id = randomUUID()
    const now = Date.now()
    const rec: IntegrationJobRecord<TPayload, TResult> = {
      id,
      payload,
      state: 'queued',
      progressText: this.initialProgressText,
      createdAt: now,
      updatedAt: now
    }
    this.records.set(id, rec)
    this.queue.push(id)
    this.persist()
    this.drain()
    return { ...rec }
  }

  get(id: string): IntegrationJobRecord<TPayload, TResult> | null {
    const rec = this.records.get(id)
    return rec ? { ...rec } : null
  }

  cancel(id: string): boolean {
    const rec = this.records.get(id)
    if (!rec) return false
    if (rec.state === 'completed' || rec.state === 'failed' || rec.state === 'cancelled') return false
    rec.state = 'cancelled'
    rec.progressText = 'Cancelled'
    rec.updatedAt = Date.now()
    rec.finishedAt = rec.finishedAt ?? Date.now()
    this.persist()
    return true
  }

  shutdown(): void {
    this.shuttingDown = true
    this.persist()
  }

  private drain(): void {
    if (this.shuttingDown) return
    while (this.running < this.concurrency && this.queue.length > 0) {
      const jobId = this.queue.shift()
      if (!jobId) break
      const rec = this.records.get(jobId)
      if (!rec || rec.state !== 'queued') continue
      this.running += 1
      rec.state = 'running'
      rec.startedAt = Date.now()
      rec.updatedAt = rec.startedAt
      rec.progressText = 'Running'
      this.persist()
      void this.runOne(rec)
    }
  }

  private async runOne(rec: IntegrationJobRecord<TPayload, TResult>): Promise<void> {
    const setProgress = (text: string): void => {
      if (rec.state !== 'running') return
      rec.progressText = text.trim().slice(0, 240) || rec.progressText
      rec.updatedAt = Date.now()
      this.persist()
    }
    try {
      const result = await this.processor(rec, setProgress)
      if (rec.state === 'cancelled') {
        rec.updatedAt = Date.now()
        rec.finishedAt = rec.updatedAt
      } else {
        rec.state = 'completed'
        rec.result = result
        rec.progressText = 'Completed'
        rec.updatedAt = Date.now()
        rec.finishedAt = rec.updatedAt
      }
    } catch (e) {
      if (rec.state === 'cancelled') {
        rec.updatedAt = Date.now()
        rec.finishedAt = rec.updatedAt
      } else {
        rec.state = 'failed'
        rec.error = e instanceof Error ? e.message : String(e)
        rec.progressText = 'Failed'
        rec.updatedAt = Date.now()
        rec.finishedAt = rec.updatedAt
      }
    } finally {
      this.running = Math.max(0, this.running - 1)
      this.trim()
      this.persist()
      this.drain()
    }
  }

  private restore(): void {
    const raw = this.store.get(this.storeKey)
    if (!raw || typeof raw !== 'object') return
    const snapshot = raw as PersistedSnapshot<TPayload, TResult>
    if (!Array.isArray(snapshot.records)) return
    for (const row of snapshot.records) {
      if (!row || typeof row.id !== 'string') continue
      const rec: IntegrationJobRecord<TPayload, TResult> = {
        ...row,
        state:
          row.state === 'queued' || row.state === 'running' ? 'cancelled' : row.state,
        progressText:
          row.state === 'queued' || row.state === 'running'
            ? 'Cancelled (app restarted)'
            : row.progressText || row.state,
        updatedAt: Date.now(),
        finishedAt:
          row.state === 'queued' || row.state === 'running' ? Date.now() : row.finishedAt
      }
      this.records.set(rec.id, rec)
    }
    this.trim()
    this.persist()
  }

  private trim(): void {
    const rows = [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt)
    const keep = rows.slice(0, this.maxRetained)
    const keepIds = new Set(keep.map((r) => r.id))
    for (const id of this.records.keys()) {
      if (!keepIds.has(id)) this.records.delete(id)
    }
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const id = this.queue[i]
      if (!id || !keepIds.has(id)) this.queue.splice(i, 1)
    }
  }

  private persist(): void {
    const rows = [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt)
    this.store.set(this.storeKey, { records: rows } as unknown as Record<string, unknown>)
  }
}
