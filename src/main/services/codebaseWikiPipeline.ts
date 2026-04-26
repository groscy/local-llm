import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, join, resolve } from 'path'
import { spawnSync } from 'child_process'
import type Database from 'better-sqlite3'
import type Store from 'electron-store'
import * as kbService from './kbService'
import { addManualCodebase, readCodebaseFormalBundle } from './codebaseFormalStore'
import type { RuntimeAdapter } from './runtime/types'
import type {
  CodebaseAnalysisItem,
  CodebaseAnalysisSnapshot,
  CodebaseAnalysisSummary,
  CodebaseWikiAnalysisProgress
} from '@shared/types'

const MAX_SCAN_FILES = 220
const MAX_FILE_BYTES = 80_000
const MAX_TOTAL_BYTES = 1_200_000
const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.go', '.rs',
  '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.md', '.yml', '.yaml', '.json'
])
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.idea', '.vscode', '.next', '.cache'
])

type ScanDoc = { relPath: string; text: string }

function parseMaybeJsonArray(raw: string | undefined): CodebaseAnalysisItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: CodebaseAnalysisItem[] = []
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue
      out.push({
        name,
        summary: typeof o.summary === 'string' ? o.summary.trim() : '',
        confidence:
          typeof o.confidence === 'number' && Number.isFinite(o.confidence)
            ? Math.min(1, Math.max(0, o.confidence))
            : 0.5,
        source:
          o.source === 'llm' || o.source === 'heuristic'
            ? o.source
            : 'llm',
        ...(Array.isArray(o.evidencePaths)
          ? {
              evidencePaths: o.evidencePaths
                .filter((v): v is string => typeof v === 'string')
                .slice(0, 6)
            }
          : {})
      })
      if (out.length >= 30) break
    }
    return out
  } catch {
    return []
  }
}

function normalizeList(items: CodebaseAnalysisItem[], source: 'heuristic' | 'llm'): CodebaseAnalysisItem[] {
  const seen = new Set<string>()
  const out: CodebaseAnalysisItem[] = []
  for (const it of items) {
    const name = it.name.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      summary: it.summary.trim() || `${name} appears in this codebase.`,
      confidence: Math.min(1, Math.max(0, it.confidence)),
      source,
      evidencePaths: it.evidencePaths?.slice(0, 6)
    })
    if (out.length >= 30) break
  }
  return out
}

function scanCodebase(rootPath: string): ScanDoc[] {
  const docs: ScanDoc[] = []
  const stack = [rootPath]
  let totalBytes = 0
  while (stack.length > 0 && docs.length < MAX_SCAN_FILES && totalBytes < MAX_TOTAL_BYTES) {
    const cur = stack.pop()!
    let entries: Array<import('fs').Dirent<string>>
    try {
      entries = readdirSync(cur, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (docs.length >= MAX_SCAN_FILES || totalBytes >= MAX_TOTAL_BYTES) break
      const full = join(cur, ent.name)
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase())) continue
        stack.push(full)
        continue
      }
      if (!ent.isFile()) continue
      const ext = ent.name.slice(ent.name.lastIndexOf('.')).toLowerCase()
      if (!CODE_EXT.has(ext)) continue
      try {
        const st = statSync(full)
        if (st.size <= 0 || st.size > MAX_FILE_BYTES) continue
        const relPath = full.slice(rootPath.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
        const text = readFileSync(full, 'utf8').slice(0, 8000)
        docs.push({ relPath, text })
        totalBytes += st.size
      } catch {
        continue
      }
    }
  }
  return docs
}

