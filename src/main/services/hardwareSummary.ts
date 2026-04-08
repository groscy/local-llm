import { cpus, freemem, totalmem } from 'os'
import { existsSync, statfsSync } from 'fs'
import type { HardwareSummary } from '@shared/types'
import { probeNvidiaGpuFull } from './gpuProbe'

/**
 * RAM, CPU, optional NVIDIA GPU, and free space on the volume that hosts `diskCheckPath`.
 */
export function collectHardwareSummary(diskCheckPath: string): HardwareSummary {
  let downloadVolumeFreeBytes: number | undefined
  try {
    if (diskCheckPath && existsSync(diskCheckPath)) {
      const s = statfsSync(diskCheckPath)
      downloadVolumeFreeBytes = Number(s.bavail) * Number(s.bsize)
    }
  } catch {
    /* ignore */
  }
  const gpu = probeNvidiaGpuFull()
  return {
    totalRamBytes: totalmem(),
    freeRamBytes: freemem(),
    logicalCores: cpus().length,
    platform: process.platform,
    downloadVolumeFreeBytes,
    gpu: gpu
      ? {
          name: gpu.name,
          totalVramMb: gpu.totalMb,
          usedVramMb: gpu.usedMb
        }
      : undefined
  }
}
