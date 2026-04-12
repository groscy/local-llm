import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import { logLine } from '../logger'

const ST_EXT = /\.safetensors?$/i

export function isSafetensorsWeightFilePath(p: string): boolean {
  const t = p.trim().replace(/^file:\/\//i, '')
  return ST_EXT.test(t)
}

export function hfModelDirForSafetensorsWeight(absWeightPath: string): string {
  return dirname(resolve(absWeightPath.replace(/^file:\/\//i, '')))
}

export function dirHasHfConfig(modelDir: string): boolean {
  return existsSync(join(modelDir, 'config.json'))
}

/**
 * Directory that should be passed to `convert_hf_to_gguf.py` — the folder that contains `config.json`
 * (same dir as the weight, or an ancestor when weights live in a subfolder).
 */
export function resolveHfModelRootDirForSafetensorsWeight(
  absWeightPath: string,
  maxHops = 24
): string | null {
  let dir = dirname(resolve(absWeightPath.replace(/^file:\/\//i, '')))
  for (let i = 0; i < maxHops; i++) {
    if (existsSync(join(dir, 'config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Known locations inside a llama.cpp checkout (repo root may add more over time). */
function convertScriptCandidatesInDir(dir: string): string[] {
  return [join(dir, 'convert_hf_to_gguf.py'), join(dir, 'tools', 'convert_hf_to_gguf.py')]
}

function firstExistingScriptInDir(dir: string): string | null {
  for (const c of convertScriptCandidatesInDir(dir)) {
    if (existsSync(c)) return c
  }
  return null
}

/**
 * Directory containing the real llama-server binary. Resolves symlinks so walking upward
 * reaches the llama.cpp tree when the binary is linked from e.g. /usr/local/bin.
 */
function llamaBinaryParentDirResolved(llamaBinaryPath: string): string {
  const raw = resolve(llamaBinaryPath.replace(/^file:\/\//i, ''))
  try {
    return dirname(realpathSync(raw))
  } catch {
    return dirname(raw)
  }
}

function walkUpForConvertScript(startDir: string, maxHops: number): string | null {
  let dir = resolve(startDir)
  for (let i = 0; i < maxHops; i++) {
    const hit = firstExistingScriptInDir(dir)
    if (hit) return hit
    const p = dirname(dir)
    if (p === dir) break
    dir = p
  }
  return null
}

function uniqueLlamaBinaryHints(paths: (string | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    const t = p?.trim().replace(/^file:\/\//i, '')
    if (!t) continue
    let key: string
    try {
      key = resolve(t).replace(/\\/g, '/').toLowerCase()
    } catch {
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

function findConvertScriptByWalkingLlamaBins(hints: string[]): string | null {
  for (const raw of hints) {
    let abs: string
    try {
      abs = resolve(raw)
    } catch {
      continue
    }
    if (!existsSync(abs)) continue
    const hit = walkUpForConvertScript(llamaBinaryParentDirResolved(abs), 28)
    if (hit) return hit
  }
  return null
}

export function resolveConvertScriptPath(opts: {
  llamaBinaryPath?: string
  /** When the active binary came from PATH, still try walking from these paths (e.g. Settings value). */
  llamaBinaryAlternatePaths?: string[]
  configuredScriptPath?: string
}): string {
  const cfg = opts.configuredScriptPath?.trim()
  if (cfg) {
    const r = resolve(cfg.replace(/^file:\/\//i, ''))
    if (existsSync(r)) return r
    try {
      const rp = realpathSync(r)
      if (existsSync(rp)) return rp
    } catch {
      /* unresolved */
    }
    throw new Error(`llama.cpp convert script not found at the path in Settings: ${cfg}`)
  }

  const envRoot = (process.env.LLAMA_CPP_ROOT || process.env.LLAMA_CPP_HOME || '')
    .trim()
    .replace(/^file:\/\//i, '')
  if (envRoot) {
    const hit = firstExistingScriptInDir(resolve(envRoot))
    if (hit) return hit
  }

  const hints = uniqueLlamaBinaryHints([
    opts.llamaBinaryPath,
    ...(opts.llamaBinaryAlternatePaths ?? [])
  ])
  if (hints.length === 0) {
    throw new Error(
      'To run .safetensors locally, install a llama.cpp checkout with convert_hf_to_gguf.py, set the path to that script (or set LLAMA_CPP_ROOT to the repo root) under Settings → AI engine, and point llama-server at your build (or leave it on PATH if that binary lives inside the clone). Python deps: pip install -r requirements.txt in the llama.cpp folder.'
    )
  }
  const found = findConvertScriptByWalkingLlamaBins(hints)
  if (!found) {
    throw new Error(
      'Could not find convert_hf_to_gguf.py near llama-server. Fix: (1) Settings → AI engine → set the full path to convert_hf_to_gguf.py inside your llama.cpp clone, or (2) set environment variable LLAMA_CPP_ROOT to that clone’s root, or (3) point llama-server at the executable inside your checkout (build folder), not only a standalone copy on PATH. The app follows symlinks to the real binary. If you use a prebuilt llama-server with no source tree, you must set the convert script path or LLAMA_CPP_ROOT explicitly.'
    )
  }
  return found
}

function defaultPythonExe(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

function resolvePythonExe(configured?: string): string {
  const t = configured?.trim()
  if (t) return t.replace(/^file:\/\//i, '')
  return defaultPythonExe()
}

export function ggufCachePath(userData: string, modelDirAbs: string): string {
  const hash = createHash('sha256')
    .update(resolve(modelDirAbs).replace(/\\/g, '/').toLowerCase())
    .digest('hex')
    .slice(0, 16)
  const dir = join(userData, 'safetensors_gguf_cache')
  return join(dir, `${hash}.gguf`)
}

export function modelDirSourceNewerThanCache(modelDir: string, cachePath: string): boolean {
  if (!existsSync(cachePath)) return true
  let cacheM: number
  try {
    cacheM = statSync(cachePath).mtimeMs
  } catch {
    return true
  }
  let maxSrc = 0
  const bump = (p: string): void => {
    try {
      const m = statSync(p).mtimeMs
      if (m > maxSrc) maxSrc = m
    } catch {
      /* */
    }
  }
  bump(join(modelDir, 'config.json'))
  let names: string[]
  try {
    names = readdirSync(modelDir)
  } catch {
    return true
  }
  for (const n of names) {
    if (/\.safetensors?$/i.test(n) || n === 'tokenizer.model' || n === 'tokenizer.json') {
      bump(join(modelDir, n))
    }
  }
  return maxSrc > cacheM
}

/**
 * llama-server loads GGUF only. For a selected `.safetensors` file inside a HF model folder,
 * run llama.cpp `convert_hf_to_gguf.py` into a userData cache, then return that `.gguf` path.
 */
export async function ensureGgufForSafetensorsModelPath(opts: {
  weightPath: string
  userData: string
  llamaBinaryPath?: string
  llamaBinaryAlternatePaths?: string[]
  convertScriptConfigured?: string
  pythonConfigured?: string
  onProgress?: (e: { phase: string; message: string; percent?: number }) => void
}): Promise<{ loadPath: string; displayPath: string }> {
  const raw = opts.weightPath.trim().replace(/^file:\/\//i, '')
  const absWeight = resolve(raw)
  const displayPath = absWeight
  if (!isSafetensorsWeightFilePath(absWeight)) {
    return { loadPath: absWeight, displayPath }
  }
  const modelDir = resolveHfModelRootDirForSafetensorsWeight(absWeight)
  if (!modelDir) {
    throw new Error(
      'Could not find config.json for this .safetensors file. It must live inside a Hugging Face model directory (config.json in the same folder as the weight or in a parent folder). If you only downloaded a single weight file, download the full repository (including config.json, tokenizer files, etc.) or use a .gguf build.'
    )
  }
  const script = resolveConvertScriptPath({
    llamaBinaryPath: opts.llamaBinaryPath,
    llamaBinaryAlternatePaths: opts.llamaBinaryAlternatePaths,
    configuredScriptPath: opts.convertScriptConfigured
  })
  const python = resolvePythonExe(opts.pythonConfigured)
  const out = ggufCachePath(opts.userData, modelDir)
  const rebuild = modelDirSourceNewerThanCache(modelDir, out)
  if (!rebuild && existsSync(out)) {
    opts.onProgress?.({
      phase: 'convert',
      message: 'Using cached GGUF converted from this Safetensors model folder…',
      percent: 18
    })
    return { loadPath: out, displayPath }
  }
  opts.onProgress?.({
    phase: 'convert',
    message:
      'Converting Safetensors → GGUF with convert_hf_to_gguf.py (first run may take several minutes)…',
    percent: 8
  })
  mkdirSync(dirname(out), { recursive: true })
  const args = [script, modelDir, '--outfile', out, '--outtype', 'f16']
  logLine('info', 'safetensors_gguf_convert_spawn', { python, modelDir, out })
  await new Promise<void>((promiseResolve, promiseReject) => {
    const child = spawn(python, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: dirname(script),
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
    let errTail = ''
    const onOut = (buf: Buffer): void => {
      const s = buf.toString()
      errTail = (errTail + s).slice(-8000)
      const parts = s.split(/\n/).filter((x) => x.trim())
      const line = parts[parts.length - 1]
      if (line?.trim()) {
        opts.onProgress?.({
          phase: 'convert',
          message: line.trim().slice(0, 220),
          percent: 12
        })
      }
    }
    child.stdout?.on('data', onOut)
    child.stderr?.on('data', onOut)
    child.on('error', (e) => promiseReject(e))
    child.on('close', (code) => {
      if (code === 0 && existsSync(out)) {
        promiseResolve()
        return
      }
      promiseReject(
        new Error(
          `convert_hf_to_gguf.py failed (exit ${code ?? '?'}). ${errTail.trim().slice(-1800) || 'No output.'}`
        )
      )
    })
  })
  opts.onProgress?.({ phase: 'convert', message: 'Conversion finished. Starting llama-server…', percent: 20 })
  return { loadPath: out, displayPath }
}