function heuristicExtract(docs: ScanDoc[]): {
  domainModel: CodebaseAnalysisItem[]
  designPatterns: CodebaseAnalysisItem[]
  architecturePatterns: CodebaseAnalysisItem[]
} {
  const domainMap = new Map<string, CodebaseAnalysisItem>()
  const designMap = new Map<string, CodebaseAnalysisItem>()
  const archMap = new Map<string, CodebaseAnalysisItem>()
  const upsert = (
    m: Map<string, CodebaseAnalysisItem>,
    name: string,
    summary: string,
    confidence: number,
    evidencePath: string
  ): void => {
    const key = name.toLowerCase()
    const cur = m.get(key)
    if (!cur) {
      m.set(key, { name, summary, confidence, source: 'heuristic', evidencePaths: [evidencePath] })
      return
    }
    const nextPaths = [...(cur.evidencePaths ?? []), evidencePath].slice(0, 6)
    m.set(key, { ...cur, confidence: Math.max(cur.confidence, confidence), evidencePaths: nextPaths })
  }

  const classLike = /\b(?:class|interface|type|enum)\s+([A-Z][A-Za-z0-9_]{2,})/g
  for (const d of docs) {
    const lowerPath = d.relPath.toLowerCase()
    if (/(entity|model|domain|schema|aggregate|dto)/.test(lowerPath)) {
      const b = basename(d.relPath).replace(/\.[^.]+$/, '')
      upsert(domainMap, b, `Domain element appears in ${d.relPath}.`, 0.58, d.relPath)
    }
    let m: RegExpExecArray | null
    while ((m = classLike.exec(d.text)) !== null) {
      const n = m[1]!
      if (/(Dto|Entity|Model|Aggregate|Value|Repository|Service)$/.test(n)) {
        upsert(domainMap, n, `Type ${n} appears in ${d.relPath}.`, 0.52, d.relPath)
      }
    }

    const body = d.text.toLowerCase()
    if (/\brepository\b/.test(body)) upsert(designMap, 'Repository', 'Repository abstraction appears in source.', 0.66, d.relPath)
    if (/\bfactory\b/.test(body) || /\bcreate[A-Z]\w+/.test(d.text)) upsert(designMap, 'Factory', 'Factory-style object creation appears in source.', 0.6, d.relPath)
    if (/\bobserver\b|\bevent(emitter|listener)?\b/.test(body)) upsert(designMap, 'Observer', 'Observer/event-listener behavior appears in source.', 0.58, d.relPath)
    if (/\bstrategy\b/.test(body)) upsert(designMap, 'Strategy', 'Strategy pattern markers appear in source.', 0.55, d.relPath)
    if (/\bsingleton\b/.test(body)) upsert(designMap, 'Singleton', 'Singleton marker appears in source.', 0.5, d.relPath)

    if (/(controller|service|repository|domain|infrastructure|infra)\//.test(lowerPath)) {
      upsert(archMap, 'Layered Architecture', 'Folder structure suggests layered boundaries.', 0.6, d.relPath)
    }
    if (/hexagonal|ports?|adapters?/.test(lowerPath + '\n' + body)) {
      upsert(archMap, 'Hexagonal Architecture', 'Port/adapter terminology appears in source.', 0.58, d.relPath)
    }
    if (/event[-_ ]driven|eventbus|pubsub|message broker/.test(lowerPath + '\n' + body)) {
      upsert(archMap, 'Event-Driven Architecture', 'Event bus/pub-sub markers appear in source.', 0.57, d.relPath)
    }
    if (/microservice|service[-_]mesh|gateway/.test(lowerPath + '\n' + body)) {
      upsert(archMap, 'Microservices', 'Service boundary markers appear in source.', 0.53, d.relPath)
    }
  }
  return {
    domainModel: [...domainMap.values()].slice(0, 24),
    designPatterns: [...designMap.values()].slice(0, 24),
    architecturePatterns: [...archMap.values()].slice(0, 24)
  }
}

function buildSummaryMarkdown(
  rootPath: string,
  docs: ScanDoc[],
  domainModel: CodebaseAnalysisItem[],
  designPatterns: CodebaseAnalysisItem[],
  architecturePatterns: CodebaseAnalysisItem[]
): string {
  const list = (items: CodebaseAnalysisItem[]) =>
    items.length === 0
      ? '- No high-confidence matches found in this pass.'
      : items
          .slice(0, 12)
          .map((x) => `- **${x.name}** (${Math.round(x.confidence * 100)}%): ${x.summary}`)
          .join('\n')
  return [
    '# Codebase analysis',
    '',
    `- Root: \`${rootPath}\``,
    `- Files sampled: ${docs.length}`,
    '',
    '## Domain model',
    list(domainModel),
    '',
    '## Applied design patterns',
    list(designPatterns),
    '',
    '## Architecture patterns',
    list(architecturePatterns),
    ''
  ].join('\n')
}

function buildFacetMarkdown(
  title: string,
  rootPath: string,
  items: CodebaseAnalysisItem[]
): string {
  const lines =
    items.length === 0
      ? ['- No high-confidence matches found in this pass.']
      : items.slice(0, 24).map((x) => `- **${x.name}** (${Math.round(x.confidence * 100)}%): ${x.summary}`)
  return [
    `# ${title}`,
    '',
    `- Root: \`${rootPath}\``,
    `- Entries: ${items.length}`,
    '',
    ...lines,
    ''
  ].join('\n')
}

