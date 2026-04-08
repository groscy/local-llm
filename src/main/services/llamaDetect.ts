import { execFileSync } from 'child_process'
import { existsSync } from 'fs'

/**
 * Returns a usable llama-server path: configured path if it exists, otherwise a binary found on PATH.
 */
export function resolveLlamaBinary(configuredPath: string | undefined): string | undefined {
  const trimmed = typeof configuredPath === 'string' ? configuredPath.trim() : ''
  if (trimmed && existsSync(trimmed)) return trimmed
  return findLlamaServerOnPath()
}

function findLlamaServerOnPath(): string | undefined {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where.exe', ['llama-server'], {
        encoding: 'utf8',
        windowsHide: true
      }).trim()
      const line = out.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim()
      if (line && existsSync(line)) return line
    } else {
      const out = execFileSync('which', ['llama-server'], { encoding: 'utf8' }).trim()
      if (out && existsSync(out)) return out
    }
  } catch {
    /* not on PATH */
  }
  return undefined
}

export function isLlamaServerAvailable(configuredPath: string | undefined): boolean {
  return resolveLlamaBinary(configuredPath) !== undefined
}
