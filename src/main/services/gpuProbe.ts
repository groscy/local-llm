import { spawnSync } from 'child_process'

/**
 * NVIDIA GPU memory via nvidia-smi (MiB). Returns null if unavailable.
 */
export function probeNvidiaGpuMemoryMb(): { usedMb: number; totalMb: number } | null {
  const r = spawnSync(
    'nvidia-smi',
    ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 }
  )
  if (r.error || r.status !== 0 || !r.stdout) return null
  const line = r.stdout.trim().split(/\r?\n/)[0]?.trim()
  if (!line) return null
  const parts = line.split(',').map((s) => s.trim())
  if (parts.length < 2) return null
  const used = parseFloat(parts[0]!)
  const total = parseFloat(parts[1]!)
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null
  return { usedMb: used, totalMb: total }
}
