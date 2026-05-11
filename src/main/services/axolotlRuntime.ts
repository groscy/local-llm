import { spawn, spawnSync, type SpawnOptions, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

type AxolotlRuntimeManifest = {
  version?: string
  entrypoints?: {
    probe?: string
    train?: string
  }
}

export type AxolotlModelProbeResult = {
  supported: boolean
  reason: string
  details?: string
  backend: 'axolotl'
  runtimeVersion?: string
}

function readRuntimeManifest(root: string): AxolotlRuntimeManifest {
  const manifestPath = join(root, 'manifest.json')
  if (!existsSync(manifestPath)) return {}
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as AxolotlRuntimeManifest
  } catch {
    return {}
  }
}

function bundledAxolotlRuntimeRoot(): string {
  const isDevRuntime = !process.resourcesPath || process.env.NODE_ENV !== 'production' || !!process.env.VITEST
  return isDevRuntime ? join(process.cwd(), 'vendor', 'axolotl-runtime') : join(process.resourcesPath, 'axolotl-runtime')
}

function resolveEntrypoint(root: string, kind: 'probe' | 'train'): string {
  const manifest = readRuntimeManifest(root)
  const fromManifest = kind === 'probe' ? manifest.entrypoints?.probe : manifest.entrypoints?.train
  const defaultPath = kind === 'probe' ? join('bin', 'axolotl-probe.js') : join('bin', 'axolotl-train.js')
  const rel = (fromManifest ?? defaultPath).replace(/^[/\\]+/, '')
  return join(root, rel)
}

export function assertBundledAxolotlRuntimeAvailable(): { root: string; version?: string } {
  const root = bundledAxolotlRuntimeRoot()
  const probe = resolveEntrypoint(root, 'probe')
  const train = resolveEntrypoint(root, 'train')
  if (!existsSync(root)) {
    throw new Error(`Bundled Axolotl runtime not found at: ${root}`)
  }
  if (!existsSync(probe) || !existsSync(train)) {
    throw new Error('Bundled Axolotl runtime is incomplete (missing probe/train entrypoints).')
  }
  const manifest = readRuntimeManifest(root)
  const version = typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version.trim() : undefined
  return { root, version }
}

export function probeAxolotlModelSupport(baseModelPath: string): AxolotlModelProbeResult {
  const { root, version } = assertBundledAxolotlRuntimeAvailable()
  const probeScript = resolveEntrypoint(root, 'probe')
  const result = spawnSync(process.execPath, [probeScript, '--base_model', baseModelPath], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  })
  if (result.error) throw result.error
  const merged = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  if (result.status !== 0) {
    throw new Error(merged || `Axolotl probe failed with exit code ${String(result.status ?? 'unknown')}.`)
  }
  let parsed: Partial<AxolotlModelProbeResult> = {}
  try {
    parsed = JSON.parse((result.stdout ?? '').trim()) as Partial<AxolotlModelProbeResult>
  } catch {
    throw new Error('Axolotl probe returned invalid JSON output.')
  }
  return {
    supported: parsed.supported === true,
    reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'Probe completed.',
    details: typeof parsed.details === 'string' && parsed.details.trim() ? parsed.details.trim() : undefined,
    backend: 'axolotl',
    runtimeVersion:
      typeof parsed.runtimeVersion === 'string' && parsed.runtimeVersion.trim()
        ? parsed.runtimeVersion.trim()
        : version
  }
}

export function spawnBundledAxolotlTrain(
  args: {
    baseModelPath: string
    datasetPath: string
    outputDir: string
    displayName?: string
  },
  options?: SpawnOptions
): ChildProcessWithoutNullStreams {
  const { root } = assertBundledAxolotlRuntimeAvailable()
  const trainScript = resolveEntrypoint(root, 'train')
  const cmdArgs = [
    trainScript,
    '--base_model',
    args.baseModelPath,
    '--dataset',
    args.datasetPath,
    '--output',
    args.outputDir
  ]
  if (args.displayName?.trim()) {
    cmdArgs.push('--display_name', args.displayName.trim())
  }
  return spawn(process.execPath, cmdArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }) as ChildProcessWithoutNullStreams
}
