import type { HardwareSummary } from './types'

export type FitVerdict = 'good' | 'marginal' | 'poor' | 'unknown'

export interface ModelHardwareEvaluation {
  verdict: FitVerdict
  headline: string
  notes: string[]
}

export interface EvaluateModelHardwareOptions {
  /** Sibling is selected but the Hub payload omitted `size` — show hardware snapshot only. */
  fileSelectedSizeMissing?: boolean
}

const RAM_COMFORT = 1.22
const RAM_TIGHT = 1.04
const DISK_HEADROOM = 1.06
const VRAM_COMFORT = 0.88
const VRAM_TIGHT = 1.0

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2)
}

function rank(v: FitVerdict): number {
  if (v === 'poor') return 0
  if (v === 'marginal') return 1
  if (v === 'unknown') return 2
  return 3
}

function minVerdict(a: FitVerdict, b: FitVerdict): FitVerdict {
  return rank(a) <= rank(b) ? a : b
}

function tierRam(freeRam: number, fileSize: number): FitVerdict {
  if (freeRam >= fileSize * RAM_COMFORT) return 'good'
  if (freeRam >= fileSize * RAM_TIGHT) return 'marginal'
  return 'poor'
}

function tierDisk(freeBytes: number | undefined, fileSize: number): FitVerdict {
  if (freeBytes === undefined) return 'unknown'
  if (freeBytes >= fileSize * DISK_HEADROOM) return 'good'
  if (freeBytes >= fileSize) return 'marginal'
  return 'poor'
}

function tierGpu(fileSize: number, hw: NonNullable<HardwareSummary['gpu']>): FitVerdict {
  const freeBytes = Math.max(0, (hw.totalVramMb - hw.usedVramMb) * 1024 * 1024)
  const totalBytes = hw.totalVramMb * 1024 * 1024
  if (fileSize <= freeBytes * VRAM_COMFORT) return 'good'
  if (fileSize <= freeBytes * VRAM_TIGHT) return 'marginal'
  if (fileSize <= totalBytes * 1.02) return 'marginal'
  return 'poor'
}

const DISCLAIMER =
  'Approximate check only — context length, quantization, and CPU/GPU split change real memory use.'

function pushMachineSnapshotNotes(notes: string[], hw: HardwareSummary, diskContext: string): void {
  notes.push(
    `CPU / RAM: ~${gb(hw.freeRamBytes)} GB free of ~${gb(hw.totalRamBytes)} GB total (${hw.logicalCores} logical CPUs).`
  )
  if (hw.downloadVolumeFreeBytes != null) {
    notes.push(`Disk: ~${gb(hw.downloadVolumeFreeBytes)} GB free on the download folder’s volume${diskContext}.`)
  } else {
    notes.push(`Disk: could not read free space for the download folder (path missing or unsupported).`)
  }
  if (hw.gpu) {
    const freeMb = Math.max(0, Math.round(hw.gpu.totalVramMb - hw.gpu.usedVramMb))
    notes.push(
      `GPU (${hw.gpu.name}): ~${freeMb} MiB free of ${hw.gpu.totalVramMb} MiB VRAM.`
    )
  } else {
    notes.push(`GPU: no NVIDIA GPU reported by nvidia-smi — inference is often CPU-bound here.`)
  }
}

/**
 * Heuristic fit for a single GGUF (or other weight file) vs this machine.
 * Intended as guidance only — quant, context size, and runtime split affect real use.
 */
