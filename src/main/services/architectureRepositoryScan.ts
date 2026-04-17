import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import type { ArchitectureRepositoryScanResult } from '@shared/architectureRepository'

const MAX_FILES = 12_000
const MAX_DIRS = 6_000
const MAX_DEPTH = 8
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.gradle',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vs',
  'coverage',
  '.next',
  '.nuxt'
])

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.kt',
  '.kts',
  '.java',
  '.py',
  '.go',
  '.rs',
  '.css',
  '.html',
  '.md',
  '.json',
  '.yml',
  '.yaml'
])

const MAX_LINE_SAMPLE_FILES = 400
const MAX_LINE_SAMPLE_BYTES = 48_384

function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, '/').toLowerCase()
}

function isUnderRoot(rootNorm: string, candidate: string): boolean {
  const c = normalizePath(candidate)
  const r = rootNorm
  return c === r || c.startsWith(r.endsWith('/') ? r : `${r}/`)
}

function safeLstat(abs: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(abs)
  } catch {
    return null
  }
}

function sampleLineCount(abs: string, ext: string): number {
  if (!TEXT_EXT.has(ext)) return 0
  try {
    const buf = readFileSync(abs, { encoding: 'utf8', flag: 'r' })
    const slice = buf.slice(0, MAX_LINE_SAMPLE_BYTES)
    let n = 1
    for (let i = 0; i < slice.length; i++) {
      if (slice.charCodeAt(i) === 10) n++
    }
    return n
  } catch {
    return 0
  }
}

function readPackageName(root: string): { hasPackageJson: boolean; packageName?: string } {
  const p = join(root, 'package.json')
  if (!existsSync(p)) return { hasPackageJson: false }
  try {
    const raw = readFileSync(p, 'utf8')
    const j = JSON.parse(raw) as { name?: string }
    return { hasPackageJson: true, packageName: typeof j.name === 'string' ? j.name : undefined }
  } catch {
    return { hasPackageJson: true }
  }
}

function buildHeuristicMermaid(root: string): string | undefined {
  const has = (rel: string) => existsSync(join(root, rel))
  const parts: string[] = ['flowchart TB']
  if (has('src/main')) parts.push('  Main["Main process"]')
  if (has('src/preload')) parts.push('  Preload["Preload bridge"]')
  if (has('src/renderer')) parts.push('  Renderer["Renderer UI"]')
  if (parts.length < 3) return undefined
  if (has('src/renderer') && has('src/preload')) parts.push('  Renderer -->|IPC expose| Preload')
  if (has('src/preload') && has('src/main')) parts.push('  Preload -->|invoke| Main')
  if (has('integrations')) parts.push('  IDE["IDE integration"]')
  if (has('integrations') && has('src/main')) parts.push('  IDE -->|HTTP localhost| Main')
  parts.push(
    '  classDef note fill:transparent,stroke-dasharray:5 5;',
    '  Note["Candidate application communication diagram (heuristic draft)"]:::note'
  )
  return parts.join('\n')
}

export function scanArchitectureRepository(rootRaw: string): ArchitectureRepositoryScanResult {
  const root = resolve(rootRaw.trim())
  const rootNorm = normalizePath(root)
  if (!existsSync(root)) {
    throw new Error('Scan root does not exist')
  }
  const stRoot = safeLstat(root)
  if (!stRoot?.isDirectory()) {
    throw new Error('Scan root is not a directory')
  }

  const extensions: Record<string, number> = {}
  let fileCount = 0
  let directoryCount = 0
  let truncated = false
  let linesSampled = 0
  let lineSamples = 0

  type Q = { dir: string; depth: number }
  const queue: Q[] = [{ dir: root, depth: 0 }]
  const topLevelNames: string[] = []
  try {
    topLevelNames.push(...readdirSync(root).sort((a, b) => a.localeCompare(b)))
  } catch {
    /* ignore */
  }

  const notableRelativePaths: string[] = []
  const pushNotable = (rel: string) => {
    if (notableRelativePaths.length < 40 && !notableRelativePaths.includes(rel)) {
      notableRelativePaths.push(rel)
    }
  }

  while (queue.length > 0) {
    if (fileCount >= MAX_FILES || directoryCount >= MAX_DIRS) {
      truncated = true
      break
    }
    const { dir, depth } = queue.shift()!
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (fileCount >= MAX_FILES || directoryCount >= MAX_DIRS) {
        truncated = true
        break
      }
      if (SKIP_DIR_NAMES.has(name)) continue
      const abs = join(dir, name)
      const lst = safeLstat(abs)
      if (!lst) continue
      if (lst.isSymbolicLink()) continue

      const rel = relative(root, abs).replace(/\\/g, '/')
      if (rel.startsWith('..') || rel === '') continue
      if (!isUnderRoot(rootNorm, abs)) continue

      if (lst.isDirectory()) {
        directoryCount++
        if (name === 'integrations' && depth === 0) {
          pushNotable(rel)
        }
        if (depth < MAX_DEPTH) {
          queue.push({ dir: abs, depth: depth + 1 })
        }
      } else if (lst.isFile()) {
        fileCount++
        const ext = name.includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : ''
        if (ext) {
          extensions[ext] = (extensions[ext] ?? 0) + 1
        }
        if (lineSamples < MAX_LINE_SAMPLE_FILES && ext) {
          const n = sampleLineCount(abs, ext)
          if (n > 0) {
            linesSampled += n
            lineSamples++
          }
        }
        for (const marker of ['src/main', 'src/renderer', 'src/preload', 'integrations/intellij-plugin']) {
          if (rel === marker || rel.startsWith(`${marker}/`)) {
            pushNotable(marker)
            break
          }
        }
      }
    }
  }

  const pkg = readPackageName(root)
  const hasGradleKotlin = existsSync(join(root, 'build.gradle.kts'))
  const hasGradleGroovy = existsSync(join(root, 'build.gradle'))

  const integrationSurfaceDirs: string[] = []
  const intRoot = join(root, 'integrations')
  if (existsSync(intRoot)) {
    try {
      for (const n of readdirSync(intRoot)) {
        const p = join(intRoot, n)
        const st = safeLstat(p)
        if (st?.isDirectory() && !st.isSymbolicLink()) {
          integrationSurfaceDirs.push(`integrations/${n}`)
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    root,
    generatedAt: new Date().toISOString(),
    truncated,
    fileCount,
    directoryCount,
    linesSampled,
    extensions,
    topLevelNames,
    integrationSurfaceDirs: [...new Set(integrationSurfaceDirs)].slice(0, 80),
    manifestHints: {
      hasPackageJson: pkg.hasPackageJson,
      packageName: pkg.packageName,
      hasGradleKotlin,
      hasGradleGroovy
    },
    notableRelativePaths: [...new Set(notableRelativePaths)].sort(),
    candidateHeuristicMermaid: buildHeuristicMermaid(root)
  }
}
