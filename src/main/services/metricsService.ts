import { cpus, totalmem, freemem } from 'os'
import type Database from 'better-sqlite3'
import type { MetricsSnapshot } from '@shared/types'
import type { RuntimeAdapter } from './runtime/types'
import { averageChatRoundtripMs } from './chatLatencyStats'
import { probeNvidiaGpuMemoryMb } from './gpuProbe'

function processCpuApprox(): number {
  const c = cpus()
  if (!c?.length) return 0
  let idle = 0
  let total = 0
  for (const cpu of c) {
    idle += cpu.times.idle
    total +=
      cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  return Math.max(0, Math.min(100, 100 - (100 * idle) / total))
}

/** Sample metrics without writing to the database (for live widget polling). */
export async function peekSnapshot(runtime: RuntimeAdapter | null): Promise<MetricsSnapshot> {
  const ts = Date.now()
  let runtimeTokensPerSec: number | undefined
  let runtimeCtxUsed: number | undefined
  let modelMemoryMb: number | undefined
  if (runtime?.fetchMetrics) {
    try {
      const m = await runtime.fetchMetrics()
      runtimeTokensPerSec = m.tokensPerSec
      runtimeCtxUsed = m.ctxUsed
      modelMemoryMb = m.modelMemoryMb
    } catch {
      /* ignore */
    }
  }
  const rssMb = process.memoryUsage().rss / (1024 * 1024)
  const gpu = probeNvidiaGpuMemoryMb()
  const avgPromptToResponseMs = averageChatRoundtripMs()
  return {
    ts,
    runtimeTokensPerSec,
    runtimeCtxUsed,
    modelMemoryMb,
    processCpuPercent: processCpuApprox(),
    processRssMb: rssMb,
    gpuMemUsedMb: gpu?.usedMb,
    gpuMemTotalMb: gpu?.totalMb,
    ...(avgPromptToResponseMs != null ? { avgPromptToResponseMs } : {})
  }
}

export async function collectSnapshot(
  db: Database.Database,
  runtime: RuntimeAdapter | null
): Promise<MetricsSnapshot> {
  const snap = await peekSnapshot(runtime)
  db.prepare(
    `INSERT INTO metrics_samples (ts, runtime_tokens_per_sec, runtime_ctx_used, process_cpu_percent, process_rss_mb, gpu_mem_used_mb, gpu_mem_total_mb, model_memory_mb, avg_prompt_to_response_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    snap.ts,
    snap.runtimeTokensPerSec ?? null,
    snap.runtimeCtxUsed ?? null,
    snap.processCpuPercent ?? null,
    snap.processRssMb ?? null,
    snap.gpuMemUsedMb ?? null,
    snap.gpuMemTotalMb ?? null,
    snap.modelMemoryMb ?? null,
    snap.avgPromptToResponseMs ?? null
  )
  return snap
}

export function recentHistory(db: Database.Database, limit: number): MetricsSnapshot[] {
  return db
    .prepare(
      `SELECT ts, runtime_tokens_per_sec as runtimeTokensPerSec, runtime_ctx_used as runtimeCtxUsed,
              process_cpu_percent as processCpuPercent, process_rss_mb as processRssMb,
              gpu_mem_used_mb as gpuMemUsedMb, gpu_mem_total_mb as gpuMemTotalMb,
              model_memory_mb as modelMemoryMb,
              avg_prompt_to_response_ms as avgPromptToResponseMs
       FROM metrics_samples ORDER BY ts DESC LIMIT ?`
    )
    .all(limit) as MetricsSnapshot[]
}

export function systemMemSnapshot(): { totalGb: number; freeGb: number } {
  return {
    totalGb: totalmem() / 1024 ** 3,
    freeGb: freemem() / 1024 ** 3
  }
}