export function evaluateModelForHardware(
  fileSizeBytes: number | undefined,
  hw: HardwareSummary,
  options?: EvaluateModelHardwareOptions
): ModelHardwareEvaluation {
  const notes: string[] = []

  if (options?.fileSelectedSizeMissing) {
    pushMachineSnapshotNotes(
      notes,
      hw,
      ' — cannot compare to this file without a listed byte size'
    )
    notes.push(DISCLAIMER)
    return {
      verdict: 'unknown',
      headline:
        'This file has no size in the Hub listing here — use the repo total above or the model page to judge the download.',
      notes
    }
  }

  if (fileSizeBytes == null || fileSizeBytes <= 0) {
    pushMachineSnapshotNotes(notes, hw, '')
    notes.push(DISCLAIMER)
    return {
      verdict: 'unknown',
      headline: 'Choose a file above to estimate RAM, disk, and GPU fit for that download.',
      notes
    }
  }

  const ramTier = tierRam(hw.freeRamBytes, fileSizeBytes)
  const diskTier = tierDisk(hw.downloadVolumeFreeBytes, fileSizeBytes)
  const gpuTier: FitVerdict = hw.gpu ? tierGpu(fileSizeBytes, hw.gpu) : 'unknown'

  notes.push(
    `CPU / RAM: treating ~${gb(fileSizeBytes * RAM_COMFORT)} GB free RAM as comfortable for loading ~${gb(fileSizeBytes)} GB weights; you have ~${gb(hw.freeRamBytes)} GB free of ~${gb(hw.totalRamBytes)} GB total (${hw.logicalCores} logical CPUs).`
  )

  if (hw.downloadVolumeFreeBytes != null) {
    if (diskTier === 'good') {
      notes.push(
        `Disk: ~${gb(hw.downloadVolumeFreeBytes)} GB free on the download folder’s volume — enough headroom for this file.`
      )
    } else if (diskTier === 'marginal') {
      notes.push(
        `Disk: ~${gb(hw.downloadVolumeFreeBytes)} GB free — tight; leave extra space for temp files.`
      )
    } else {
      notes.push(
        `Disk: ~${gb(hw.downloadVolumeFreeBytes)} GB free — likely not enough for this file plus a small buffer.`
      )
    }
  } else {
    notes.push(`Disk: could not read free space for the download folder (path missing or unsupported).`)
  }

  if (hw.gpu) {
    const freeMb = Math.max(0, Math.round(hw.gpu.totalVramMb - hw.gpu.usedVramMb))
    if (gpuTier === 'good') {
      notes.push(
        `GPU (${hw.gpu.name}): ~${freeMb} MiB free of ${hw.gpu.totalVramMb} MiB VRAM — file can fully offload to GPU in typical setups.`
      )
    } else if (gpuTier === 'marginal') {
      notes.push(
        `GPU (${hw.gpu.name}): VRAM is tight — expect partial GPU offload, smaller context, or CPU fallback.`
      )
    } else {
      notes.push(
        `GPU (${hw.gpu.name}): file is large vs ${hw.gpu.totalVramMb} MiB VRAM — full GPU offload is unlikely; CPU or hybrid loading may be slow or fail depending on runtime.`
      )
    }
  } else {
    notes.push(
      `GPU: no NVIDIA GPU reported by nvidia-smi — inference is assumed CPU- or other-vendor-heavy; RAM matters most.`
    )
  }

  let verdict: FitVerdict = ramTier
  verdict = minVerdict(verdict, diskTier)
  if (hw.gpu) {
    verdict = minVerdict(verdict, gpuTier)
  } else if (ramTier === 'good' && fileSizeBytes > hw.totalRamBytes * 0.92) {
    verdict = minVerdict(verdict, 'marginal')
    notes.push(`Single-file size is close to total system RAM — risk of pressure from OS and other apps.`)
  }

  let headline: string
  if (verdict === 'good') {
    headline =
      'This machine looks reasonably well matched to this file for local inference (heuristic; your runtime may vary).'
  } else if (verdict === 'marginal') {
    headline =
      'This file may run but resources are tight — expect slower inference, partial GPU use, or swapping.'
  } else if (verdict === 'poor') {
    headline =
      'This file is likely a poor fit for this machine (RAM, disk, and/or GPU) — downloads or loading may fail or be very slow.'
  } else {
    headline = 'Could not fully assess fit.'
  }

  notes.push(DISCLAIMER)

  return { verdict, headline, notes }
}
