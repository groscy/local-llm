import { spawnSync } from 'child_process'

export interface NvidiaGpuProbe {
  name: string
  usedMb: number
  totalMb: number
}

function parseNvidiaCsvLine(line: string): NvidiaGpuProbe | null {
  const parts = line.split(',').map((s) => s.trim())
  if (parts.length < 3) return null
  const total = parseFloat(parts[parts.length - 1]!)
  const used = parseFloat(parts[parts.length - 2]!)
  const name = parts.slice(0, -2).join(',').trim()
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || !name) return null
  return { name, usedMb: used, totalMb: total }
}

/**
 * NVIDIA GPU name + memory via nvidia-smi (MiB). Returns null if unavailable.
 */
export function probeNvidiaGpuFull(): NvidiaGpuProbe | null {
  const r = spawnSync(
    'nvidia-smi',
    ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }
  )
  if (r.error || r.status !== 0 || !r.stdout) return null
  const line = r.stdout.trim().split(/\r?\n/)[0]?.trim()
  if (!line) return null
  return parseNvidiaCsvLine(line)
}

/**
 * NVIDIA GPU memory via nvidia-smi (MiB). Returns null if unavailable.
 */
export function probeNvidiaGpuMemoryMb(): { usedMb: number; totalMb: number } | null {
  const g = probeNvidiaGpuFull()
  if (!g) return null
  return { usedMb: g.usedMb, totalMb: g.totalMb }
}
