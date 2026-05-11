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

type CpuSample = { idle: number; total: number }
let prevSystemCpuSample: CpuSample | null = null

function readCpuSample(): CpuSample {
  const c = cpus()
  let idle = 0
  let total = 0
  for (const cpu of c) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  return { idle, total }
}

/** Delta-based host CPU usage estimate across calls (0..100). */
function systemCpuPercentSampled(): number {
  const current = readCpuSample()
  const previous = prevSystemCpuSample
  prevSystemCpuSample = current
  if (!previous) return processCpuApprox()
  const totalDelta = current.total - previous.total
  const idleDelta = current.idle - previous.idle
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) return processCpuApprox()
  const busyRatio = 1 - idleDelta / totalDelta
  return Math.max(0, Math.min(100, busyRatio * 100))
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
  const systemCpuPercent = systemCpuPercentSampled()
  const totalMem = totalmem()
  const freeMem = freemem()
  const usedMem = Math.max(0, totalMem - freeMem)
  const systemMemoryPressurePercent =
    totalMem > 0 ? Math.max(0, Math.min(100, (usedMem / totalMem) * 100)) : undefined
  const systemLoadPercent =
    systemMemoryPressurePercent != null
      ? Math.max(0, Math.min(100, systemCpuPercent * 0.65 + systemMemoryPressurePercent * 0.35))
      : systemCpuPercent
  const gpu = probeNvidiaGpuMemoryMb()
  const avgPromptToResponseMs = averageChatRoundtripMs()
  return {
    ts,
    runtimeTokensPerSec,
    runtimeCtxUsed,
    modelMemoryMb,
    processCpuPercent: processCpuApprox(),
    systemCpuPercent,
    systemMemoryPressurePercent,
    systemLoadPercent,
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