async function llmRefine(
  runtime: RuntimeAdapter | null,
  rootPath: string,
  docs: ScanDoc[],
  heuristic: ReturnType<typeof heuristicExtract>
): Promise<Partial<Pick<CodebaseAnalysisSnapshot, 'domainModel' | 'designPatterns' | 'architecturePatterns'>>> {
  if (!runtime?.getStatus().running) return {}
  const sample = docs.slice(0, 40).map((d) => ({
    path: d.relPath,
    snippet: d.text.slice(0, 500)
  }))
  const prompt = [
    'Return strict JSON only with keys: domainModel, designPatterns, architecturePatterns.',
    'Each item must be {name, summary, confidence, evidencePaths, source}. source must be "llm".',
    `Root path: ${rootPath}`,
    `Heuristic seed: ${JSON.stringify(heuristic).slice(0, 6000)}`,
    `Source samples: ${JSON.stringify(sample).slice(0, 10000)}`
  ].join('\n')
  try {
    const raw = await runtime.chat(
      [
        { role: 'system', content: 'You are a strict JSON extractor for software architecture metadata.' },
        { role: 'user', content: prompt }
      ],
      { maxTokens: 1500, temperature: 0.2, topP: 0.9, skipDefaultAntiSelfPromptStops: true }
    )
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    const body = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw
    const obj = JSON.parse(body) as Record<string, unknown>
    return {
      domainModel: parseMaybeJsonArray(JSON.stringify(obj.domainModel ?? [])),
      designPatterns: parseMaybeJsonArray(JSON.stringify(obj.designPatterns ?? [])),
      architecturePatterns: parseMaybeJsonArray(JSON.stringify(obj.architecturePatterns ?? []))
    }
  } catch {
    return {}
  }
}

function latestByCodebase(db: Database.Database): CodebaseAnalysisSummary[] {
  const rows = db
    .prepare(
      `SELECT r.codebase_id as codebaseId, r.root_path as rootPath, r.created_at as createdAt,
              r.domain_model_json as domainModelJson, r.design_patterns_json as designPatternsJson,
              r.architecture_patterns_json as architecturePatternsJson
       FROM codebase_analysis_runs r
       JOIN (
         SELECT codebase_id, MAX(created_at) as maxCreated
         FROM codebase_analysis_runs
         GROUP BY codebase_id
       ) latest
       ON latest.codebase_id = r.codebase_id AND latest.maxCreated = r.created_at
       ORDER BY r.created_at DESC`
    )
    .all() as {
    codebaseId: string
    rootPath: string
    createdAt: number
    domainModelJson: string
    designPatternsJson: string
    architecturePatternsJson: string
  }[]
  return rows.map((r) => ({
    codebaseId: r.codebaseId,
    rootPath: r.rootPath,
    createdAt: r.createdAt,
    domainModelCount: parseMaybeJsonArray(r.domainModelJson).length,
    designPatternCount: parseMaybeJsonArray(r.designPatternsJson).length,
    architecturePatternCount: parseMaybeJsonArray(r.architecturePatternsJson).length
  }))
}

export function listLatestCodebaseAnalysisSummaries(db: Database.Database): CodebaseAnalysisSummary[] {
  return latestByCodebase(db)
}

