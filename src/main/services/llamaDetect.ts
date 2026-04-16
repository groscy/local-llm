import { execFileSync, spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { basename, dirname, join, resolve as resolvePath } from 'path'

const HELP_PROBE_TIMEOUT_MS = 14_000
const HELP_MAX_BYTES = 120_000
const VALIDATE_CACHE_TTL_MS = 45_000

type ValidateResult = { ok: true } | { ok: false; error: string }

let validateCache: { abs: string; mtimeMs: number; at: number; result: ValidateResult } | null = null
/** Avoid overlapping `--help` probes when the Run drawer polls quickly. */
const validateInFlight = new Map<string, Promise<ValidateResult>>()

function analyzeHelpOutput(
  text: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  absPath: string
): ValidateResult {
  const t = text.trim()
  if (t.length === 0) {
    return {
      ok: false,
      error: `No output from "${basename(absPath)} --help". It may be the wrong executable, the wrong architecture, or a dependency failed to load (on Windows, CUDA builds need matching drivers and DLLs beside the .exe).`
    }
  }
  if (/\bllama-cli\b/i.test(t) && !/\bllama-server\b/i.test(t) && !/--port\b/.test(t)) {
    return {
      ok: false,
      error:
        'This executable looks like llama-cli (interactive CLI), not llama-server. This app needs the llama-server binary (HTTP / OpenAI-compatible API). Use the llama-server executable from the same llama.cpp release.'
    }
  }
  const lower = t.toLowerCase()
  const looksLikeServer =
    /\bllama-server\b/i.test(t) ||
    (/--port\b/.test(t) && /(\-m\b|--model\b)/.test(t) && /(--host\b|127\.0\.0\.1|localhost)/i.test(t)) ||
    /\/v1\/chat|openai.?compat|chat.?completions?|inference.*server|http.*server/i.test(lower)
  if (!looksLikeServer) {
    if (exitCode !== 0 && t.length < 24) {
      const hint =
        process.platform === 'win32'
          ? ' On Windows, CUDA builds need a matching GPU driver and the Visual C++ runtime; DLLs must sit next to the .exe.'
          : ''
      return {
        ok: false,
        error: `Running --help failed (exit ${exitCode ?? '?'}, signal ${signal ?? 'none'}). Output: ${t.slice(0, 500)}${hint}`
      }
    }
    return {
      ok: false,
      error: `${basename(absPath)} does not look like llama-server (expected server help: --port, model / -m, or OpenAI-compatible HTTP). You may have picked the wrong executable from the llama.cpp build.`
    }
  }
  return { ok: true }
}

function runHelpProbe(absPath: string): Promise<ValidateResult> {
  return new Promise((resolvePromise) => {
    const cwd = dirname(absPath)
    const parts: Buffer[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const child = spawn(absPath, ['--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      windowsHide: false,
      env: { ...process.env }
    })
    const done = (r: ValidateResult): void => {
      if (settled) return
      settled = true
      if (timer != null) clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolvePromise(r)
    }
    const onData = (c: Buffer): void => {
      parts.push(Buffer.from(c))
      if (Buffer.concat(parts).length > HELP_MAX_BYTES) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    timer = setTimeout(() => {
      done({
        ok: false,
        error: `Timed out after ${HELP_PROBE_TIMEOUT_MS / 1000}s running "${basename(absPath)} --help". The file may hang, require a GUI, or be blocked.`
      })
    }, HELP_PROBE_TIMEOUT_MS)
    child.on('error', (err) => {
      done({ ok: false, error: `Could not run "${absPath}": ${err.message}` })
    })
    child.on('close', (code, sig) => {
      const out = Buffer.concat(parts).toString('utf8')
      done(analyzeHelpOutput(out, code, sig, absPath))
    })
  })
}

/**
 * Confirms the path is a real file and that `--help` output matches llama-server (not llama-cli, etc.).
 * Use before spawning the runtime. Cached briefly by path + mtime for UI polling.
 */
export async function validateLlamaServerBinary(
  rawPath: string,
  opts?: { bypassCache?: boolean }
): Promise<ValidateResult> {
  const trimmed = typeof rawPath === 'string' ? rawPath.trim() : ''
  if (!trimmed) {
    return { ok: false, error: 'No path to llama-server was provided.' }
  }
  const abs = resolvePath(trimmed.replace(/^file:\/\//i, ''))
  if (!existsSync(abs)) {
    return { ok: false, error: `llama-server binary not found: ${abs}` }
  }
  let mtimeMs = 0
  try {
    const st = statSync(abs)
    if (!st.isFile()) {
      return { ok: false, error: `Not a regular file: ${abs}` }
    }
    mtimeMs = st.mtimeMs
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read that path.' }
  }
  const now = Date.now()
  if (
    !opts?.bypassCache &&
    validateCache &&
    validateCache.abs === abs &&
    validateCache.mtimeMs === mtimeMs &&
    now - validateCache.at < VALIDATE_CACHE_TTL_MS
  ) {
    return validateCache.result
  }
  const flightKey = `${abs}\0${mtimeMs}${opts?.bypassCache ? '\0bypass' : ''}`
  let pending = validateInFlight.get(flightKey)
  if (!pending) {
    pending = (async (): Promise<ValidateResult> => {
      const result = await runHelpProbe(abs)
      validateCache = { abs, mtimeMs, at: Date.now(), result }
      return result
    })().finally(() => {
      validateInFlight.delete(flightKey)
    })
    validateInFlight.set(flightKey, pending)
  }
  return pending
}

/**
 * Returns a usable llama-server path: configured path if it exists, otherwise a binary found on PATH.
 */
export function resolveLlamaBinary(configuredPath: string | undefined): string | undefined {
  const trimmed = typeof configuredPath === 'string' ? configuredPath.trim() : ''
  if (trimmed && existsSync(trimmed)) return trimmed
  return findLlamaServerOnPath()
}

/**
 * Windows: avoid `where.exe` — when the binary is missing it prints
 * "INFO: Could not find files for the given pattern(s)." to the console even from a GUI app,
 * which spams logs every time the Run drawer polls PATH.
 */
function findLlamaServerOnPathWindows(): string | undefined {
  const pathVar = process.env.Path ?? process.env.PATH ?? ''
  const dirs = pathVar
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
  const candidates = ['llama-server.exe', 'llama-server']
  for (const dir of dirs) {
    for (const name of candidates) {
      const full = join(dir, name)
      try {
        if (existsSync(full)) return full
      } catch {
        /* invalid path segment */
      }
    }
  }
  return undefined
}

function findLlamaServerOnPath(): string | undefined {
  try {
    if (process.platform === 'win32') {
      return findLlamaServerOnPathWindows()
    }
    const out = execFileSync('which', ['llama-server'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    if (out && existsSync(out)) return out
  } catch {
    /* not on PATH */
  }
  return undefined
}

export function isLlamaServerAvailable(configuredPath: string | undefined): boolean {
  return resolveLlamaBinary(configuredPath) !== undefined
}
