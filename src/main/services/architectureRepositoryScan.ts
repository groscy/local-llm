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
  const links: string[] = []
  let nodeCount = 0
  const addNode = (id: string, label: string, paths: string[]) => {
    if (!paths.some((p) => has(p))) return false
    parts.push(`  ${id}["${label}"]`)
    nodeCount++
    return true
  }

  const hasApps = addNode('Apps', 'Applications (web/mobile/ui)', ['apps', 'app', 'web', 'frontend', 'mobile'])
  const hasServices = addNode('Services', 'Services / APIs', ['services', 'service', 'api', 'apis', 'backend'])
  const hasPackages = addNode('Packages', 'Shared packages / modules', ['packages', 'libs', 'lib', 'modules'])
  const hasData = addNode('DataLayer', 'Data / persistence', ['db', 'database', 'migrations', 'data'])
  const hasInfra = addNode('Infra', 'Infrastructure / deployment', ['infra', 'infrastructure', 'docker', 'k8s', 'helm'])
  const hasIntegrations = addNode('Integrations', 'Integrations / adapters', ['integrations', 'connectors', 'adapters'])
  const hasDocs = addNode('Docs', 'Architecture / docs', ['docs', 'architecture', 'adr'])
  const hasTests = addNode('Tests', 'Verification / tests', ['tests', 'test', '__tests__', 'spec'])
  const hasCi = addNode('CiCd', 'CI / automation', ['.github/workflows', '.gitlab-ci.yml', 'azure-pipelines.yml'])

  if (nodeCount < 2) return undefined

  if (hasApps && hasServices) links.push('  Apps -->|"calls"| Services')
  if (hasApps && hasPackages) links.push('  Apps -->|"imports"| Packages')
  if (hasServices && hasPackages) links.push('  Services -->|"imports"| Packages')
  if (hasServices && hasData) links.push('  Services -->|"persists to"| DataLayer')
  if (hasServices && hasInfra) links.push('  Services -->|"deployed on"| Infra')
  if (hasIntegrations && hasServices) links.push('  Integrations -->|"connects to"| Services')
  if (hasTests && (hasApps || hasServices || hasPackages)) {
    const target = hasServices ? 'Services' : hasApps ? 'Apps' : 'Packages'
    links.push(`  Tests -->|"verifies"| ${target}`)
  }
  if (hasCi && (hasApps || hasServices || hasPackages)) {
    const target = hasServices ? 'Services' : hasApps ? 'Apps' : 'Packages'
    links.push(`  CiCd -->|"builds/tests"| ${target}`)
  }
  if (hasDocs && (hasApps || hasServices || hasPackages)) {
    const target = hasServices ? 'Services' : hasApps ? 'Apps' : 'Packages'
    links.push(`  Docs -->|"documents"| ${target}`)
  }

  if (links.length === 0) return undefined
  parts.push(...links, '  Draft["Candidate communication model (heuristic draft)"]')
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
        for (const marker of [
          'apps',
          'app',
          'services',
          'api',
          'backend',
          'packages',
          'libs',
          'modules',
          'integrations',
          'docs',
          'infra',
          'docker',
          '.github/workflows'
        ]) {
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
