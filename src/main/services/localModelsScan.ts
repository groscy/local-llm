import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const WEIGHT_EXTS = new Set(['.gguf', '.safetensors', '.safetensor'])

function isLocalWeightFile(name: string): boolean {
  return WEIGHT_EXTS.has(extname(name).toLowerCase())
}

/**
 * Recursively list absolute paths to loadable weight files (`.gguf`, `.safetensors`, `.safetensor`)
 * under `root` (configured models / download folder).
 */
export function listGgufModelsInDir(
  root: string,
  opts?: { maxFiles?: number; maxDepth?: number }
): string[] {
  const maxFiles = opts?.maxFiles ?? 500
  const maxDepth = opts?.maxDepth ?? 16
  const out: string[] = []

  const walk = (dir: string, depth: number): void => {
    if (out.length >= maxFiles || depth > maxDepth) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent[]
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return
      if (e.name === '.' || e.name === '..') continue
      const p = join(dir, e.name)
      try {
        if (e.isDirectory()) {
          walk(p, depth + 1)
        } else if (e.isFile() && isLocalWeightFile(e.name)) {
          out.push(p)
        }
      } catch {
        /* skip unreadable */
      }
    }
  }

  if (!existsSync(root)) return []
  try {
    if (!statSync(root).isDirectory()) return []
  } catch {
    return []
  }
  walk(root, 0)
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()
  out.sort((a, b) => norm(a).localeCompare(norm(b)))
  return out
}
