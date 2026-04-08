import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

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