export function listLatestCodebaseAnalysisSnapshots(db: Database.Database): CodebaseAnalysisSnapshot[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.codebase_id as codebaseId, r.root_path as rootPath, r.git_url as gitUrl,
              r.kb_source_id as kbSourceId, r.summary_markdown as summaryMarkdown,
              r.domain_model_json as domainModelJson, r.design_patterns_json as designPatternsJson,
              r.architecture_patterns_json as architecturePatternsJson, r.created_at as createdAt
       FROM codebase_analysis_runs r
       JOIN (
         SELECT codebase_id, MAX(created_at) as maxCreated
         FROM codebase_analysis_runs
         GROUP BY codebase_id
       ) latest
       ON latest.codebase_id = r.codebase_id AND latest.maxCreated = r.created_at
       ORDER BY r.created_at DESC`
    )
    .all() as Array<{
    id: string
    codebaseId: string
    rootPath: string
    gitUrl: string | null
    kbSourceId: string | null
    summaryMarkdown: string
    domainModelJson: string
    designPatternsJson: string
    architecturePatternsJson: string
    createdAt: number
  }>
  return rows.map((r) => ({
    ...(() => {
      const facets = db
        .prepare(
          `SELECT facet, source_id as sourceId
           FROM codebase_analysis_sources
           WHERE run_id = ?`
        )
        .all(r.id) as Array<{ facet: string; sourceId: string }>
      const wikiSourceIds: CodebaseAnalysisSnapshot['wikiSourceIds'] = { overview: r.kbSourceId ?? undefined }
      for (const f of facets) {
        if (f.facet === 'domain_model') wikiSourceIds.domainModel = f.sourceId
        if (f.facet === 'design_pattern') wikiSourceIds.designPatterns = f.sourceId
        if (f.facet === 'architecture_pattern') wikiSourceIds.architecturePatterns = f.sourceId
      }
      return { wikiSourceIds }
    })(),
    id: r.id,
    codebaseId: r.codebaseId,
    rootPath: r.rootPath,
    gitUrl: r.gitUrl,
    kbSourceId: r.kbSourceId,
    summaryMarkdown: r.summaryMarkdown,
    domainModel: parseMaybeJsonArray(r.domainModelJson),
    designPatterns: parseMaybeJsonArray(r.designPatternsJson),
    architecturePatterns: parseMaybeJsonArray(r.architecturePatternsJson),
    createdAt: r.createdAt
  }))
}

export function slugFromGitUrl(gitUrl: string): string {
  const stem = gitUrl
    .trim()
    .replace(/\.git$/i, '')
    .split(/[/:]/)
    .filter(Boolean)
    .slice(-2)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
  return stem || 'repository'
}

export function addCodebaseFromGitUrl(args: {
  store: Store<Record<string, unknown>>
  userData: string
  gitUrl: string
  displayName?: string
}): { ok: true; recordId: string; rootPath: string } | { ok: false; error: string } {
  const gitUrl = args.gitUrl.trim()
  if (!/^https?:\/\/|^git@/i.test(gitUrl)) return { ok: false, error: 'Provide a valid git URL.' }
  const cloneRoot = join(args.userData, 'codebase-clones')
  try {
    if (!existsSync(cloneRoot)) mkdirSync(cloneRoot, { recursive: true })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const folder = `${Date.now()}-${slugFromGitUrl(gitUrl)}`
  const target = join(cloneRoot, folder)
  const r = spawnSync('git', ['clone', '--depth', '1', gitUrl, target], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || 'git clone failed').toString().trim()
    return { ok: false, error: msg.slice(0, 500) }
  }
  const rec = addManualCodebase(args.store, target, args.displayName)
  if (!rec) return { ok: false, error: 'Cloned, but codebase registration failed.' }
  return { ok: true, recordId: rec.id, rootPath: rec.rootPath }
}

export async function runCodebaseWikiAnalysis(args: {
  db: Database.Database
  store: Store<Record<string, unknown>>
  getRuntime: () => RuntimeAdapter | null
  codebaseId: string
  onProgress?: (p: CodebaseWikiAnalysisProgress) => void
}): Promise<CodebaseAnalysisSnapshot> {
  const emit = (p: CodebaseWikiAnalysisProgress): void => args.onProgress?.(p)
  emit({ phase: 'start', message: 'Preparing codebase analysis request.' })
  const bundle = readCodebaseFormalBundle(args.store)
  const codebase = bundle.codebases.find((c) => c.id === args.codebaseId)
  if (!codebase) throw new Error('Codebase not found.')
  const rootPath = resolve(codebase.rootPath)
  if (!existsSync(rootPath)) throw new Error('Codebase path does not exist.')
  emit({
    phase: 'start',
    message: `Using codebase root: ${rootPath}`
  })

  emit({ phase: 'scan', message: 'Walking codebase files and sampling source text.', filesScanned: 0 })
  const docs = scanCodebase(rootPath)
  emit({
    phase: 'scan',
    message: `Scanned ${docs.length} files. Running deterministic extraction heuristics.`,
    filesScanned: docs.length
  })
  const heur = heuristicExtract(docs)
  emit({
    phase: 'scan',
    message: `Heuristic extraction complete: ${heur.domainModel.length} domain, ${heur.designPatterns.length} design, ${heur.architecturePatterns.length} architecture candidates.`,
    filesScanned: docs.length
  })
  emit({ phase: 'llm', message: 'Refining extraction with local model (if running).' })
  const llm = await llmRefine(args.getRuntime(), rootPath, docs, heur)

  const domainModel = normalizeList((llm.domainModel ?? []).length ? llm.domainModel ?? [] : heur.domainModel, (llm.domainModel ?? []).length ? 'llm' : 'heuristic')
  const designPatterns = normalizeList((llm.designPatterns ?? []).length ? llm.designPatterns ?? [] : heur.designPatterns, (llm.designPatterns ?? []).length ? 'llm' : 'heuristic')
  const architecturePatterns = normalizeList((llm.architecturePatterns ?? []).length ? llm.architecturePatterns ?? [] : heur.architecturePatterns, (llm.architecturePatterns ?? []).length ? 'llm' : 'heuristic')
  emit({
    phase: 'llm',
    message: `Final extraction: ${domainModel.length} domain items, ${designPatterns.length} design patterns, ${architecturePatterns.length} architecture patterns.`
  })

  const summaryMarkdown = buildSummaryMarkdown(rootPath, docs, domainModel, designPatterns, architecturePatterns)
  emit({ phase: 'persist', message: 'Persisting analysis and ingesting wiki entries.' })
  const createdAt = Date.now()
  const source = kbService.ingestText(
    args.db,
    `Codebase analysis: ${codebase.displayName || basename(rootPath)}`,
    `codebase-analysis:${codebase.id}:${createdAt}`,
    summaryMarkdown
  )
  emit({ phase: 'persist', message: `Created overview wiki entry (${source.id.slice(0, 8)}).` })
  const domainSource = kbService.ingestText(
    args.db,
    `Domain model: ${codebase.displayName || basename(rootPath)}`,
    `codebase-analysis:${codebase.id}:${createdAt}:domain-model`,
    buildFacetMarkdown('Domain model', rootPath, domainModel)
  )
  emit({ phase: 'persist', message: `Created domain-model wiki entry (${domainSource.id.slice(0, 8)}).` })
  const designSource = kbService.ingestText(
    args.db,
    `Design patterns: ${codebase.displayName || basename(rootPath)}`,
    `codebase-analysis:${codebase.id}:${createdAt}:design-patterns`,
    buildFacetMarkdown('Applied design patterns', rootPath, designPatterns)
  )
  emit({ phase: 'persist', message: `Created design-patterns wiki entry (${designSource.id.slice(0, 8)}).` })
  const architectureSource = kbService.ingestText(
    args.db,
    `Architecture patterns: ${codebase.displayName || basename(rootPath)}`,
    `codebase-analysis:${codebase.id}:${createdAt}:architecture-patterns`,
    buildFacetMarkdown('Architecture patterns', rootPath, architecturePatterns)
  )
  emit({ phase: 'persist', message: `Created architecture-patterns wiki entry (${architectureSource.id.slice(0, 8)}).` })
  const id = randomUUID()
  const tx = args.db.transaction(() => {
    args.db
      .prepare(
        `INSERT INTO codebase_analysis_runs (
          id, codebase_id, root_path, git_url, kb_source_id, summary_markdown,
          domain_model_json, design_patterns_json, architecture_patterns_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        codebase.id,
        rootPath,
        null,
        source.id,
        summaryMarkdown,
        JSON.stringify(domainModel),
        JSON.stringify(designPatterns),
        JSON.stringify(architecturePatterns),
        createdAt
      )
    const mapInsert = args.db.prepare(
      `INSERT OR REPLACE INTO codebase_analysis_sources (run_id, facet, source_id) VALUES (?, ?, ?)`
    )
    mapInsert.run(id, 'domain_model', domainSource.id)
    mapInsert.run(id, 'design_pattern', designSource.id)
    mapInsert.run(id, 'architecture_pattern', architectureSource.id)
  })
  tx()
  const snapshot: CodebaseAnalysisSnapshot = {
    id,
    codebaseId: codebase.id,
    rootPath,
    gitUrl: null,
    kbSourceId: source.id,
    wikiSourceIds: {
      overview: source.id,
      domainModel: domainSource.id,
      designPatterns: designSource.id,
      architecturePatterns: architectureSource.id
    },
    summaryMarkdown,
    domainModel,
    designPatterns,
    architecturePatterns,
    createdAt
  }
  emit({
    phase: 'done',
    message: `Done. Stored analysis run and linked 4 wiki entries (overview + 3 facets).`,
    snapshot
  })
  return snapshot
}
