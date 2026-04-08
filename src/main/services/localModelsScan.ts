import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const GGUF_EXT = '.gguf'

function isGgufFile(name: string): boolean {
  return extname(name).toLowerCase() === GGUF_EXT
}

/**
 * Recursively list absolute paths to `.gguf` files under `root` (configured models / download folder).
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
        } else if (e.isFile() && isGgufFile(e.name)) {
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
