import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { finished } from 'stream/promises'
import { resolve } from 'path'
import archiver from 'archiver'
import type Database from 'better-sqlite3'
import { parseDocumentFromFile, type ParsedDocumentSection } from './documentParser'
import { composeWikiReadModel } from './wikiComposer'
import { parseWikiDocumentSummaryResponse, runWikiExtractDocument } from './wikiExtractService'
import { analyzeSourceDomains } from './domainAnalysisService'
import { retrieveChunks, retrieveKbHits } from './retrievalService'
import { runArticleCleanup, type ArticleCleanupProgress } from './articleCleanupService'
import { createOntologyService } from './ontologyService'
import { createGraphWriteService, type GraphWriteService } from './graphWriteService'
import { createIngestOrchestrator, type IngestOrchestrator } from './ingestOrchestrator'
import { fromFileSource, fromTextSource } from './sourceAdapters'
import { runDocumentImportBenchmark, type ImportBenchmarkSummary } from './documentImportBenchmark'
import {
  clearProjection,
  removeKnowledgeGraphProjectionBySource,
  rebuildKnowledgeGraphProjection,
  rebuildSemanticGraphProjection,
  readProjectedKnowledgeGraph,
  readProjectedSemanticGraph,
  upsertKnowledgeGraphProjectionSlice
} from './graphProjectionService'
import type { RuntimeAdapter } from './runtime/types'
import { extractWikiGlossary, stripWikiControlMarkers, WIKI_REFERENCE_SECTION_MARKDOWN } from '@shared/wikiArticleExtras'
import { wikiKindFromUri } from '@shared/wikiSourceGroups'
import type {
  CodebaseAnalysisItem,
  KbChunk,
  KbDocumentRecord,
  KbImportDiagnostic,
  KbImportConfidence,
  KbIngestFileProgress,
  KbIngestJobSummary,
  KbDomainOption,
  KbSourceDomainUpdateResult,
  KbSearchHit,
  KbSource,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphPayload,
  SemanticContextScope,
  SemanticDescriptor,
  SemanticEntityNode,
  SemanticKnowledgeGraphPayload,
  SemanticRelationEdge,
  SemanticScopeIntersection,
  EvidenceTrace,
  WikiChatHighlightTerm,
  WikiExtractArticleRequest,
  WikiExtractArticleResult,
  WikiArticleCleanupResult,
  WikiKeywordCandidate,
  WikiPageMetadata,
  WikiPassageSummary,
  WikiPagePayload,
  WikiRawReferencePayload,
  WikiReanalyzeResult,
  WikiRelatedSource,
  WikiTermResolutionResult,
  WikiSourceKind,
  WikiTopic
} from '@shared/types'
import type { OntologyService } from './ontologyService'

const CHUNK_SIZE = 1200
const CHUNK_OVERLAP = 200
const WIKI_REANALYZE_PROMPT_VERSION = '2026-04-20.v1'

type WikiEntryActiveRevisionRow = {
  entryId: string
  canonicalKeyword: string
  activeRevisionId: string
  updatedAt: number
  revisionId: string
  versionNo: number
  title: string
  body: string
  modelId: string | null
  promptVersion: string | null
  sourceIdsJson: string
  createdAt: number
}

type WikiEntryKeywordRelation = {
  id: string
  fromEntryId: string
  toEntryId: string | null
  toKeyword: string
  relationType: string
  confidence: number
  sourceRevisionId: string
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | undefined
  return Boolean(row?.ok)
}

function shadowModeEnabled(): boolean {
  return process.env.KB_IMPORT_SHADOW_MODE === '1'
}

function persistShadowRun(
  db: Database.Database,
  sourceId: string,
  diagnostics: KbImportDiagnostic,
  confidence: KbImportConfidence
): void {
  if (!shadowModeEnabled()) return
  if (!tableExists(db, 'kb_import_shadow_runs')) return
  const now = Date.now()
  db.prepare(
    `INSERT INTO kb_import_shadow_runs
      (id, source_id, parser_mode, extraction_version, metrics_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    sourceId,
    diagnostics.parserMode ?? 'unknown',
    diagnostics.extractionVersion ?? 'v1',
    JSON.stringify({
      parserWarnings: diagnostics.parserWarnings,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      ocrApplied: diagnostics.ocrApplied === true,
      ocrCoverage: diagnostics.ocrCoverage ?? null,
      qualityFlags: diagnostics.qualityFlags ?? []
    }),
    now
  )
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function hasWikiEntryTables(db: Database.Database): boolean {
  return (
    tableExists(db, 'wiki_entries') &&
    tableExists(db, 'wiki_entry_revisions') &&
    tableExists(db, 'wiki_entry_sources') &&
    tableExists(db, 'wiki_keyword_relations')
  )
}

function canonicalizeFilePathForLookup(pathLike: string): string {
  const raw = pathLike.replace(/^file:\/\//i, '')
  let resolved = raw
  try {
    resolved = resolve(raw)
  } catch {
    resolved = raw
  }
  const normalized = resolved.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function findExistingFileSource(db: Database.Database, filePath: string): KbSource | undefined {
  const target = canonicalizeFilePathForLookup(filePath)
  const rows = db
    .prepare(
      `SELECT id, title, uri, created_at as createdAt, conversation_id as conversationId
       FROM kb_sources
       WHERE uri LIKE 'file://%'`
    )
    .all() as KbSource[]
  return rows.find((row) => canonicalizeFilePathForLookup(row.uri) === target)
}

function upsertIngestJob(
  db: Database.Database,
  args: {
    jobId: string
    filePath: string
    title: string
    stage: 'selected' | 'extracting' | 'normalizing' | 'enriching' | 'indexing' | 'done' | 'failed'
    status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
    sourceId?: string | null
    errorMessage?: string | null
  }
): void {
  if (!tableExists(db, 'kb_ingest_jobs')) return
  const now = Date.now()
  db.prepare(
    `INSERT INTO kb_ingest_jobs
      (id, source_id, file_path, title, stage, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_id = COALESCE(excluded.source_id, kb_ingest_jobs.source_id),
       title = excluded.title,
       stage = excluded.stage,
       status = excluded.status,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at`
  ).run(
    args.jobId,
    args.sourceId ?? null,
    args.filePath,
    args.title,
    args.stage,
    args.status,
    args.errorMessage ?? null,
    now,
    now
  )
}

export function listIngestJobs(db: Database.Database, limit = 40): KbIngestJobSummary[] {
  if (!tableExists(db, 'kb_ingest_jobs')) return []
  return db
    .prepare(
      `SELECT id, source_id as sourceId, file_path as filePath, title, stage, status, error_message as errorMessage,
              created_at as createdAt, updated_at as updatedAt
       FROM kb_ingest_jobs
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(Math.max(1, Math.min(limit, 400))) as KbIngestJobSummary[]
}

export function listKnowledgeDomains(db: Database.Database, limit = 120): KbDomainOption[] {
  if (!tableExists(db, 'kb_domains')) return []
  return db
    .prepare(
      `SELECT id, slug, title, source_count as sourceCount
       FROM kb_domains
       ORDER BY source_count DESC, updated_at DESC
       LIMIT ?`
    )
    .all(Math.max(1, Math.min(limit, 500))) as KbDomainOption[]
}

export function setSourceDomain(
  db: Database.Database,
  args: { sourceId: string; domainTitle: string }
): KbSourceDomainUpdateResult {
  if (!tableExists(db, 'kb_domain_membership') || !tableExists(db, 'kb_domains')) {
    throw new Error('Domain tables are unavailable. Restart after migrations are applied.')
  }
  const sourceId = args.sourceId.trim()
  const domainTitle = args.domainTitle.replace(/\s+/g, ' ').trim()
  if (!sourceId) throw new Error('sourceId is required')
  if (!domainTitle) throw new Error('domainTitle is required')
  const src = db.prepare('SELECT id FROM kb_sources WHERE id = ? LIMIT 1').get(sourceId) as { id: string } | undefined
  if (!src) throw new Error('source not found')
  const slug = slugifyDomainTitle(domainTitle) || 'general-domain'
  const now = Date.now()
  const tx = db.transaction(() => {
    const previous = db
      .prepare('SELECT domain_id as domainId FROM kb_domain_membership WHERE source_id = ?')
      .all(sourceId) as Array<{ domainId: string }>
    const existing = db
      .prepare('SELECT id, title FROM kb_domains WHERE slug = ? LIMIT 1')
      .get(slug) as { id: string; title: string } | undefined
    const domainId = existing?.id ?? randomUUID()
    db.prepare(
      `INSERT INTO kb_domains (id, slug, title, summary, confidence, centroid_terms_json, source_count, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at`
    ).run(
      domainId,
      slug,
      domainTitle,
      `Manually assigned domain: ${domainTitle}`,
      0.92,
      JSON.stringify([]),
      0,
      now,
      now
    )
    db.prepare('DELETE FROM kb_domain_membership WHERE source_id = ?').run(sourceId)
    db.prepare(
      `INSERT INTO kb_domain_membership (source_id, domain_id, confidence, rationale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sourceId, domainId, 0.98, 'Manual domain assignment by user.', now, now)
    const affected = new Set<string>([domainId, ...previous.map((p) => p.domainId)])
    const refreshCount = db.prepare(
      `UPDATE kb_domains
       SET source_count = (SELECT COUNT(*) FROM kb_domain_membership WHERE domain_id = kb_domains.id),
           updated_at = ?
       WHERE id = ?`
    )
    for (const id of affected) refreshCount.run(now, id)
    return { domainId, domainTitle }
  })
  const out = tx()
  return {
    ok: true,
    sourceId,
    domainId: out.domainId,
    domainTitle: out.domainTitle
  }
}

export function normalizeWikiKeyword(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugifyDomainTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
}

function titleCaseKeyword(keyword: string): string {
  const cleaned = keyword.trim()
  if (!cleaned) return 'Untitled'
  return cleaned
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
}

function readSourceIdsJson(raw: string): string[] {
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  } catch {
    return []
  }
}

function listActiveWikiEntryRows(db: Database.Database): WikiEntryActiveRevisionRow[] {
  if (!hasWikiEntryTables(db)) return []
  return db
    .prepare(
      `SELECT e.id as entryId,
              e.canonical_keyword as canonicalKeyword,
              e.active_revision_id as activeRevisionId,
              e.updated_at as updatedAt,
              r.id as revisionId,
              r.version_no as versionNo,
              r.title as title,
              r.body as body,
              r.model_id as modelId,
              r.prompt_version as promptVersion,
              r.source_ids_json as sourceIdsJson,
              r.created_at as createdAt
       FROM wiki_entries e
       JOIN wiki_entry_revisions r ON r.id = e.active_revision_id
       ORDER BY e.updated_at DESC`
    )
    .all() as WikiEntryActiveRevisionRow[]
}

function resolveActiveWikiEntryForSource(
  db: Database.Database,
  sourceId: string
): WikiEntryActiveRevisionRow | undefined {
  if (!hasWikiEntryTables(db)) return undefined
  return db
    .prepare(
      `SELECT e.id as entryId,
              e.canonical_keyword as canonicalKeyword,
              e.active_revision_id as activeRevisionId,
              e.updated_at as updatedAt,
              r.id as revisionId,
              r.version_no as versionNo,
              r.title as title,
              r.body as body,
              r.model_id as modelId,
              r.prompt_version as promptVersion,
              r.source_ids_json as sourceIdsJson,
              r.created_at as createdAt
       FROM wiki_entry_sources es
       JOIN wiki_entries e ON e.id = es.entry_id
       JOIN wiki_entry_revisions r ON r.id = e.active_revision_id
       WHERE es.source_id = ?
       LIMIT 1`
    )
    .get(sourceId) as WikiEntryActiveRevisionRow | undefined
}

type StructuredSectionInput = {
  heading?: string
  body: string
  pageStart?: number
  pageEnd?: number
}

type ChunkDraft = {
  text: string
  heading?: string
  anchor: string
  passageTitle: string
  pageStart?: number
  pageEnd?: number
}
type IngestDocumentInput = {
  title: string
  uri: string
  filePath?: string
  sourceRawText?: string
  rawText: string
  canonicalSummaryBody?: string
  source: 'pdf' | 'text'
  diagnostics?: Partial<KbImportDiagnostic>
  cleanupMode?: 'llm' | 'heuristic'
  cleanupPromptVersion?: string
  cleanupFallbackReason?: string
  heading?: string
  structuredSections?: StructuredSectionInput[]
  conversationId?: string | null
  runtime?: RuntimeAdapter | null
  onProgress?: (payload: KbIngestFileProgress) => void
}

function inferSemanticSourceType(input: Pick<IngestDocumentInput, 'source' | 'uri'>): 'pdf' | 'text' | 'codebase' {
  if (input.source === 'pdf') return 'pdf'
  const uri = input.uri.trim().toLowerCase()
  if (uri.startsWith('codebase-analysis:')) return 'codebase'
  return 'text'
}

const ontologyByDb = new WeakMap<Database.Database, OntologyService>()
const writerByDb = new WeakMap<Database.Database, GraphWriteService>()
const orchestratorByDb = new WeakMap<Database.Database, IngestOrchestrator>()

function getOntologySingleton(db: Database.Database): OntologyService {
  const existing = ontologyByDb.get(db)
  if (existing) return existing
  const created = createOntologyService(db)
  ontologyByDb.set(db, created)
  return created
}

function getIngestOrchestrator(db: Database.Database): IngestOrchestrator {
  const existing = orchestratorByDb.get(db)
  if (existing) return existing
  const writer =
    writerByDb.get(db) ??
    (() => {
      const createdWriter = createGraphWriteService({ db, ontology: getOntologySingleton(db) })
      writerByDb.set(db, createdWriter)
      return createdWriter
    })()
  const orchestrator = createIngestOrchestrator(writer)
  orchestratorByDb.set(db, orchestrator)
  return orchestrator
}

function rankStructuralPayload(payload: KnowledgeGraphPayload): KnowledgeGraphPayload {
  const degreeByNode = new Map<string, number>()
  for (const edge of payload.edges) {
    degreeByNode.set(edge.from, (degreeByNode.get(edge.from) ?? 0) + 1)
    degreeByNode.set(edge.to, (degreeByNode.get(edge.to) ?? 0) + 1)
  }
  const maxDegree = Math.max(1, ...degreeByNode.values(), 1)
  const nodesRanked = payload.nodes.map((node) => {
    const degree = degreeByNode.get(node.id) ?? 0
    const confidence = typeof node.confidence === 'number' ? node.confidence : 0.56
    const novelty = typeof node.novelty === 'number' ? node.novelty : 0.42
    return {
      ...node,
      degree,
      rank: Number((degree / maxDegree * 0.52 + confidence * 0.3 + novelty * 0.18).toFixed(4)),
      clusterRank: degree
    }
  })
  const edgesRanked = payload.edges.map((edge) => {
    const salience =
      edge.salience ??
      Math.max(
        0.08,
        Math.min(
          1,
          (edge.kind === 'contains'
            ? 0.76
            : edge.kind === 'compiled_from'
              ? 0.69
              : edge.kind === 'indexes'
                ? 0.58
                : 0.4) *
            0.56 +
            (edge.confidence ?? 0.62) * 0.24 +
            (edge.recency ?? 0.55) * 0.2
        )
      )
    const tier: 'strong' | 'mid' | 'faint' = salience >= 0.72 ? 'strong' : salience >= 0.44 ? 'mid' : 'faint'
    return { ...edge, salience, tier }
  })
  return { ...payload, nodes: nodesRanked, edges: edgesRanked }
}

function buildStructuralProjectionSliceForSource(db: Database.Database, sourceId: string): KnowledgeGraphPayload {
  ensureWikiVersioningBackfill(db)
  const source = db
    .prepare('SELECT id, title, uri FROM kb_sources WHERE id = ? LIMIT 1')
    .get(sourceId) as { id: string; title: string; uri: string } | undefined
  if (!source) return { nodes: [], edges: [], truncated: false }
  const sourceDomain = db
    .prepare(
      `SELECT domain_id as domainId
       FROM kb_domain_membership
       WHERE source_id = ?
       ORDER BY confidence DESC
       LIMIT 1`
    )
    .get(sourceId) as { domainId: string } | undefined
  const docConfidence = getDocumentRecord(db, sourceId)?.confidenceScore ?? 0.72
  const nodes: KnowledgeGraphNode[] = [
    {
      id: source.id,
      kind: 'source',
      label: source.title,
      shortLabel: semanticToken(source.title),
      targetSourceId: source.id,
      domainId: sourceDomain?.domainId ?? domainIdFromUri(source.uri),
      confidence: docConfidence,
      novelty: 0.36,
      provenance: 'knowledge-base'
    }
  ]
  const edges: KnowledgeGraphEdge[] = []
  const chunkRows = db
    .prepare(
      `SELECT id, ord, heading, anchor, passage_title as passageTitle
       FROM kb_chunks
       WHERE source_id = ?
       ORDER BY ord ASC
       LIMIT ?`
    )
    .all(sourceId, GRAPH_MAX_CHUNKS_PER_SOURCE + 1) as Array<{
    id: string
    ord: number
    heading: string | null
    anchor: string | null
    passageTitle: string | null
  }>
  const slice = chunkRows.slice(0, GRAPH_MAX_CHUNKS_PER_SOURCE)
  for (const row of slice) {
    const sub =
      (row.passageTitle && row.passageTitle.trim()) || (row.heading && row.heading.trim())
        ? (row.passageTitle || row.heading || '').trim().slice(0, 42) +
          ((row.passageTitle || row.heading || '').trim().length > 42 ? '…' : '')
        : undefined
    nodes.push({
      id: row.id,
      kind: 'chunk',
      label: `#${row.ord + 1}`,
      shortLabel: `c${row.ord + 1}`,
      sublabel: sub,
      sourceId,
      targetSourceId: sourceId,
      sectionOrd: row.ord,
      sectionAnchor: row.anchor ?? undefined,
      domainId: sourceDomain?.domainId ?? domainIdFromUri(source.uri),
      confidence: Math.max(0.3, docConfidence - 0.08),
      novelty: row.heading ? 0.62 : 0.44,
      provenance: 'knowledge-base'
    })
    edges.push({ from: sourceId, to: row.id, kind: 'contains', confidence: 0.92, recency: 0.5 })
  }
  if (chunkRows.length > slice.length) {
    const omitted = chunkRows.length - slice.length
    const overflowId = `kg-overflow:${sourceId}`
    nodes.push({
      id: overflowId,
      kind: 'chunk',
      label: `+${omitted}`,
      shortLabel: `+${omitted}`,
      sublabel: 'chunks not drawn',
      sourceId,
      domainId: sourceDomain?.domainId ?? domainIdFromUri(source.uri),
      confidence: 0.4,
      novelty: 0.2,
      provenance: 'knowledge-base'
    })
    edges.push({ from: sourceId, to: overflowId, kind: 'contains', confidence: 0.82, recency: 0.4 })
  }
  const entryRows = db
    .prepare(
      `SELECT e.id as entryId, r.title as title, r.source_ids_json as sourceIdsJson
       FROM wiki_entry_sources es
       JOIN wiki_entries e ON e.id = es.entry_id
       JOIN wiki_entry_revisions r ON r.id = e.active_revision_id
       WHERE es.source_id = ?`
    )
    .all(sourceId) as Array<{ entryId: string; title: string; sourceIdsJson: string }>
  const chunkIds = new Set(slice.map((c) => c.id))
  for (const entry of entryRows) {
    const wikiNodeId = `wiki-entry:${entry.entryId}`
    nodes.push({
      id: wikiNodeId,
      kind: 'wiki',
      label: entry.title,
      shortLabel: semanticToken(entry.title),
      targetSourceId: sourceId,
      domainId: sourceDomain?.domainId ?? domainIdFromUri(source.uri),
      confidence: 0.82,
      novelty: 0.56,
      provenance: 'knowledge-base'
    })
    const sourceIds = readSourceIdsJson(entry.sourceIdsJson)
    if (sourceIds.includes(sourceId)) edges.push({ from: wikiNodeId, to: sourceId, kind: 'compiled_from', confidence: 0.9, recency: 0.7 })
    for (const chunkId of chunkIds) edges.push({ from: wikiNodeId, to: chunkId, kind: 'indexes', confidence: 0.76, recency: 0.58 })
  }
  if (tableExists(db, 'kb_doc_relations')) {
    const relationRows = db
      .prepare(
        `SELECT from_source_id as fromSourceId, to_source_id as toSourceId, confidence, relation_kind as relationKind
         FROM kb_doc_relations
         WHERE from_source_id = ? OR to_source_id = ?
         ORDER BY confidence DESC
         LIMIT 220`
      )
      .all(sourceId, sourceId) as Array<{ fromSourceId: string; toSourceId: string; confidence: number; relationKind: string }>
    for (const row of relationRows) {
      if (row.fromSourceId === row.toSourceId) continue
      edges.push({
        from: row.fromSourceId,
        to: row.toSourceId,
        kind: row.relationKind === 'semantic_similarity' ? 'semantic_related' : 'related',
        confidence: Math.min(1, Math.max(0.2, Number(row.confidence) || 0.5)),
        recency: 0.58
      })
    }
  }
  return rankStructuralPayload({
    nodes,
    edges,
    truncated: chunkRows.length > slice.length
  })
}

function refreshGraphProjectionsBestEffort(db: Database.Database): void {
  try {
    const structural = buildKnowledgeGraphDynamic(db)
    rebuildKnowledgeGraphProjection(db, structural)
    const semantic = buildSemanticKnowledgeGraphDynamic(db)
    rebuildSemanticGraphProjection(db, semantic)
  } catch {
    // projection refresh should not break core KB operations
  }
}

function refreshGraphProjectionForSourceBestEffort(db: Database.Database, sourceId: string): void {
  try {
    const slice = buildStructuralProjectionSliceForSource(db, sourceId)
    upsertKnowledgeGraphProjectionSlice(db, { sourceId, payload: slice })
    // Semantic projection is invalidated on source updates and rebuilt lazily on next read.
    clearProjection(db, 'semantic')
  } catch {
    refreshGraphProjectionsBestEffort(db)
  }
}

function removeGraphProjectionForSourceBestEffort(db: Database.Database, sourceId: string): void {
  try {
    removeKnowledgeGraphProjectionBySource(db, sourceId)
    clearProjection(db, 'semantic')
  } catch {
    refreshGraphProjectionsBestEffort(db)
  }
}

async function ingestSemanticBestEffort(
  db: Database.Database,
  input: Pick<IngestDocumentInput, 'source' | 'uri' | 'filePath'> & {
    sourceId: string
    text: string
    diagnostics?: Partial<KbImportDiagnostic>
    runtime?: RuntimeAdapter | null
  }
): Promise<void> {
  const text = input.text.trim()
  if (!text) return
  try {
    const canonical =
      input.filePath || inferSemanticSourceType(input) === 'pdf'
        ? fromFileSource({
            title: input.sourceId,
            filePath: input.filePath || input.uri.replace(/^file:\/\//i, ''),
            body: text,
            sourceKind: inferSemanticSourceType(input) === 'pdf' ? 'pdf' : 'text',
            diagnostics: input.diagnostics,
            ingestRunId: `kb-${input.sourceId}-${Date.now()}`
          })
        : fromTextSource({
            title: input.sourceId,
            uri: input.uri || `src:${input.sourceId}`,
            body: text,
            ingestRunId: `kb-${input.sourceId}-${Date.now()}`
          })
    canonical.provenance.sourceType =
      inferSemanticSourceType(input) === 'codebase'
        ? 'codebase'
        : input.filePath || inferSemanticSourceType(input) === 'pdf'
          ? 'file'
          : 'text'
    canonical.provenance.sourceRecordId = input.sourceId
    const orchestrator = getIngestOrchestrator(db)
    await orchestrator.ingestRecord(canonical, { runtime: input.runtime ?? null })
  } catch {
    // Semantic extraction is an additive layer; core KB ingest should still succeed.
  }
}

function splitMarkdownSections(text: string): Array<{ heading?: string; body: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const lines = normalized.split('\n')
  const out: Array<{ heading?: string; body: string }> = []
  let curHeading: string | undefined
  let buf: string[] = []
  const flush = (): void => {
    const body = buf.join('\n').trim()
    if (!body) return
    out.push({ heading: curHeading, body })
    buf = []
  }
  for (const line of lines) {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (h) {
      flush()
      curHeading = h[1]?.trim() || undefined
      continue
    }
    buf.push(line)
  }
  flush()
  return out.length > 0 ? out : [{ body: normalized }]
}

function slugifyAnchor(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return s || 'passage'
}

function summarizePassageTitle(raw: string, fallback?: string): string {
  const base = (fallback?.trim() || raw.replace(/\s+/g, ' ').trim()).trim()
  const words = base.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Untitled passage'
  return words.slice(0, 30).join(' ')
}

function chunkText(text: string, heading?: string, structuredSections?: StructuredSectionInput[]): ChunkDraft[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const sections: Array<{ heading?: string; body: string; pageStart?: number; pageEnd?: number }> =
    structuredSections && structuredSections.length > 0
      ? structuredSections.map((section) => ({
          heading: section.heading,
          body: section.body,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd
        }))
      : heading
        ? [{ heading, body: normalized, pageStart: undefined, pageEnd: undefined }]
        : splitMarkdownSections(normalized).map((section) => ({ ...section, pageStart: undefined, pageEnd: undefined }))
  const parts: ChunkDraft[] = []
  let sectionIdx = 0
  for (const section of sections) {
    let i = 0
    let chunkInSection = 0
    const sectionTitle = summarizePassageTitle(section.body, section.heading)
    while (i < section.body.length) {
      const end = Math.min(i + CHUNK_SIZE, section.body.length)
      const slice = section.body.slice(i, end)
      const hasHeading = Boolean(section.heading?.trim())
      const headingTitle = hasHeading
        ? summarizePassageTitle(
            chunkInSection > 0 ? `${section.heading} part ${chunkInSection + 1}` : String(section.heading)
          )
        : ''
      const passageTitle = hasHeading ? headingTitle : summarizePassageTitle(slice)
      parts.push({
        text: slice,
        heading: section.heading,
        anchor: `${slugifyAnchor(section.heading || sectionTitle || `section-${sectionIdx + 1}`)}-${chunkInSection + 1}`,
        passageTitle,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd
      })
      if (end >= section.body.length) break
      i = end - CHUNK_OVERLAP
      if (i < 0) i = 0
      chunkInSection++
    }
    sectionIdx++
  }
  return parts
}

function normalizeImportedRawText(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function distillDocumentToWikiBody(title: string, rawText: string): string {
  const normalized = normalizeImportedRawText(rawText)
  if (!normalized) return ''
  const keyword = title.replace(/\*/g, "'").trim() || 'Untitled'
  const compact = normalized.replace(/\s+/g, ' ').trim()
  const definition = compact.length > 280 ? `${compact.slice(0, 279)}…` : compact
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
  const practice = paragraphs.slice(0, 4).join('\n\n') || normalized
  const notes = paragraphs.slice(4).join('\n\n') || 'No additional notes were extracted.'
  return [
    '::: glossary',
    `**${keyword}** — ${definition || 'No definition extracted.'}`,
    ':::',
    '',
    '## Practice / Context',
    '',
    practice,
    '',
    '## Related Concepts',
    '',
    '- Derived from imported document text.',
    '',
    '## Notes',
    '',
    notes,
    ''
  ].join('\n')
}

type CanonicalSummaryResult = {
  body: string
  promptVersion: string
  modelId?: string
}

async function summarizeImportedDocument(
  runtime: RuntimeAdapter | null | undefined,
  title: string,
  rawText: string
): Promise<CanonicalSummaryResult | null> {
  if (!runtime) return null
  if (!runtime.getStatus().running) return null
  try {
    const raw = await runWikiExtractDocument(runtime, title, rawText)
    const parsed = parseWikiDocumentSummaryResponse(raw)
    if (!parsed) return null
    return {
      body: parsed.body,
      promptVersion: 'wiki-summary-ingest-2026-05-16.v1',
      modelId: runtime.getStatus().modelPath || runtime.getStatus().kind
    }
  } catch {
    return null
  }
}

function scoreImportConfidence(rawText: string, distilledBody: string, diagnostics: KbImportDiagnostic): KbImportConfidence {
  let score = 0.92
  const reasons: string[] = []
  if (!rawText.trim()) {
    return { score: 0.05, reasons: ['empty_raw_text'] }
  }
  if (!distilledBody.trim()) {
    score -= 0.35
    reasons.push('empty_distilled_body')
  }
  if (diagnostics.truncated) {
    score -= 0.2
    reasons.push('pdf_truncated')
  }
  if (diagnostics.parserWarnings.length > 0) {
    score -= Math.min(0.22, diagnostics.parserWarnings.length * 0.06)
    reasons.push('parser_warnings')
  }
  if (diagnostics.cleanupEdits > 0) {
    score -= Math.min(0.2, diagnostics.cleanupEdits * 0.01)
    reasons.push('cleanup_repairs_applied')
  }
  const controlChars = (rawText.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) ?? []).length
  if (controlChars > 0) {
    score -= Math.min(0.18, controlChars / Math.max(1, rawText.length))
    reasons.push('control_character_noise')
  }
  const brokenTokens = (rawText.match(/[A-Za-z]{1,2}\s+[A-Za-z]{1,2}\s+[A-Za-z]{1,2}/g) ?? []).length
  if (brokenTokens > 0) {
    score -= Math.min(0.16, brokenTokens * 0.01)
    reasons.push('broken_token_sequences')
  }
  if (diagnostics.ocrApplied) {
    score -= diagnostics.ocrCoverage && diagnostics.ocrCoverage >= 0.8 ? 0.06 : 0.12
    reasons.push('ocr_fallback_applied')
  }
  if (diagnostics.qualityFlags?.length) {
    score -= Math.min(0.18, diagnostics.qualityFlags.length * 0.05)
    reasons.push('quality_gate_flags')
  }
  return { score: Number(Math.min(1, Math.max(0.05, score)).toFixed(3)), reasons }
}

function parserTelemetryQualityFlags(diagnostics: Partial<KbImportDiagnostic>): string[] {
  const flags: string[] = []
  const mode = diagnostics.parserMode
  const parserWarnings = diagnostics.parserWarnings ?? []
  const hasOcrMode = mode === 'true_ocr_fallback' || mode === 'hybrid_merged'
  if (hasOcrMode && diagnostics.ocrApplied !== true) flags.push('telemetry_ocr_mode_without_ocr_applied')
  if (!hasOcrMode && diagnostics.ocrApplied === true) flags.push('telemetry_ocr_applied_without_ocr_mode')
  if ((diagnostics.ocrCoverage ?? 0) > 0 && diagnostics.ocrApplied !== true) flags.push('telemetry_ocr_coverage_without_ocr')
  if (mode === 'text_layer' && parserWarnings.includes('pdf_text_layer_low_signal')) {
    flags.push('telemetry_text_mode_low_signal_warning')
  }
  if (!diagnostics.parserEngine || diagnostics.parserEngine.trim().length === 0) flags.push('telemetry_missing_parser_engine')
  return flags
}

function saveDocumentRecord(
  db: Database.Database,
  sourceId: string,
  sourceRawText: string,
  rawText: string,
  distilledBody: string,
  confidence: KbImportConfidence,
  diagnostics: KbImportDiagnostic
): void {
  if (!tableExists(db, 'kb_documents')) return
  const now = Date.now()
  db.prepare(
    `INSERT OR REPLACE INTO kb_documents
       (source_id, raw_source_text, raw_text, distilled_body, confidence_score, confidence_reasons_json, diagnostics_json,
        extraction_version, parser_stage_timings_json, parser_ocr_coverage, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM kb_documents WHERE source_id = ?), ?), ?)`
  ).run(
    sourceId,
    sourceRawText,
    rawText,
    distilledBody,
    confidence.score,
    JSON.stringify(confidence.reasons),
    JSON.stringify(diagnostics),
    diagnostics.extractionVersion || 'v1',
    JSON.stringify({
      parseDurationMs: diagnostics.parseDurationMs ?? null
    }),
    typeof diagnostics.ocrCoverage === 'number' ? diagnostics.ocrCoverage : null,
    sourceId,
    now,
    now
  )
}

function persistDocumentSections(
  db: Database.Database,
  sourceId: string,
  text: string,
  structuredSections?: StructuredSectionInput[]
): void {
  if (!tableExists(db, 'kb_document_sections')) return
  const sections =
    structuredSections && structuredSections.length > 0
      ? structuredSections
      : splitMarkdownSections(text).map((section) => ({ ...section, pageStart: undefined, pageEnd: undefined }))
  const ins = db.prepare(
    `INSERT INTO kb_document_sections
      (id, source_id, ord, heading, body, page_start, page_end, anchor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const now = Date.now()
  for (const [idx, section] of sections.entries()) {
    const anchor = `${slugifyAnchor(section.heading || `section-${idx + 1}`)}-${idx + 1}`
    ins.run(
      randomUUID(),
      sourceId,
      idx,
      section.heading ?? null,
      section.body,
      typeof section.pageStart === 'number' ? section.pageStart : null,
      typeof section.pageEnd === 'number' ? section.pageEnd : null,
      anchor,
      now
    )
  }
}

function persistEntityMentions(db: Database.Database, sourceId: string, chunks: ChunkDraft[]): void {
  if (!tableExists(db, 'kb_entity_mentions')) return
  const ins = db.prepare(
    `INSERT INTO kb_entity_mentions (id, source_id, chunk_id, entity, entity_kind, confidence, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`
  )
  const now = Date.now()
  const entities = new Map<string, number>()
  for (const chunk of chunks) {
    const tokens = chunk.text.match(/[A-Za-z][A-Za-z0-9_-]{4,}/g) ?? []
    for (const token of tokens) entities.set(token, (entities.get(token) ?? 0) + 1)
  }
  for (const [entity, count] of [...entities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    ins.run(randomUUID(), sourceId, entity, 'keyword', Math.min(0.95, 0.4 + count * 0.05), now)
  }
}

function rebuildDocRelations(db: Database.Database, sourceId: string): void {
  if (!tableExists(db, 'kb_doc_relations')) return
  const source = db.prepare('SELECT id, title FROM kb_sources WHERE id = ?').get(sourceId) as
    | { id: string; title: string }
    | undefined
  if (!source) return
  const tokenize = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
  const selfTokens = tokenize(source.title)
  const rows = db
    .prepare('SELECT id, title FROM kb_sources WHERE id != ? ORDER BY created_at DESC LIMIT 160')
    .all(sourceId) as Array<{ id: string; title: string }>
  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO kb_doc_relations (id, from_source_id, to_source_id, relation_kind, confidence, evidence_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_source_id, to_source_id, relation_kind) DO UPDATE SET
       confidence = excluded.confidence,
       evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at`
  )
  for (const row of rows) {
    const other = tokenize(row.title)
    const shared = [...other].filter((t) => selfTokens.has(t))
    if (shared.length === 0) continue
    const confidence = Math.min(0.92, 0.35 + shared.length * 0.09)
    upsert.run(
      randomUUID(),
      sourceId,
      row.id,
      'lexical_overlap',
      confidence,
      JSON.stringify({ sharedTerms: shared.slice(0, 10) }),
      now,
      now
    )
    upsert.run(
      randomUUID(),
      row.id,
      sourceId,
      'lexical_overlap',
      confidence,
      JSON.stringify({ sharedTerms: shared.slice(0, 10) }),
      now,
      now
    )
  }
}

function ingestDocument(db: Database.Database, input: IngestDocumentInput): KbSource {
  const sourceId = randomUUID()
  const t = Date.now()
  const sourceRawText = input.sourceRawText ?? input.rawText
  const rawText = normalizeImportedRawText(input.rawText)
  const distilledBody = (input.canonicalSummaryBody?.trim() || distillDocumentToWikiBody(input.title, rawText)).trim()
  const diagnostics: KbImportDiagnostic = {
    source: input.source,
    parserWarnings: input.diagnostics?.parserWarnings ?? [],
    truncated: input.diagnostics?.truncated === true,
    cleanupEdits: Math.max(0, Number(input.diagnostics?.cleanupEdits ?? 0)),
    cleanupMode: input.cleanupMode,
    cleanupPromptVersion: input.cleanupPromptVersion,
    cleanupFallbackReason: input.cleanupFallbackReason,
    parserEngine: input.diagnostics?.parserEngine,
    parserMode: input.diagnostics?.parserMode,
    parseDurationMs: input.diagnostics?.parseDurationMs,
    ocrApplied: input.diagnostics?.ocrApplied,
    ocrCoverage: input.diagnostics?.ocrCoverage,
    extractionVersion: input.diagnostics?.extractionVersion,
    qualityFlags: input.diagnostics?.qualityFlags ?? [],
    summaryMode: input.diagnostics?.summaryMode ?? (input.canonicalSummaryBody ? 'llm' : 'deterministic'),
    summaryPromptVersion: input.diagnostics?.summaryPromptVersion,
    summaryModelId: input.diagnostics?.summaryModelId
  }
  diagnostics.qualityFlags = [...new Set([...(diagnostics.qualityFlags ?? []), ...parserTelemetryQualityFlags(diagnostics)])]
  const confidence = scoreImportConfidence(rawText, distilledBody, diagnostics)
  db.prepare(
    'INSERT INTO kb_sources (id, title, uri, created_at, conversation_id) VALUES (?, ?, ?, ?, ?)'
  ).run(sourceId, input.title, input.uri, t, input.conversationId ?? null)
  input.onProgress?.({ kind: 'stage', stage: 'normalizing', stageLabel: 'Normalizing document', jobId: sourceId, progress: 0.3 })
  const sectionCountEstimate = Math.max(
    1,
    input.structuredSections?.length ??
      rawText
        .split(/\n{2,}/g)
        .map((section) => section.trim())
        .filter(Boolean).length
  )
  input.onProgress?.({
    kind: 'chunking',
    chunkCount: 0,
    step: 'segmenting',
    sectionCount: sectionCountEstimate,
    rawCharCount: sourceRawText.length,
    normalizedCharCount: rawText.length
  })
  const chunks = chunkText(rawText, input.heading, input.structuredSections)
  input.onProgress?.({
    kind: 'chunking',
    chunkCount: chunks.length,
    step: 'title_generation',
    sectionCount: sectionCountEstimate,
    rawCharCount: sourceRawText.length,
    normalizedCharCount: rawText.length
  })
  let ord = 0
  const ins = db.prepare(
    `INSERT INTO kb_chunks (id, source_id, ord, heading, text, anchor, passage_title) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const progressEvery = chunks.length <= 40 ? 1 : 8
  for (const [i, c] of chunks.entries()) {
    const cid = randomUUID()
    ins.run(cid, sourceId, ord++, c.heading ?? null, c.text, c.anchor, c.passageTitle)
    const inserted = i + 1
    if (inserted === chunks.length || inserted % progressEvery === 0) {
      input.onProgress?.({ kind: 'indexing', inserted, total: chunks.length })
    }
  }
  input.onProgress?.({
    kind: 'chunking',
    chunkCount: chunks.length,
    step: 'finalizing',
    sectionCount: sectionCountEstimate,
    rawCharCount: sourceRawText.length,
    normalizedCharCount: rawText.length
  })
  persistDocumentSections(db, sourceId, rawText, input.structuredSections)
  persistEntityMentions(db, sourceId, chunks)
  rebuildDocRelations(db, sourceId)
  const detectedDomains = analyzeSourceDomains(db, sourceId)
  const wikiBody = composeWikiReadModel(db, sourceId)
  const canonicalWikiBody = (input.canonicalSummaryBody?.trim() || wikiBody || distilledBody).trim()
  saveDocumentRecord(db, sourceId, sourceRawText, rawText, canonicalWikiBody, confidence, diagnostics)
  persistShadowRun(db, sourceId, diagnostics, confidence)
  void ingestSemanticBestEffort(db, {
    source: input.source,
    uri: input.uri,
    filePath: input.filePath,
    sourceId,
    text: rawText,
    diagnostics,
    runtime: input.runtime
  })
  input.onProgress?.({ kind: 'analysis', sourceId, domainsDetected: detectedDomains.length })
  input.onProgress?.({ kind: 'done', sourceId, title: input.title, chunkCount: chunks.length })
  refreshGraphProjectionForSourceBestEffort(db, sourceId)
  return { id: sourceId, title: input.title, uri: input.uri, createdAt: t, conversationId: input.conversationId ?? null }
}

export function ingestText(
  db: Database.Database,
  title: string,
  uri: string,
  body: string,
  heading?: string,
  conversationId?: string | null,
  onProgress?: (payload: KbIngestFileProgress) => void
): KbSource {
  return ingestTextWithMetadata(db, {
    title,
    uri,
    body,
    heading,
    conversationId,
    onProgress
  })
}

export function ingestTextWithMetadata(
  db: Database.Database,
  input: {
    title: string
    uri: string
    body: string
    heading?: string
    conversationId?: string | null
    source?: 'pdf' | 'text'
    diagnostics?: Partial<KbImportDiagnostic>
    filePath?: string
    onProgress?: (payload: KbIngestFileProgress) => void
  }
): KbSource {
  return ingestDocument(db, {
    title: input.title,
    uri: input.uri,
    sourceRawText: input.body,
    rawText: input.body,
    source: input.source ?? 'text',
    diagnostics: input.diagnostics,
    filePath: input.filePath,
    heading: input.heading,
    conversationId: input.conversationId,
    onProgress: input.onProgress
  })
}

export async function ingestFile(
  db: Database.Database,
  filePath: string,
  title?: string,
  onProgress?: (payload: KbIngestFileProgress) => void,
  runtime?: RuntimeAdapter | null,
  forcedJobId?: string
): Promise<KbSource> {
  const existing = findExistingFileSource(db, filePath)
  if (existing) {
    throw new Error(`This document is already in your wiki library as "${existing.title}".`)
  }
  const name = title ?? filePath.split(/[/\\]/).pop() ?? filePath
  const jobId = forcedJobId ?? randomUUID()
  upsertIngestJob(db, {
    jobId,
    filePath,
    title: name,
    stage: 'selected',
    status: 'queued'
  })
  onProgress?.({ kind: 'stage', stage: 'selected', stageLabel: 'File selected', jobId, progress: 0.05 })
  let body: string
  let sourceRawText = ''
  let parsedFilePath: string | undefined
  let diagnostics: Partial<KbImportDiagnostic> = {
    source: 'text',
    parserWarnings: [],
    truncated: false,
    cleanupEdits: 0
  }
  upsertIngestJob(db, { jobId, filePath, title: name, stage: 'extracting', status: 'running' })
  onProgress?.({ kind: 'stage', stage: 'extracting', stageLabel: 'Reading document', jobId, progress: 0.16 })
  onProgress?.({ kind: 'reading', filePath, format: filePath.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text' })
  onProgress?.({ kind: 'stage', stage: 'parsing', stageLabel: 'Parsing document structure', jobId, progress: 0.24 })
  const parsed = await parseDocumentFromFile({
    filePath,
    onPdfPageProgress: (progress) => {
      onProgress?.({
        kind: 'pdf_page_progress',
        processedPages: progress.processedPages,
        totalPages: progress.totalPages,
        pagesLeft: progress.pagesLeft
      })
    }
  })
  body = parsed.normalizedText
  sourceRawText = parsed.rawText
  parsedFilePath = filePath
  diagnostics = {
    source: parsed.sourceKind,
    parserWarnings: parsed.warnings.length > 0 ? parsed.warnings : (parsed.parserDiagnostics?.parserWarnings ?? []),
    truncated: parsed.parserDiagnostics?.truncated === true,
    cleanupEdits: Number(parsed.parserDiagnostics?.cleanupEdits ?? 0),
    parserEngine: parsed.parserEngine,
    parserMode: parsed.parserMode,
    parseDurationMs: parsed.parseDurationMs,
    ocrApplied: parsed.ocrApplied,
    ocrCoverage: parsed.ocrCoverage,
    extractionVersion: parsed.extractionVersion
  }
  diagnostics.qualityFlags = parserTelemetryQualityFlags(diagnostics)
  if (!body.trim()) {
    throw new Error('No extractable text in this document (it may be image-only, encrypted, or empty).')
  }
  try {
    const cleanup = await runArticleCleanup({ title: name, body, runtime })
    body = cleanup.body
    const canonicalSummary = await summarizeImportedDocument(runtime, name, body)
    diagnostics = {
      ...diagnostics,
      cleanupEdits: Math.max(0, Number(diagnostics.cleanupEdits ?? 0)) + cleanup.heuristicEdits,
      summaryMode: canonicalSummary ? 'llm' : 'deterministic',
      summaryPromptVersion: canonicalSummary?.promptVersion,
      summaryModelId: canonicalSummary?.modelId
    }
    onProgress?.({ kind: 'stage', stage: 'enriching', stageLabel: 'Extracting context and entities', jobId, progress: 0.55, parserMode: diagnostics.parserMode })
    const out = ingestDocument(db, {
      title: name,
      uri: `file://${filePath}`,
      sourceRawText,
      rawText: body,
      canonicalSummaryBody: canonicalSummary?.body,
      source: parsed.sourceKind,
      filePath: parsedFilePath,
      diagnostics,
      structuredSections: parsed.sections,
      cleanupMode: cleanup.mode,
      cleanupPromptVersion: cleanup.promptVersion,
      cleanupFallbackReason: cleanup.fallbackReason,
      runtime,
      onProgress
    })
    upsertIngestJob(db, {
      jobId,
      filePath,
      title: name,
      stage: 'done',
      status: 'done',
      sourceId: out.id
    })
    return out
  } catch (error) {
    upsertIngestJob(db, {
      jobId,
      filePath,
      title: name,
      stage: 'failed',
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

export async function cleanupWikiArticle(
  db: Database.Database,
  sourceId: string,
  runtime?: RuntimeAdapter | null,
  onProgress?: (payload: ArticleCleanupProgress) => void
): Promise<WikiArticleCleanupResult> {
  const source = db.prepare('SELECT id, title FROM kb_sources WHERE id = ? LIMIT 1').get(sourceId) as
    | { id: string; title: string }
    | undefined
  if (!source) throw new Error('source not found')
  const baseBody = getWikiPageBody(db, sourceId)
  onProgress?.({ stage: 'prepare', label: 'Preparing article cleanup', progress: 4 })
  const cleanup = await runArticleCleanup({ title: source.title, body: baseBody, runtime, onProgress })
  const cleanedBody = normalizeImportedRawText(cleanup.body)
  const chunks = chunkText(cleanedBody)
  const doc = getDocumentRecord(db, sourceId)
  const diagnostics: KbImportDiagnostic = {
    source: doc?.diagnostics.source === 'pdf' ? 'pdf' : 'text',
    parserWarnings: doc?.diagnostics.parserWarnings ?? [],
    truncated: doc?.diagnostics.truncated === true,
    cleanupEdits: Math.max(0, Number(doc?.diagnostics.cleanupEdits ?? 0)) + cleanup.heuristicEdits,
    parserEngine: doc?.diagnostics.parserEngine,
    parserMode: doc?.diagnostics.parserMode,
    parseDurationMs: doc?.diagnostics.parseDurationMs,
    ocrApplied: doc?.diagnostics.ocrApplied,
    ocrCoverage: doc?.diagnostics.ocrCoverage,
    extractionVersion: doc?.diagnostics.extractionVersion,
    qualityFlags: doc?.diagnostics.qualityFlags ?? [],
    cleanupMode: cleanup.mode,
    cleanupPromptVersion: cleanup.promptVersion,
    cleanupFallbackReason: cleanup.fallbackReason
  }
  const confidence = scoreImportConfidence(doc?.rawText ?? cleanedBody, cleanedBody, diagnostics)
  onProgress?.({ stage: 'reindex', label: 'Rebuilding indexed article chunks', progress: 86 })
  const tx = db.transaction(() => {
    const oldChunkIds = db.prepare('SELECT id FROM kb_chunks WHERE source_id = ?').all(sourceId) as Array<{ id: string }>
    const pageId = `src:${sourceId}`
    db.prepare('DELETE FROM wiki_page_chunks WHERE page_id = ?').run(pageId)
    const delChunkLink = db.prepare('DELETE FROM wiki_page_chunks WHERE chunk_id = ?')
    for (const row of oldChunkIds) delChunkLink.run(row.id)
    db.prepare('DELETE FROM kb_chunks WHERE source_id = ?').run(sourceId)
    const ins = db.prepare(
      `INSERT INTO kb_chunks (id, source_id, ord, heading, text, anchor, passage_title) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [ord, chunk] of chunks.entries()) {
      ins.run(randomUUID(), sourceId, ord, chunk.heading ?? null, chunk.text, chunk.anchor, chunk.passageTitle)
    }
    if (tableExists(db, 'kb_document_sections')) {
      db.prepare('DELETE FROM kb_document_sections WHERE source_id = ?').run(sourceId)
    }
    if (tableExists(db, 'kb_entity_mentions')) {
      db.prepare('DELETE FROM kb_entity_mentions WHERE source_id = ?').run(sourceId)
    }
    if (tableExists(db, 'kb_doc_relations')) {
      db.prepare('DELETE FROM kb_doc_relations WHERE from_source_id = ? OR to_source_id = ?').run(sourceId, sourceId)
    }
    if (tableExists(db, 'kb_domain_membership')) {
      db.prepare('DELETE FROM kb_domain_membership WHERE source_id = ?').run(sourceId)
    }
    if (tableExists(db, 'kb_domain_retrieval_units')) {
      db.prepare('DELETE FROM kb_domain_retrieval_units WHERE source_id = ?').run(sourceId)
    }
    persistDocumentSections(db, sourceId, cleanedBody)
    persistEntityMentions(db, sourceId, chunks)
    rebuildDocRelations(db, sourceId)
    analyzeSourceDomains(db, sourceId)
    onProgress?.({ stage: 'persist', label: 'Persisting cleaned article content', progress: 94 })
    const wikiBody = composeWikiReadModel(db, sourceId)
    saveDocumentRecord(
      db,
      sourceId,
      doc?.sourceRawText ?? doc?.rawText ?? cleanedBody,
      doc?.rawText ?? cleanedBody,
      wikiBody || cleanedBody,
      confidence,
      diagnostics
    )
    void ingestSemanticBestEffort(db, {
      source: diagnostics.source === 'pdf' ? 'pdf' : 'text',
      uri: `src:${sourceId}`,
      sourceId,
      text: cleanedBody,
      diagnostics
    })
    ensureWikiPageForSource(db, sourceId)
    const activeEntry = resolveActiveWikiEntryForSource(db, sourceId)
    if (activeEntry) {
      createWikiEntryRevision(db, {
        entryId: activeEntry.entryId,
        title: activeEntry.title || source.title,
        body: cleanedBody,
        modelId: cleanup.modelId ?? null,
        promptVersion: cleanup.promptVersion,
        sourceIds: readSourceIdsJson(activeEntry.sourceIdsJson).length
          ? readSourceIdsJson(activeEntry.sourceIdsJson)
          : [sourceId]
      })
    }
  })
  tx()
  refreshGraphProjectionForSourceBestEffort(db, sourceId)
  return {
    ok: true,
    sourceId,
    mode: cleanup.mode,
    promptVersion: cleanup.promptVersion,
    fallbackReason: cleanup.fallbackReason,
    cleanupEdits: cleanup.heuristicEdits,
    chunkCount: chunks.length,
    modelId: cleanup.modelId
  }
}

/** Chunk and index the full message thread of a conversation into the knowledge base (linked for later bulk delete). */
export function ingestConversationThread(db: Database.Database, conversationId: string): KbSource {
  const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as
    | { title: string }
    | undefined
  if (!conv) throw new Error('Conversation not found')
  const rows = db
    .prepare(
      `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as { role: string; content: string }[]
  if (rows.length === 0) throw new Error('No messages to save')
  const body = rows.map((r) => `### ${r.role}\n\n${r.content}`).join('\n\n---\n\n')
  const title = `Chat: ${conv.title}`
  const uri = `chat:${conversationId}`
  return ingestText(db, title, uri, body, undefined, conversationId)
}

/** Remove one KB source and its wiki links, chunks, and FTS rows (via triggers). */
export function deleteKbSource(db: Database.Database, sourceId: string): void {
  const chunkIds = db.prepare('SELECT id FROM kb_chunks WHERE source_id = ?').all(sourceId) as { id: string }[]
  const delWpcByChunk = db.prepare('DELETE FROM wiki_page_chunks WHERE chunk_id = ?')
  for (const r of chunkIds) delWpcByChunk.run(r.id)
  const pageId = `src:${sourceId}`
  db.prepare('DELETE FROM wiki_page_chunks WHERE page_id = ?').run(pageId)
  db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(pageId)
  if (hasWikiEntryTables(db)) {
    const mapped = db
      .prepare('SELECT entry_id as entryId FROM wiki_entry_sources WHERE source_id = ?')
      .get(sourceId) as { entryId: string } | undefined
    db.prepare('DELETE FROM wiki_entry_sources WHERE source_id = ?').run(sourceId)
    if (mapped?.entryId) {
      const rem = db
        .prepare('SELECT COUNT(*) as c FROM wiki_entry_sources WHERE entry_id = ?')
        .get(mapped.entryId) as { c: number } | undefined
      if (Number(rem?.c ?? 0) === 0) {
        db.prepare('DELETE FROM wiki_keyword_relations WHERE from_entry_id = ? OR to_entry_id = ?').run(
          mapped.entryId,
          mapped.entryId
        )
        db.prepare('DELETE FROM wiki_entries WHERE id = ?').run(mapped.entryId)
      }
    }
  }
  db.prepare('DELETE FROM kb_sources WHERE id = ?').run(sourceId)
  removeGraphProjectionForSourceBestEffort(db, sourceId)
}

/** Delete all knowledge sources tied to a conversation (from "Save chat to wiki"). */
export function deleteKbSourcesForConversation(db: Database.Database, conversationId: string): number {
  const sources = db
    .prepare('SELECT id FROM kb_sources WHERE conversation_id = ?')
    .all(conversationId) as { id: string }[]
  for (const { id } of sources) deleteKbSource(db, id)
  return sources.length
}

export type ResetWikiAndKeywordsResult = {
  sourcesRemoved: number
  promptDomainsRemoved: number
}

/**
 * Remove the entire knowledge wiki: all KB sources, compiled wiki pages, chunks, and FTS rows.
 * Also removes **all prompt domains**: clears `message_prompt_domains` then `prompt_domains` (clusters,
 * keywords, and optional system suffixes). Does not remove conversations, chats, or model files.
 */
export function resetEntireWikiAndKeywords(db: Database.Database): ResetWikiAndKeywordsResult {
  const tx = db.transaction(() => {
    const ids = db.prepare('SELECT id FROM kb_sources').all() as { id: string }[]
    for (const { id } of ids) {
      deleteKbSource(db, id)
    }
    const countRow = db.prepare('SELECT COUNT(*) as c FROM prompt_domains').get() as { c: number } | undefined
    const promptDomainsRemoved = Number(countRow?.c ?? 0)
    db.prepare('DELETE FROM message_prompt_domains').run()
    db.prepare('DELETE FROM prompt_domains').run()
    db.prepare('DELETE FROM wiki_page_chunks').run()
    db.prepare('DELETE FROM wiki_pages').run()
    if (hasWikiEntryTables(db)) {
      db.prepare('DELETE FROM wiki_keyword_relations').run()
      db.prepare('DELETE FROM wiki_entry_sources').run()
      db.prepare('DELETE FROM wiki_entry_revisions').run()
      db.prepare('DELETE FROM wiki_entries').run()
    }
    return { sourcesRemoved: ids.length, promptDomainsRemoved }
  })
  const result = tx()
  clearProjection(db, 'structural')
  clearProjection(db, 'semantic')
  return result
}

export function searchChunks(db: Database.Database, query: string, limit: number): KbChunk[] {
  return retrieveChunks(db, { query, limit }).map((row) => ({
    id: row.chunkId,
    sourceId: row.sourceId,
    text: row.text,
    heading: row.heading ?? undefined,
    anchor: row.anchor ?? undefined,
    passageTitle: row.passageTitle ?? undefined,
    ord: row.ord
  }))
}

/**
 * Full-text search across chunks; returns at most one row per source (best BM25 chunk),
 * with source title and a short snippet for the wiki library UI.
 */
export function searchKbHits(db: Database.Database, query: string, limit: number): KbSearchHit[] {
  return retrieveKbHits(db, { query, limit })
}

export function listSources(db: Database.Database): KbSource[] {
  return db
    .prepare(
      `SELECT id, title, uri, created_at as createdAt, conversation_id as conversationId
       FROM kb_sources ORDER BY created_at DESC`
    )
    .all() as KbSource[]
}

export function listChunksForSource(db: Database.Database, sourceId: string): KbChunk[] {
  return db
    .prepare(
      'SELECT id, source_id as sourceId, text, heading, anchor, passage_title as passageTitle, ord FROM kb_chunks WHERE source_id = ? ORDER BY ord'
    )
    .all(sourceId) as KbChunk[]
}

export function getDocumentRecord(db: Database.Database, sourceId: string): KbDocumentRecord | null {
  if (!tableExists(db, 'kb_documents')) return null
  const row = db
    .prepare(
      `SELECT source_id as sourceId,
              raw_source_text as sourceRawText,
              raw_text as rawText,
              distilled_body as distilledBody,
              confidence_score as confidenceScore,
              confidence_reasons_json as confidenceReasonsJson,
              diagnostics_json as diagnosticsJson,
              created_at as createdAt,
              updated_at as updatedAt
       FROM kb_documents
       WHERE source_id = ?
       LIMIT 1`
    )
    .get(sourceId) as
    | {
        sourceId: string
        sourceRawText: string
        rawText: string
        distilledBody: string
        confidenceScore: number
        confidenceReasonsJson: string
        diagnosticsJson: string
        createdAt: number
        updatedAt: number
      }
    | undefined
  if (!row) return null
  let confidenceReasons: string[] = []
  let diagnostics: KbImportDiagnostic = { source: 'text', parserWarnings: [], truncated: false, cleanupEdits: 0 }
  try {
    const parsed = JSON.parse(row.confidenceReasonsJson)
    if (Array.isArray(parsed)) confidenceReasons = parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    confidenceReasons = []
  }
  try {
    const parsed = JSON.parse(row.diagnosticsJson) as Partial<KbImportDiagnostic>
    diagnostics = {
      source: parsed.source === 'pdf' ? 'pdf' : 'text',
      parserWarnings: Array.isArray(parsed.parserWarnings)
        ? parsed.parserWarnings.filter((x): x is string => typeof x === 'string')
        : [],
      truncated: parsed.truncated === true,
      cleanupEdits: Math.max(0, Number(parsed.cleanupEdits ?? 0)),
      parserEngine: typeof parsed.parserEngine === 'string' ? parsed.parserEngine : undefined,
      parserMode:
        parsed.parserMode === 'text_layer' ||
        parsed.parserMode === 'pdftotext_fallback' ||
        parsed.parserMode === 'true_ocr_fallback' ||
        parsed.parserMode === 'hybrid_merged' ||
        parsed.parserMode === 'plain_text' ||
        parsed.parserMode === 'html_text'
          ? parsed.parserMode
          : undefined,
      parseDurationMs: Number.isFinite(Number(parsed.parseDurationMs)) ? Number(parsed.parseDurationMs) : undefined,
      ocrApplied: parsed.ocrApplied === true,
      ocrCoverage: Number.isFinite(Number(parsed.ocrCoverage)) ? Number(parsed.ocrCoverage) : undefined,
      extractionVersion: typeof parsed.extractionVersion === 'string' ? parsed.extractionVersion : undefined,
      qualityFlags: Array.isArray(parsed.qualityFlags)
        ? parsed.qualityFlags.filter((x): x is string => typeof x === 'string')
        : [],
      cleanupMode: parsed.cleanupMode === 'llm' || parsed.cleanupMode === 'heuristic' ? parsed.cleanupMode : undefined,
      cleanupPromptVersion:
        typeof parsed.cleanupPromptVersion === 'string' ? parsed.cleanupPromptVersion : undefined,
      cleanupFallbackReason:
        typeof parsed.cleanupFallbackReason === 'string' ? parsed.cleanupFallbackReason : undefined,
      summaryMode: parsed.summaryMode === 'llm' || parsed.summaryMode === 'deterministic' ? parsed.summaryMode : undefined,
      summaryPromptVersion:
        typeof parsed.summaryPromptVersion === 'string' ? parsed.summaryPromptVersion : undefined,
      summaryModelId: typeof parsed.summaryModelId === 'string' ? parsed.summaryModelId : undefined
    }
  } catch {
    /* ignore */
  }
  return {
    sourceId: row.sourceId,
    sourceRawText: row.sourceRawText || row.rawText,
    rawText: row.rawText,
    distilledBody: row.distilledBody,
    confidenceScore: Number(row.confidenceScore) || 0.5,
    confidenceReasons,
    diagnostics,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function sentenceSnippet(text: string, maxLen = 180): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen - 1)}…`
}

export function listWikiPassages(db: Database.Database, sourceId: string): WikiPassageSummary[] {
  const chunks = listChunksForSource(db, sourceId)
  return chunks.map((c, idx) => {
    const title = summarizePassageTitle(c.passageTitle || c.heading || c.text || `Passage ${idx + 1}`)
    return {
      chunkId: c.id,
      ord: c.ord,
      heading: c.heading ?? null,
      title,
      anchor: c.anchor?.trim() || `passage-${idx + 1}`,
      snippet: sentenceSnippet(c.text),
      wordCount: c.text.trim().split(/\s+/).filter(Boolean).length
    }
  })
}

export function suggestWikiKeywords(
  db: Database.Database,
  sourceId: string,
  chunkIds?: readonly string[],
  limit = 18
): WikiKeywordCandidate[] {
  const passages = listWikiPassages(db, sourceId)
  const allowed = chunkIds?.length ? new Set(chunkIds) : null
  const byChunk = new Map(passages.map((p) => [p.chunkId, p]))
  const tokenTo = new Map<string, { score: number; chunkIds: Set<string> }>()
  const stop = new Set([
    'with',
    'this',
    'that',
    'from',
    'into',
    'about',
    'where',
    'when',
    'which',
    'while',
    'have',
    'has',
    'were',
    'been',
    'also',
    'than',
    'them',
    'they',
    'your',
    'their',
    'using',
    'used'
  ])
  for (const p of passages) {
    if (allowed && !allowed.has(p.chunkId)) continue
    const src = `${p.title} ${p.snippet}`.toLowerCase()
    const tokens = src.match(/[a-z0-9]{4,}/g) ?? []
    const uniq = new Set(tokens.filter((t) => !stop.has(t)))
    for (const t of uniq) {
      if (!tokenTo.has(t)) tokenTo.set(t, { score: 0, chunkIds: new Set() })
      const cur = tokenTo.get(t)!
      cur.score += 1 + Math.min(2, (byChunk.get(p.chunkId)?.wordCount ?? 0) / 220)
      cur.chunkIds.add(p.chunkId)
    }
  }
  return [...tokenTo.entries()]
    .filter(([, v]) => v.chunkIds.size > 0)
    .sort((a, b) => b[1].score - a[1].score || b[1].chunkIds.size - a[1].chunkIds.size)
    .slice(0, Math.max(1, limit))
    .map(([keyword, v]) => ({
      keyword,
      score: Number(v.score.toFixed(2)),
      chunkIds: [...v.chunkIds]
    }))
}

function keywordToArticleTitle(keyword: string): string {
  return summarizePassageTitle(
    keyword
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ')
  )
}

export function extractWikiArticlesFromSource(
  db: Database.Database,
  input: WikiExtractArticleRequest
): WikiExtractArticleResult {
  const sourceId = input.sourceId.trim()
  if (!sourceId) throw new Error('sourceId is required')
  const keyword = normalizeWikiKeyword(input.keyword)
  if (!keyword) throw new Error('keyword is required')
  const selected = new Set(input.chunkIds.map((id) => id.trim()).filter(Boolean))
  if (selected.size === 0) throw new Error('Select at least one passage to extract')
  const chunks = listChunksForSource(db, sourceId).filter((c) => selected.has(c.id))
  if (chunks.length === 0) throw new Error('No selected passages were found')
  const articleTitle = summarizePassageTitle(input.title?.trim() || keywordToArticleTitle(keyword))
  const articleBody = chunks
    .map((c, idx) => {
      const heading = summarizePassageTitle(c.passageTitle || c.heading || `Passage ${idx + 1}`)
      const anchor = c.anchor?.trim() || `passage-${idx + 1}`
      return `### ${heading}\n<a id="${anchor}"></a>\n\n${c.text.trim()}`
    })
    .join('\n\n---\n\n')
  const src = ingestText(db, articleTitle, `wiki-extract-manual:${sourceId}:${Date.now()}`, articleBody)
  return {
    sourceId: src.id,
    title: articleTitle,
    keyword,
    chunkCount: chunks.length
  }
}

export function resolveWikiTerm(
  db: Database.Database,
  input: { term: string; contextSourceId?: string; contextSnippet?: string }
): WikiTermResolutionResult {
  const keyword = normalizeWikiKeyword(input.term)
  if (!keyword) {
    return { matched: false, keyword: '', contextSnippet: input.contextSnippet?.trim() || undefined }
  }
  const sources = db
    .prepare('SELECT id, title FROM kb_sources ORDER BY created_at DESC LIMIT 1200')
    .all() as { id: string; title: string }[]

  const exact = sources.find((s) => normalizeWikiKeyword(s.title) === keyword)
  if (exact) {
    return { matched: true, sourceId: exact.id, title: exact.title, keyword, contextSnippet: input.contextSnippet?.trim() || undefined }
  }
  const contains = sources.find((s) => normalizeWikiKeyword(s.title).includes(keyword) || keyword.includes(normalizeWikiKeyword(s.title)))
  if (contains) {
    return {
      matched: true,
      sourceId: contains.id,
      title: contains.title,
      keyword,
      contextSnippet: input.contextSnippet?.trim() || undefined
    }
  }
  if (input.contextSourceId) {
    return {
      matched: false,
      keyword,
      contextSnippet: input.contextSnippet?.trim() || undefined
    }
  }
  return { matched: false, keyword, contextSnippet: input.contextSnippet?.trim() || undefined }
}

function defaultWikiBodyForSource(db: Database.Database, sourceId: string): string {
  const pageId = `src:${sourceId}`
  const page = db.prepare('SELECT body FROM wiki_pages WHERE id = ?').get(pageId) as { body: string } | undefined
  if (page?.body?.trim()) return page.body
  return getWikiPageBody(db, sourceId)
}

function createWikiEntryRevision(
  db: Database.Database,
  args: {
    entryId: string
    title: string
    body: string
    modelId?: string | null
    promptVersion?: string | null
    sourceIds: string[]
  }
): { revisionId: string; versionNo: number } {
  const t = Date.now()
  const next = db
    .prepare('SELECT COALESCE(MAX(version_no), 0) + 1 as nextVersion FROM wiki_entry_revisions WHERE entry_id = ?')
    .get(args.entryId) as { nextVersion: number }
  const versionNo = Number(next.nextVersion || 1)
  const revisionId = randomUUID()
  db.prepare(
    `INSERT INTO wiki_entry_revisions
      (id, entry_id, version_no, title, body, model_id, prompt_version, source_ids_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    revisionId,
    args.entryId,
    versionNo,
    args.title,
    args.body,
    args.modelId ?? null,
    args.promptVersion ?? null,
    JSON.stringify(args.sourceIds),
    t
  )
  db.prepare('UPDATE wiki_entries SET active_revision_id = ?, updated_at = ? WHERE id = ?').run(revisionId, t, args.entryId)
  return { revisionId, versionNo }
}

function insertWikiEntryForKeyword(db: Database.Database, canonicalKeyword: string): string {
  const entryId = randomUUID()
  const t = Date.now()
  db.prepare(
    'INSERT INTO wiki_entries (id, canonical_keyword, active_revision_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)'
  ).run(entryId, canonicalKeyword, t, t)
  return entryId
}

export function ensureWikiVersioningBackfill(db: Database.Database): void {
  if (!hasWikiEntryTables(db)) return
  const existing = db.prepare('SELECT COUNT(*) as c FROM wiki_entries').get() as { c: number } | undefined
  if (Number(existing?.c ?? 0) > 0) return
  const sources = db
    .prepare('SELECT id, title FROM kb_sources ORDER BY created_at ASC')
    .all() as { id: string; title: string }[]
  if (sources.length === 0) return
  const tx = db.transaction(() => {
    const keywordToEntry = new Map<string, string>()
    for (const s of sources) {
      const canonical = normalizeWikiKeyword(s.title) || normalizeWikiKeyword(`topic ${s.id.slice(0, 8)}`)
      let entryId = keywordToEntry.get(canonical)
      if (!entryId) {
        entryId = insertWikiEntryForKeyword(db, canonical)
        const body = defaultWikiBodyForSource(db, s.id)
        createWikiEntryRevision(db, {
          entryId,
          title: titleCaseKeyword(canonical),
          body,
          modelId: null,
          promptVersion: 'legacy-backfill',
          sourceIds: [s.id]
        })
        keywordToEntry.set(canonical, entryId)
      }
      db.prepare('INSERT OR REPLACE INTO wiki_entry_sources (entry_id, source_id) VALUES (?, ?)').run(entryId, s.id)
    }
  })
  tx()
}

const WIKI_HIGHLIGHT_SNIPPET_MAX = 220
const WIKI_HIGHLIGHT_PHRASE_MIN = 3
const WIKI_HIGHLIGHT_PHRASE_MAX = 200
const WIKI_HIGHLIGHT_MAX_TERMS = 600

function clipHighlightSnippet(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length <= WIKI_HIGHLIGHT_SNIPPET_MAX) return s
  return `${s.slice(0, WIKI_HIGHLIGHT_SNIPPET_MAX - 1)}…`
}

/**
 * Collect phrases that appear in the knowledge base so chat bubbles can link to wiki articles:
 * source titles (and "Chat:" title suffix), non-empty chunk headings, and `::: glossary` terms
 * from compiled wiki page bodies when present.
 */
export function listWikiChatHighlightTerms(db: Database.Database): WikiChatHighlightTerm[] {
  ensureWikiVersioningBackfill(db)
  const out: WikiChatHighlightTerm[] = []
  const seen = new Set<string>()

  const push = (sourceId: string, phrase: string, snippet: string): void => {
    const p = phrase.trim()
    if (p.length < WIKI_HIGHLIGHT_PHRASE_MIN || p.length > WIKI_HIGHLIGHT_PHRASE_MAX) return
    const k = `${sourceId}\0${p.toLowerCase()}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ sourceId, phrase: p, snippet: clipHighlightSnippet(snippet) })
  }

  const sources = db.prepare('SELECT id, title FROM kb_sources').all() as { id: string; title: string }[]
  for (const s of sources) {
    const title = (s.title ?? '').trim()
    if (!title) continue

    push(s.id, title, `Wiki: ${title}`)

    const chatStripped = title.replace(/^Chat:\s*/i, '').trim()
    if (chatStripped.length >= WIKI_HIGHLIGHT_PHRASE_MIN && chatStripped.toLowerCase() !== title.toLowerCase()) {
      push(s.id, chatStripped, `Saved chat: ${title}`)
    }

    const noteStripped = title.replace(/^Note:\s*/i, '').trim()
    if (
      noteStripped.length >= WIKI_HIGHLIGHT_PHRASE_MIN &&
      noteStripped.toLowerCase() !== title.toLowerCase() &&
      noteStripped.toLowerCase() !== chatStripped.toLowerCase()
    ) {
      push(s.id, noteStripped, `Chat note: ${title}`)
    }
  }

  const chunkHeadings = db
    .prepare(
      `SELECT source_id as sourceId, heading, text FROM kb_chunks
       WHERE heading IS NOT NULL AND TRIM(heading) != ''`
    )
    .all() as { sourceId: string; heading: string; text: string }[]

  for (const c of chunkHeadings) {
    push(c.sourceId, c.heading, c.text || c.heading)
  }

  const activeEntries = listActiveWikiEntryRows(db)
  if (activeEntries.length > 0) {
    const repStmt = db.prepare(
      `SELECT source_id as sourceId
       FROM wiki_entry_sources
       WHERE entry_id = ?
       ORDER BY source_id ASC
       LIMIT 1`
    )
    for (const entry of activeEntries) {
      const rep = repStmt.get(entry.entryId) as { sourceId: string } | undefined
      if (!rep?.sourceId) continue
      const { glossary } = extractWikiGlossary(stripWikiControlMarkers(entry.body ?? ''))
      for (const g of glossary) {
        push(rep.sourceId, g.term, g.definition || g.term)
      }
    }
  } else {
    const pages = db.prepare('SELECT id, body FROM wiki_pages WHERE id LIKE ?').all('src:%') as {
      id: string
      body: string
    }[]
    for (const page of pages) {
      const sourceId = page.id.startsWith('src:') ? page.id.slice(4) : ''
      if (!sourceId) continue
      const { glossary } = extractWikiGlossary(stripWikiControlMarkers(page.body ?? ''))
      for (const g of glossary) {
        push(sourceId, g.term, g.definition || g.term)
      }
    }
  }

  out.sort((a, b) => b.phrase.length - a.phrase.length)
  const capped = out.slice(0, WIKI_HIGHLIGHT_MAX_TERMS)
  return enrichWikiHighlightTermsWithKnowledgeGraph(capped, db)
}

/** Topic = source title with chunk count and kind (wiki index). */
export function listWikiTopics(db: Database.Database): WikiTopic[] {
  ensureWikiVersioningBackfill(db)
  const primaryDomainBySource = new Map<string, { domainId: string; domainTitle: string }>()
  if (tableExists(db, 'kb_domain_membership') && tableExists(db, 'kb_domains')) {
    const rows = db
      .prepare(
        `SELECT dm.source_id as sourceId, dm.domain_id as domainId, d.title as domainTitle
         FROM kb_domain_membership dm
         JOIN kb_domains d ON d.id = dm.domain_id
         ORDER BY dm.source_id ASC, dm.confidence DESC, d.updated_at DESC`
      )
      .all() as Array<{ sourceId: string; domainId: string; domainTitle: string }>
    for (const row of rows) {
      if (!primaryDomainBySource.has(row.sourceId)) {
        primaryDomainBySource.set(row.sourceId, {
          domainId: row.domainId,
          domainTitle: row.domainTitle
        })
      }
    }
  }
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.uri, COUNT(c.id) as chunkCount
       FROM kb_sources s
       LEFT JOIN kb_chunks c ON c.source_id = s.id
       GROUP BY s.id, s.title, s.uri
       ORDER BY s.created_at DESC`
    )
    .all() as { id: string; title: string; uri: string; chunkCount: number }[]
  return rows.map((r) => ({
    ...(primaryDomainBySource.get(r.id) ?? {}),
    id: r.id,
    title: r.title,
    chunkCount: Number(r.chunkCount),
    kind: wikiKindFromUri(r.uri)
  }))
}

const WIKI_FILLER = {
  emptySection: 'Nothing further was recorded for this section in the library.',
  noIndexedText: 'No indexed text is available for this topic yet.',
  noDefinition: 'No definition line has been indexed for this topic yet.',
  noRelatedAuto: 'No other library entries were linked automatically from this topic.'
} as const

function wikiDefinitionSnippet(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return WIKI_FILLER.noDefinition
  if (t.length <= maxLen) return t
  const cut = t.slice(0, maxLen)
  const lastPeriod = cut.lastIndexOf('.')
  if (lastPeriod > 48) return cut.slice(0, lastPeriod + 1).trim()
  return `${cut.trim()}…`
}

function wikiChunkBlock(c: KbChunk, i: number): string {
  const h = c.passageTitle?.trim() || c.heading?.trim()
  const head = summarizePassageTitle(h || `Passage ${i + 1}`)
  const anchor = c.anchor?.trim() || `passage-${i + 1}`
  return `### ${head}\n<a id="${anchor}"></a>\n\n${c.text.trim()}`
}

function wikiMarkdownRelatedList(db: Database.Database, sourceId: string): string {
  const related = listRelatedWikiSources(db, sourceId, 18)
  if (related.length === 0) {
    return WIKI_FILLER.noRelatedAuto
  }
  return related
    .map((r) => {
      const safeTitle = r.title.replace(/\*/g, "'")
      return `- **${safeTitle}**`
    })
    .join('\n')
}

/**
 * Compile browsable wiki Markdown for one KB source: reference article shape —
 * glossary introduction (keyword + definition), practice/context, related concepts (manual chunks + suggested titles),
 * and notes from remaining indexed chunks.
 */
export function getWikiPageBody(db: Database.Database, sourceId: string): string {
  try {
    const composed = composeWikiReadModel(db, sourceId)
    if (composed.trim()) return composed
  } catch {
    /* fallback to legacy body composition below */
  }
  const row = db.prepare('SELECT title FROM kb_sources WHERE id = ?').get(sourceId) as { title: string } | undefined
  const keyword = row?.title?.trim() || 'Untitled'
  const chunks = listChunksForSource(db, sourceId)
  const relatedMd = wikiMarkdownRelatedList(db, sourceId)

  if (chunks.length === 0) {
    return [
      '::: glossary',
      `**${keyword.replace(/\*/g, "'")}** — ${WIKI_FILLER.noIndexedText}`,
      ':::',
      '',
      WIKI_REFERENCE_SECTION_MARKDOWN.practice,
      '',
      WIKI_FILLER.emptySection,
      '',
      WIKI_REFERENCE_SECTION_MARKDOWN.related,
      '',
      relatedMd,
      '',
      WIKI_REFERENCE_SECTION_MARKDOWN.notes,
      '',
      WIKI_FILLER.emptySection,
      ''
    ].join('\n')
  }

  const usagePick = (c: KbChunk) =>
    /\busage\b|application|how\s+to\s+use|employed|employ\b|practice|context|when\s+it\s+applies|applies\b|typical\s+context/i.test(
      c.heading ?? ''
    )
  const relationsPick = (c: KbChunk) =>
    /\blinguistic|relations?\b|related\s+concepts?|cross-?ref|synonym|antonym|etymolog|other\s+keywords?|see\s+also|ties\s+to\b/i.test(
      c.heading ?? ''
    )
  const depthPick = (c: KbChunk) =>
    /\bin-?depth|deep\s+dive|extended|detailed|full\s+account|analysis\b|notes\b|caveats?\b|edge\s+cases?\b/i.test(c.heading ?? '')

  const usageChunks = chunks.filter(usagePick)
  const relationsChunks = chunks.filter(relationsPick)
  const depthChunks = chunks.filter(depthPick)
  const consumed = new Set([...usageChunks, ...relationsChunks, ...depthChunks].map((c) => c.id))
  const pool = chunks.filter((c) => !consumed.has(c.id))

  let usageParts: KbChunk[] = [...usageChunks]
  let depthParts: KbChunk[] = [...depthChunks]
  const relationsManual = [...relationsChunks]

  if (usageParts.length === 0 && pool.length > 0) {
    usageParts = [pool[0]]
    depthParts = [...depthParts, ...pool.slice(1)]
  } else {
    depthParts = [...depthParts, ...pool]
  }

  const defSnippet = wikiDefinitionSnippet(chunks[0]?.text ?? '', 340)
  const glossaryTerm = keyword.replace(/\*/g, "'")

  const usageBody =
    usageParts.length > 0
      ? usageParts.map((c, i) => wikiChunkBlock(c, i)).join('\n\n---\n\n')
      : WIKI_FILLER.emptySection

  const relationsBody =
    relationsManual.length > 0
      ? `### From indexed sources\n\n${relationsManual.map((c, i) => wikiChunkBlock(c, i)).join('\n\n---\n\n')}\n\n---\n\n### Suggested related entries\n\n${relatedMd}`
      : `### Suggested related entries\n\n${relatedMd}`

  const depthBody =
    depthParts.length > 0
      ? depthParts.map((c, i) => wikiChunkBlock(c, i)).join('\n\n---\n\n')
      : WIKI_FILLER.emptySection

  return [
    '::: glossary',
    `**${glossaryTerm}** — ${defSnippet}`,
    ':::',
    '',
    WIKI_REFERENCE_SECTION_MARKDOWN.practice,
    '',
    usageBody,
    '',
    WIKI_REFERENCE_SECTION_MARKDOWN.related,
    '',
    relationsBody,
    '',
    WIKI_REFERENCE_SECTION_MARKDOWN.notes,
    '',
    depthBody,
    ''
  ].join('\n')
}

/** Individual chunk nodes shown per source before a single “+N more” aggregate node. */
const GRAPH_MAX_CHUNKS_PER_SOURCE = 16
/** Hard cap on chunk-like nodes (real chunks + overflow badges) across the whole library. */
const GRAPH_MAX_TOTAL_CHUNK_SLOTS = 1400
/** Wiki page nodes included in the graph (rest still in KB; graph stays responsive). */
const GRAPH_MAX_WIKI_NODES = 100
/** Title-token “related” edges are O(n²); only computed among the first N sources. */
const GRAPH_MAX_SOURCES_FOR_RELATED = 140

function tokenizeTitle(title: string): string[] {
  const raw = title.toLowerCase().match(/[a-z0-9]{4,}/g)
  return raw ? [...new Set(raw)] : []
}

function semanticToken(label: string): string {
  const words = label
    .replace(/[_:/\\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
  if (words.length === 0) return label.slice(0, 10)
  if (words.length === 1) return words[0].slice(0, 12)
  return `${words[0].slice(0, 8)} ${words[1].slice(0, 8)}`
}

function domainIdFromUri(uri: string): string | undefined {
  const t = uri.trim()
  if (!t) return undefined
  const m = t.match(/^domain:([a-f0-9-]{8,})/i)
  if (m?.[1]) return m[1].toLowerCase()
  if (t.startsWith('chat:')) return 'chat'
  if (t.startsWith('wiki-extract:')) return 'wiki'
  if (t.startsWith('deep-learn:')) return 'research'
  if (t.startsWith('codebase-analysis:')) return 'architecture'
  if (t.startsWith('file://')) return 'documents'
  if (t.startsWith('dms:')) return 'documents'
  return undefined
}

function parseCodebaseAnalysisItems(raw: string): CodebaseAnalysisItem[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: CodebaseAnalysisItem[] = []
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue
      const confidence =
        typeof o.confidence === 'number' && Number.isFinite(o.confidence)
          ? Math.min(1, Math.max(0, o.confidence))
          : 0.55
      out.push({
        name,
        summary: typeof o.summary === 'string' ? o.summary.trim() : '',
        confidence,
        source: o.source === 'llm' || o.source === 'heuristic' ? o.source : 'heuristic',
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

/**
 * Build a structural knowledge graph: KB sources linked to chunk nodes, wiki pages linked to chunks,
 * wiki pages tied to their source when `page_id` is `src:<sourceId>`, and weak `related` edges between
 * sources that share a long token in their titles.
 */
function buildKnowledgeGraphDynamic(db: Database.Database): KnowledgeGraphPayload {
  ensureWikiVersioningBackfill(db)
  const sources = db
    .prepare(`SELECT id, title, uri, created_at as createdAt FROM kb_sources ORDER BY created_at ASC`)
    .all() as { id: string; title: string; uri: string; createdAt: number }[]
  const sourceDomains = new Map<string, string>()
  if (tableExists(db, 'kb_domain_membership')) {
    const rows = db
      .prepare(
        `SELECT source_id as sourceId, domain_id as domainId
         FROM kb_domain_membership
         ORDER BY confidence DESC`
      )
      .all() as Array<{ sourceId: string; domainId: string }>
    for (const row of rows) {
      if (!sourceDomains.has(row.sourceId)) sourceDomains.set(row.sourceId, row.domainId)
    }
  }
  const docBySource = new Map<string, KbDocumentRecord>()
  if (tableExists(db, 'kb_documents')) {
    for (const s of sources) {
      const row = getDocumentRecord(db, s.id)
      if (row) docBySource.set(s.id, row)
    }
  }

  const nodes: KnowledgeGraphNode[] = []
  const edges: KnowledgeGraphEdge[] = []
  let truncated = false
  let chunkSlotsUsed = 0

  for (const s of sources) {
    nodes.push({
      id: s.id,
      kind: 'source',
      label: s.title,
      shortLabel: semanticToken(s.title),
      targetSourceId: s.id,
      domainId: sourceDomains.get(s.id) ?? domainIdFromUri(s.uri),
      confidence: docBySource.get(s.id)?.confidenceScore ?? 0.72,
      novelty: 0.36,
      provenance: 'knowledge-base'
    })
  }

  const chunkStmt = db.prepare(
    `SELECT id, source_id as sourceId, ord, heading, anchor, passage_title as passageTitle FROM kb_chunks WHERE source_id = ? ORDER BY ord ASC`
  )

  for (const s of sources) {
    if (chunkSlotsUsed >= GRAPH_MAX_TOTAL_CHUNK_SLOTS) {
      truncated = true
      break
    }
    const rows = chunkStmt.all(s.id) as {
      id: string
      sourceId: string
      ord: number
      heading: string | null
      anchor: string | null
      passageTitle: string | null
    }[]
    const room = GRAPH_MAX_TOTAL_CHUNK_SLOTS - chunkSlotsUsed
    if (room <= 0) {
      truncated = true
      break
    }
    const perSourceCap = Math.min(GRAPH_MAX_CHUNKS_PER_SOURCE, room)
    const slice = rows.slice(0, perSourceCap)
    if (rows.length > slice.length) truncated = true
    for (const r of slice) {
      const ordLabel = `#${r.ord + 1}`
      const sub =
        (r.passageTitle && r.passageTitle.trim()) || (r.heading && r.heading.trim())
          ? (r.passageTitle || r.heading || '').trim().slice(0, 42) +
            ((r.passageTitle || r.heading || '').trim().length > 42 ? '…' : '')
          : undefined
      nodes.push({
        id: r.id,
        kind: 'chunk',
        label: ordLabel,
        shortLabel: `c${r.ord + 1}`,
        sublabel: sub,
        sourceId: s.id,
        targetSourceId: s.id,
        sectionOrd: r.ord,
        sectionAnchor: r.anchor ?? undefined,
        domainId: sourceDomains.get(s.id) ?? domainIdFromUri(s.uri),
        confidence: Math.max(0.3, (docBySource.get(s.id)?.confidenceScore ?? 0.72) - 0.08),
        novelty: r.heading ? 0.62 : 0.44,
        provenance: 'knowledge-base'
      })
      edges.push({ from: s.id, to: r.id, kind: 'contains', confidence: 0.92, recency: 0.5 })
      chunkSlotsUsed++
    }
    const omitted = rows.length - slice.length
    if (omitted > 0 && chunkSlotsUsed < GRAPH_MAX_TOTAL_CHUNK_SLOTS) {
      const overflowId = `kg-overflow:${s.id}`
      nodes.push({
        id: overflowId,
        kind: 'chunk',
        label: `+${omitted}`,
        shortLabel: `+${omitted}`,
        sublabel: 'chunks not drawn',
        sourceId: s.id,
        domainId: sourceDomains.get(s.id) ?? domainIdFromUri(s.uri),
        confidence: 0.4,
        novelty: 0.2,
        provenance: 'knowledge-base'
      })
      edges.push({ from: s.id, to: overflowId, kind: 'contains', confidence: 0.82, recency: 0.4 })
      chunkSlotsUsed++
    }
  }

  const chunkIds = new Set(nodes.filter((n) => n.kind === 'chunk').map((n) => n.id))
  const sourceIdSet = new Set(sources.map((s) => s.id))
  const sourceToChunkIds = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind !== 'contains') continue
    if (!sourceToChunkIds.has(e.from)) sourceToChunkIds.set(e.from, [])
    sourceToChunkIds.get(e.from)!.push(e.to)
  }

  const entryRowsAll = listActiveWikiEntryRows(db)
  const entryRows =
    entryRowsAll.length > GRAPH_MAX_WIKI_NODES
      ? (() => {
          truncated = true
          return entryRowsAll.slice(0, GRAPH_MAX_WIKI_NODES)
        })()
      : entryRowsAll
  const entryToNodeId = new Map<string, string>()
  for (const entry of entryRows) {
    const wikiNodeId = `wiki-entry:${entry.entryId}`
    entryToNodeId.set(entry.entryId, wikiNodeId)
    const sourceIds = readSourceIdsJson(entry.sourceIdsJson)
    const src = sourceIds.map((sid) => sources.find((s) => s.id === sid)).find(Boolean)
    nodes.push({
      id: wikiNodeId,
      kind: 'wiki',
      label: entry.title,
      shortLabel: semanticToken(entry.title),
      targetSourceId: src?.id,
      domainId: src ? domainIdFromUri(src.uri) : undefined,
      confidence: 0.82,
      novelty: 0.56,
      provenance: 'knowledge-base'
    })
    for (const sid of sourceIds) {
      if (!sourceIdSet.has(sid)) continue
      edges.push({ from: wikiNodeId, to: sid, kind: 'compiled_from', confidence: 0.9, recency: 0.7 })
      const linkedChunks = sourceToChunkIds.get(sid) ?? []
      for (const chunkId of linkedChunks) {
        if (!chunkIds.has(chunkId)) continue
        edges.push({ from: wikiNodeId, to: chunkId, kind: 'indexes', confidence: 0.76, recency: 0.58 })
      }
    }
  }

  if (tableExists(db, 'kb_doc_relations')) {
    const relationRows = db
      .prepare(
        `SELECT from_source_id as fromSourceId, to_source_id as toSourceId, confidence, relation_kind as relationKind
         FROM kb_doc_relations
         ORDER BY confidence DESC
         LIMIT 1200`
      )
      .all() as Array<{ fromSourceId: string; toSourceId: string; confidence: number; relationKind: string }>
    for (const row of relationRows) {
      if (!sourceIdSet.has(row.fromSourceId) || !sourceIdSet.has(row.toSourceId)) continue
      edges.push({
        from: row.fromSourceId,
        to: row.toSourceId,
        kind: row.relationKind === 'semantic_similarity' ? 'semantic_related' : 'related',
        confidence: Math.min(1, Math.max(0.2, Number(row.confidence) || 0.5)),
        recency: 0.58
      })
    }
  }

  const relationRows = db
    .prepare(
      `SELECT id,
              from_entry_id as fromEntryId,
              to_entry_id as toEntryId,
              to_keyword as toKeyword,
              relation_type as relationType,
              confidence,
              source_revision_id as sourceRevisionId
       FROM wiki_keyword_relations`
    )
    .all() as WikiEntryKeywordRelation[]
  const existingNodeIds = new Set(nodes.map((n) => n.id))
  const syntheticByKeyword = new Map<string, string>()
  for (const rel of relationRows) {
    const fromNode = entryToNodeId.get(rel.fromEntryId)
    if (!fromNode) continue
    let toNode: string | undefined
    if (rel.toEntryId) toNode = entryToNodeId.get(rel.toEntryId)
    if (!toNode && rel.toKeyword) {
      const k = normalizeWikiKeyword(rel.toKeyword)
      if (k) {
        if (syntheticByKeyword.has(k)) {
          toNode = syntheticByKeyword.get(k)
        } else {
          const id = `wiki-keyword:${k}`
          const fromTarget = nodes.find((n) => n.id === fromNode)?.targetSourceId
          if (!existingNodeIds.has(id)) {
            nodes.push({
              id,
              kind: 'wiki',
              label: titleCaseKeyword(k),
              shortLabel: semanticToken(k),
              targetSourceId: fromTarget,
              confidence: 0.48,
              novelty: 0.34,
              provenance: 'knowledge-base'
            })
            existingNodeIds.add(id)
          }
          syntheticByKeyword.set(k, id)
          toNode = id
        }
      }
    }
    if (!toNode || toNode === fromNode) continue
    edges.push({
      from: fromNode,
      to: toNode,
      kind: 'semantic_related',
      confidence: Math.min(1, Math.max(0.2, Number(rel.confidence) || 0.5)),
      recency: 0.62
    })
  }

  const titleTokens = new Map<string, string[]>()
  for (const s of sources) {
    titleTokens.set(s.id, tokenizeTitle(s.title))
  }
  const nRel = Math.min(sources.length, GRAPH_MAX_SOURCES_FOR_RELATED)
  if (sources.length > GRAPH_MAX_SOURCES_FOR_RELATED) truncated = true
  for (let i = 0; i < nRel; i++) {
    for (let j = i + 1; j < nRel; j++) {
      const a = titleTokens.get(sources[i].id) ?? []
      const b = titleTokens.get(sources[j].id) ?? []
      if (a.length === 0 || b.length === 0) continue
      const shared = a.some((t) => b.includes(t))
      if (shared) {
        edges.push({ from: sources[i].id, to: sources[j].id, kind: 'related', confidence: 0.52, recency: 0.35 })
      }
    }
  }

  const sourceNodeIds = new Set(nodes.filter((n) => n.kind === 'source').map((n) => n.id))
  const analysisRows = db
    .prepare(
      `SELECT r.id, r.codebase_id as codebaseId, r.kb_source_id as kbSourceId,
              r.domain_model_json as domainModelJson, r.design_patterns_json as designPatternsJson,
              r.architecture_patterns_json as architecturePatternsJson, r.created_at as createdAt
       FROM codebase_analysis_runs r
       JOIN (
         SELECT codebase_id, MAX(created_at) as maxCreated
         FROM codebase_analysis_runs
         GROUP BY codebase_id
       ) latest
       ON latest.codebase_id = r.codebase_id AND latest.maxCreated = r.created_at`
    )
    .all() as Array<{
    id: string
    codebaseId: string
    kbSourceId: string | null
    domainModelJson: string
    designPatternsJson: string
    architecturePatternsJson: string
    createdAt: number
  }>
  for (const row of analysisRows) {
    const sourceId = row.kbSourceId ?? ''
    if (!sourceNodeIds.has(sourceId)) continue
    const facets: Array<{
      key: 'domain_model' | 'design_pattern' | 'architecture_pattern'
      items: CodebaseAnalysisItem[]
    }> = [
      { key: 'domain_model', items: parseCodebaseAnalysisItems(row.domainModelJson) },
      { key: 'design_pattern', items: parseCodebaseAnalysisItems(row.designPatternsJson) },
      { key: 'architecture_pattern', items: parseCodebaseAnalysisItems(row.architecturePatternsJson) }
    ]
    for (const facet of facets) {
      for (const [idx, item] of facet.items.slice(0, 8).entries()) {
        const nodeId = `kg-analysis:${row.id}:${facet.key}:${idx}`
        nodes.push({
          id: nodeId,
          kind: 'chunk',
          label: item.name,
          shortLabel: semanticToken(item.name),
          sublabel: facet.key.replace(/_/g, ' '),
          sourceId,
          domainId: 'architecture',
          confidence: item.confidence,
          novelty: 0.62,
          provenance: 'knowledge-base',
          analysisFacet: facet.key,
          codebaseId: row.codebaseId
        })
        edges.push({
          from: sourceId,
          to: nodeId,
          kind: 'contains',
          confidence: Math.max(0.45, item.confidence),
          recency: 0.72
        })
      }
    }
  }

  return rankStructuralPayload({ nodes, edges, truncated })
}

function buildSemanticKnowledgeGraphDynamic(db: Database.Database): SemanticKnowledgeGraphPayload {
  if (
    !tableExists(db, 'semantic_entities') ||
    !tableExists(db, 'semantic_relations') ||
    !tableExists(db, 'semantic_descriptors') ||
    !tableExists(db, 'semantic_context_scopes') ||
    !tableExists(db, 'semantic_entity_scope_membership') ||
    !tableExists(db, 'semantic_evidence_traces')
  ) {
    return {
      entities: [],
      relations: [],
      descriptors: [],
      scopes: [],
      intersections: [],
      evidence: [],
      truncated: false
    }
  }

  const entities = db
    .prepare(
      `SELECT id, lemma, label, entity_type as entityType, confidence, created_at as createdAt, updated_at as updatedAt
       FROM semantic_entities
       ORDER BY updated_at DESC
       LIMIT 4000`
    )
    .all() as Array<{
    id: string
    lemma: string
    label: string
    entityType: string
    confidence: number
    createdAt: number
    updatedAt: number
  }>

  const relations = db
    .prepare(
      `SELECT id, from_entity_id as fromEntityId, to_entity_id as toEntityId, verb, confidence, created_at as createdAt
       FROM semantic_relations
       ORDER BY created_at DESC
       LIMIT 6000`
    )
    .all() as Array<{
    id: string
    fromEntityId: string
    toEntityId: string
    verb: string
    confidence: number
    createdAt: number
  }>

  const descriptors = db
    .prepare(
      `SELECT id, target_type as targetType, target_id as targetId, adjective, confidence, created_at as createdAt
       FROM semantic_descriptors
       ORDER BY created_at DESC
       LIMIT 6000`
    )
    .all() as Array<{
    id: string
    targetType: 'entity' | 'relation'
    targetId: string
    adjective: string
    confidence: number
    createdAt: number
  }>

  const scopes = db
    .prepare(
      `SELECT id, slug, title, summary, confidence, created_at as createdAt, updated_at as updatedAt
       FROM semantic_context_scopes
       ORDER BY updated_at DESC`
    )
    .all() as Array<{
    id: string
    slug: string
    title: string
    summary: string
    confidence: number
    createdAt: number
    updatedAt: number
  }>

  const memberships = db
    .prepare(
      `SELECT entity_id as entityId, scope_id as scopeId, confidence
       FROM semantic_entity_scope_membership
       ORDER BY confidence DESC`
    )
    .all() as Array<{ entityId: string; scopeId: string; confidence: number }>

  const entityEvidenceRows = db
    .prepare(`SELECT entity_id as entityId, evidence_id as evidenceId FROM semantic_entity_evidence`)
    .all() as Array<{ entityId: string; evidenceId: string }>

  const relationEvidenceRows = db
    .prepare(`SELECT relation_id as relationId, evidence_id as evidenceId FROM semantic_relation_evidence`)
    .all() as Array<{ relationId: string; evidenceId: string }>

  const descriptorEvidenceRows = db
    .prepare(`SELECT descriptor_id as descriptorId, evidence_id as evidenceId FROM semantic_descriptor_evidence`)
    .all() as Array<{ descriptorId: string; evidenceId: string }>

  const evidenceRows = db
    .prepare(
      `SELECT id, source_type as sourceType, source_ref as sourceRef, extraction_method as extractionMethod, rule_id as ruleId,
              span_start as spanStart, span_end as spanEnd, span_text as spanText, span_page as spanPage, span_anchor as spanAnchor,
              confidence, confidence_reasons_json as confidenceReasonsJson, parser_warnings_json as parserWarningsJson,
              fallback_reason as fallbackReason, created_at as createdAt
       FROM semantic_evidence_traces
       ORDER BY created_at DESC
       LIMIT 9000`
    )
    .all() as Array<{
    id: string
    sourceType: EvidenceTrace['sourceType']
    sourceRef: string
    extractionMethod: EvidenceTrace['extractionMethod']
    ruleId: string | null
    spanStart: number | null
    spanEnd: number | null
    spanText: string | null
    spanPage: number | null
    spanAnchor: string | null
    confidence: number
    confidenceReasonsJson: string | null
    parserWarningsJson: string | null
    fallbackReason: string | null
    createdAt: number
  }>

  const scopeIdsByEntity = new Map<string, string[]>()
  for (const row of memberships) {
    if (!scopeIdsByEntity.has(row.entityId)) scopeIdsByEntity.set(row.entityId, [])
    scopeIdsByEntity.get(row.entityId)!.push(row.scopeId)
  }

  const evidenceIdsByEntity = new Map<string, string[]>()
  for (const row of entityEvidenceRows) {
    if (!evidenceIdsByEntity.has(row.entityId)) evidenceIdsByEntity.set(row.entityId, [])
    evidenceIdsByEntity.get(row.entityId)!.push(row.evidenceId)
  }
  const evidenceIdsByRelation = new Map<string, string[]>()
  for (const row of relationEvidenceRows) {
    if (!evidenceIdsByRelation.has(row.relationId)) evidenceIdsByRelation.set(row.relationId, [])
    evidenceIdsByRelation.get(row.relationId)!.push(row.evidenceId)
  }
  const evidenceIdsByDescriptor = new Map<string, string[]>()
  for (const row of descriptorEvidenceRows) {
    if (!evidenceIdsByDescriptor.has(row.descriptorId)) evidenceIdsByDescriptor.set(row.descriptorId, [])
    evidenceIdsByDescriptor.get(row.descriptorId)!.push(row.evidenceId)
  }

  const entityPayload: SemanticEntityNode[] = entities.map((row) => ({
    id: row.id,
    lemma: row.lemma,
    label: row.label,
    type: row.entityType,
    confidence: row.confidence,
    scopeIds: scopeIdsByEntity.get(row.id) ?? [],
    evidenceTraceIds: evidenceIdsByEntity.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }))

  const relationPayload: SemanticRelationEdge[] = relations.map((row) => ({
    id: row.id,
    fromEntityId: row.fromEntityId,
    toEntityId: row.toEntityId,
    verb: row.verb,
    confidence: row.confidence,
    evidenceTraceIds: evidenceIdsByRelation.get(row.id) ?? [],
    createdAt: row.createdAt
  }))

  const descriptorPayload: SemanticDescriptor[] = descriptors.map((row) => ({
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    adjective: row.adjective,
    confidence: row.confidence,
    evidenceTraceId: (evidenceIdsByDescriptor.get(row.id) ?? [])[0],
    createdAt: row.createdAt
  }))

  const scopePayload: SemanticContextScope[] = scopes.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || undefined,
    confidence: row.confidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }))

  const evidencePayload: EvidenceTrace[] = evidenceRows.map((row) => ({
    id: row.id,
    sourceType: row.sourceType ?? 'other',
    sourceRef: row.sourceRef,
    extractionMethod: row.extractionMethod ?? 'heuristic',
    ruleId: row.ruleId ?? undefined,
    ...(row.spanStart != null && row.spanEnd != null
      ? {
          sourceSpan: {
            start: row.spanStart,
            end: row.spanEnd,
            text: row.spanText ?? undefined,
            page: row.spanPage ?? undefined,
            sectionAnchor: row.spanAnchor ?? undefined
          }
        }
      : {}),
    confidence: row.confidence,
    confidenceReasons: parseJsonStringArray(row.confidenceReasonsJson),
    parserWarnings: parseJsonStringArray(row.parserWarningsJson),
    fallbackReason: row.fallbackReason ?? undefined,
    createdAt: row.createdAt
  }))

  const entityIdsByScope = new Map<string, Set<string>>()
  for (const row of memberships) {
    if (!entityIdsByScope.has(row.scopeId)) entityIdsByScope.set(row.scopeId, new Set())
    entityIdsByScope.get(row.scopeId)!.add(row.entityId)
  }

  const intersections: SemanticScopeIntersection[] = []
  const allScopeIds = [...new Set(memberships.map((m) => m.scopeId))]
  for (let i = 0; i < allScopeIds.length; i++) {
    for (let j = i + 1; j < allScopeIds.length; j++) {
      const a = allScopeIds[i]!
      const b = allScopeIds[j]!
      const aSet = entityIdsByScope.get(a) ?? new Set<string>()
      const bSet = entityIdsByScope.get(b) ?? new Set<string>()
      const shared = [...aSet].filter((id) => bSet.has(id))
      if (shared.length === 0) continue
      intersections.push({
        id: `scope-intersection:${a}:${b}`,
        scopeIds: [a, b],
        sharedEntityIds: shared.slice(0, 200),
        label: `Shared terminology (${shared.length})`
      })
    }
  }

  return {
    entities: entityPayload,
    relations: relationPayload,
    descriptors: descriptorPayload,
    scopes: scopePayload,
    intersections,
    evidence: evidencePayload,
    truncated:
      entities.length >= 4000 ||
      relations.length >= 6000 ||
      descriptors.length >= 6000 ||
      evidenceRows.length >= 9000
  }
}

export function getKnowledgeGraph(db: Database.Database): KnowledgeGraphPayload {
  const projected = readProjectedKnowledgeGraph(db)
  if (projected) return projected
  const payload = buildKnowledgeGraphDynamic(db)
  rebuildKnowledgeGraphProjection(db, payload)
  return payload
}

export function getSemanticKnowledgeGraph(db: Database.Database): SemanticKnowledgeGraphPayload {
  const projected = readProjectedSemanticGraph(db)
  if (projected) return projected
  const payload = buildSemanticKnowledgeGraphDynamic(db)
  rebuildSemanticGraphProjection(db, payload)
  return payload
}

const KG_HIGHLIGHT_RELATED_MAX = 4

/**
 * Adds knowledge-graph context for assistant-message keyword tooltips (structured KB + relations).
 */
function enrichWikiHighlightTermsWithKnowledgeGraph(
  terms: WikiChatHighlightTerm[],
  db: Database.Database
): WikiChatHighlightTerm[] {
  if (terms.length === 0) return terms
  const kg = getKnowledgeGraph(db)
  const nodeById = new Map<string, KnowledgeGraphNode>()
  for (const n of kg.nodes) nodeById.set(n.id, n)

  const relatedBySource = new Map<string, Set<string>>()
  for (const e of kg.edges) {
    if (e.kind !== 'related') continue
    const a = nodeById.get(e.from)
    const b = nodeById.get(e.to)
    if (a?.kind !== 'source' || b?.kind !== 'source') continue
    if (!relatedBySource.has(e.from)) relatedBySource.set(e.from, new Set())
    if (!relatedBySource.has(e.to)) relatedBySource.set(e.to, new Set())
    relatedBySource.get(e.from)!.add(b.label)
    relatedBySource.get(e.to)!.add(a.label)
  }

  const chunkCountBySource = new Map<string, number>()
  for (const e of kg.edges) {
    if (e.kind !== 'contains') continue
    const ch = nodeById.get(e.to)
    if (ch?.kind === 'chunk') {
      chunkCountBySource.set(e.from, (chunkCountBySource.get(e.from) ?? 0) + 1)
    }
  }

  const wikiCompiledSources = new Set<string>()
  for (const e of kg.edges) {
    if (e.kind === 'compiled_from') wikiCompiledSources.add(e.to)
  }

  return terms.map((t) => {
    if (!nodeById.has(t.sourceId)) return t
    const parts: string[] = []
    const nCh = chunkCountBySource.get(t.sourceId) ?? 0
    if (nCh > 0) {
      parts.push(`${nCh} chunk${nCh === 1 ? '' : 's'} in the knowledge graph`)
    }
    if (wikiCompiledSources.has(t.sourceId)) {
      parts.push('wiki article compiled from this source')
    }
    const rel = relatedBySource.get(t.sourceId)
    const relList = rel ? [...rel].slice(0, KG_HIGHLIGHT_RELATED_MAX) : []
    if (relList.length > 0) {
      parts.push(`related: ${relList.join(' · ')}`)
    }
    if (kg.truncated && nCh > 0) {
      parts.push('graph shows a subset of chunks')
    }
    const graphSummary = parts.length > 0 ? parts.join(' · ') : 'Linked in your knowledge graph'
    return { ...t, graphSummary }
  })
}

export function ensureWikiPageForSource(db: Database.Database, sourceId: string): { id: string; title: string; body: string } {
  const s = db.prepare('SELECT id, title FROM kb_sources WHERE id = ?').get(sourceId) as
    | { id: string; title: string }
    | undefined
  if (!s) throw new Error('source not found')
  const body = getWikiPageBody(db, sourceId)
  const t = Date.now()
  const pageId = `src:${sourceId}`
  const existing = db.prepare('SELECT id FROM wiki_pages WHERE id = ?').get(pageId) as { id: string } | undefined
  if (existing) {
    db.prepare('UPDATE wiki_pages SET body = ?, title = ?, updated_at = ? WHERE id = ?').run(
      body,
      s.title,
      t,
      existing.id
    )
  } else {
    db.prepare(
      'INSERT INTO wiki_pages (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(pageId, s.title, body, t, t)
    const chs = db.prepare('SELECT id FROM kb_chunks WHERE source_id = ?').all(sourceId) as { id: string }[]
    const link = db.prepare('INSERT OR IGNORE INTO wiki_page_chunks (page_id, chunk_id) VALUES (?, ?)')
    for (const c of chs) link.run(pageId, c.id)
  }
  if (hasWikiEntryTables(db)) {
    const canonical = normalizeWikiKeyword(s.title) || normalizeWikiKeyword(`topic ${sourceId.slice(0, 8)}`)
    const mapped = db
      .prepare('SELECT entry_id as entryId FROM wiki_entry_sources WHERE source_id = ?')
      .get(sourceId) as { entryId: string } | undefined
    let entryId = mapped?.entryId
    if (!entryId) {
      const existingEntry = db
        .prepare('SELECT id FROM wiki_entries WHERE canonical_keyword = ? LIMIT 1')
        .get(canonical) as { id: string } | undefined
      entryId = existingEntry?.id ?? insertWikiEntryForKeyword(db, canonical)
      db.prepare('INSERT OR REPLACE INTO wiki_entry_sources (entry_id, source_id) VALUES (?, ?)').run(entryId, sourceId)
      const hasRevision = db
        .prepare('SELECT 1 as ok FROM wiki_entry_revisions WHERE entry_id = ? LIMIT 1')
        .get(entryId) as { ok: number } | undefined
      if (!hasRevision?.ok) {
        createWikiEntryRevision(db, {
          entryId,
          title: titleCaseKeyword(canonical),
          body,
          modelId: null,
          promptVersion: 'source-sync',
          sourceIds: [sourceId]
        })
      }
    }
  }
  return { id: pageId, title: s.title, body }
}

const RELATED_CHUNK_SAMPLE = 3
const RELATED_BODY_CAP = 12_000
const WIKI_RAW_SOURCE_PREVIEW_CHARS = 2200
const WIKI_RAW_CHUNK_PREVIEW_LIMIT = 24

/** Other sources that share topical tokens with this article (title + first chunks). */
export function listRelatedWikiSources(
  db: Database.Database,
  sourceId: string,
  limit: number
): WikiRelatedSource[] {
  const self = db.prepare('SELECT id, title, uri FROM kb_sources WHERE id = ?').get(sourceId) as
    | { id: string; title: string; uri: string }
    | undefined
  if (!self) return []

  const chunkStmt = db.prepare(
    `SELECT text FROM kb_chunks WHERE source_id = ? ORDER BY ord LIMIT ${RELATED_CHUNK_SAMPLE}`
  )
  function tokensFor(sid: string, title: string): Set<string> {
    const rows = chunkStmt.all(sid) as { text: string }[]
    const blob = `${title}\n${rows.map((r) => r.text).join('\n')}`.slice(0, RELATED_BODY_CAP)
    const raw = blob.toLowerCase().match(/[a-z0-9]{4,}/g)
    return new Set(raw ?? [])
  }

  const selfTokens = tokensFor(sourceId, self.title)
  if (selfTokens.size === 0) return []

  const others = db
    .prepare('SELECT id, title, uri FROM kb_sources WHERE id != ?')
    .all(sourceId) as { id: string; title: string; uri: string }[]

  const scored: { o: (typeof others)[0]; shared: string[]; score: number }[] = []
  for (const o of others) {
    const oTokens = tokensFor(o.id, o.title)
    const shared = [...oTokens].filter((t) => selfTokens.has(t))
    if (shared.length === 0) continue
    scored.push({ o, shared, score: shared.length })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(({ o, shared }) => ({
    id: o.id,
    title: o.title,
    kind: wikiKindFromUri(o.uri),
    sharedTerms: [...shared].sort((x, y) => y.length - x.length || x.localeCompare(y)).slice(0, 8)
  }))
}

function listEvidenceTraceIdsForSource(db: Database.Database, sourceId: string, limit = 40): string[] {
  if (!tableExists(db, 'semantic_evidence_traces')) return []
  const rows = db
    .prepare(
      `SELECT id
       FROM semantic_evidence_traces
       WHERE source_ref = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(sourceId, Math.max(1, limit)) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

function buildWikiPageMetadata(
  db: Database.Database,
  sourceId: string,
  title: string,
  confidence: KbImportConfidence | undefined,
  activeEntry?: WikiEntryActiveRevisionRow
): WikiPageMetadata {
  const source = db
    .prepare(
      `SELECT s.id as sourceId,
              s.title as sourceTitle,
              s.uri as sourceUri,
              s.created_at as importedAt,
              d.id as domainId,
              d.title as domainTitle
       FROM kb_sources s
       LEFT JOIN kb_domain_membership dm ON dm.source_id = s.id
       LEFT JOIN kb_domains d ON d.id = dm.domain_id
       WHERE s.id = ?
       LIMIT 1`
    )
    .get(sourceId) as
    | {
        sourceId: string
        sourceTitle: string
        sourceUri: string
        importedAt: number
        domainId: string | null
        domainTitle: string | null
      }
    | undefined
  const chunkCount = Number(
    (db.prepare('SELECT COUNT(*) as c FROM kb_chunks WHERE source_id = ?').get(sourceId) as { c: number } | undefined)?.c ?? 0
  )
  const sourceUri = source?.sourceUri ?? `src:${sourceId}`
  return {
    sourceId,
    sourceTitle: title,
    sourceKind: wikiKindFromUri(sourceUri),
    sourceUri,
    importedAt: source?.importedAt,
    updatedAt: activeEntry?.updatedAt,
    chunkCount,
    domainId: source?.domainId ?? undefined,
    domainTitle: source?.domainTitle ?? undefined,
    confidence,
    revisionId: activeEntry?.revisionId,
    revisionVersion: activeEntry?.versionNo,
    promptVersion: activeEntry?.promptVersion ?? undefined
  }
}

function buildWikiRawReference(doc: KbDocumentRecord | null, passages: WikiPassageSummary[]): WikiRawReferencePayload {
  const sourceText = (doc?.sourceRawText || doc?.rawText || '').trim()
  const sourceTextPreview =
    sourceText.length > WIKI_RAW_SOURCE_PREVIEW_CHARS
      ? `${sourceText.slice(0, WIKI_RAW_SOURCE_PREVIEW_CHARS)}...`
      : sourceText
  return {
    sourceTextPreview,
    sourceTextLength: sourceText.length,
    totalChunkCount: passages.length,
    chunks: passages.slice(0, WIKI_RAW_CHUNK_PREVIEW_LIMIT).map((p) => ({
      chunkId: p.chunkId,
      ord: p.ord,
      heading: p.heading,
      title: p.title,
      anchor: p.anchor,
      snippet: p.snippet,
      wordCount: p.wordCount
    }))
  }
}

/** Sync wiki page row, then return payload for the renderer (glossary stripped from body). */
export function buildWikiPagePayload(db: Database.Database, sourceId: string): WikiPagePayload {
  ensureWikiVersioningBackfill(db)
  const doc = getDocumentRecord(db, sourceId)
  const confidence = doc
    ? ({
        score: doc.confidenceScore,
        reasons: doc.confidenceReasons
      } satisfies KbImportConfidence)
    : undefined
  const passages = listWikiPassages(db, sourceId)
  const suggestedKeywords = suggestWikiKeywords(
    db,
    sourceId,
    passages.slice(0, 24).map((p) => p.chunkId),
    12
  )
  const activeEntry = resolveActiveWikiEntryForSource(db, sourceId)
  if (activeEntry) {
    const { body, glossary } = extractWikiGlossary(stripWikiControlMarkers(activeEntry.body))
    const metadata = buildWikiPageMetadata(db, sourceId, activeEntry.title, confidence, activeEntry)
    const rawReference = buildWikiRawReference(doc, passages)
    const evidenceTraceIds = listEvidenceTraceIdsForSource(db, sourceId, 40)
    return {
      id: `src:${sourceId}`,
      title: activeEntry.title,
      summaryMarkdown: body,
      metadata,
      rawReference,
      sourceId,
      evidenceTraceIds,
      relatedGraphNodeIds: [sourceId, ...passages.slice(0, 12).map((p) => p.chunkId)],
      body,
      confidence,
      glossary,
      relatedSources: listRelatedWikiSources(db, sourceId, 12),
      passages,
      suggestedKeywords
    }
  }
  const page = ensureWikiPageForSource(db, sourceId)
  const { body, glossary } = extractWikiGlossary(stripWikiControlMarkers(page.body))
  const metadata = buildWikiPageMetadata(db, sourceId, page.title, confidence)
  const rawReference = buildWikiRawReference(doc, passages)
  const evidenceTraceIds = listEvidenceTraceIdsForSource(db, sourceId, 40)
  return {
    id: page.id,
    title: page.title,
    summaryMarkdown: body,
    metadata,
    rawReference,
    sourceId,
    evidenceTraceIds,
    relatedGraphNodeIds: [sourceId, ...passages.slice(0, 12).map((p) => p.chunkId)],
    body,
    confidence,
    glossary,
    relatedSources: listRelatedWikiSources(db, sourceId, 12),
    passages,
    suggestedKeywords
  }
}

type WikiReanalysisEntryInput = {
  canonicalKeyword: string
  title: string
  body: string
  sourceIds: string[]
  relations: Array<{ toKeyword: string; relationType: string; confidence: number }>
}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0.5
  return Math.min(1, Math.max(0, v))
}

export function applyWikiReanalysis(
  db: Database.Database,
  args: {
    modelId: string
    promptVersion?: string
    entries: WikiReanalysisEntryInput[]
  }
): WikiReanalyzeResult {
  ensureWikiVersioningBackfill(db)
  if (!hasWikiEntryTables(db)) {
    throw new Error('Wiki entry tables are unavailable. Restart after migrations are applied.')
  }
  const sourceSet = new Set(listSources(db).map((s) => s.id))
  const tx = db.transaction(() => {
    const keywordToEntry = new Map<string, string>()
    const entryToRevision = new Map<string, string>()
    let mergedCount = 0
    const mappedSources = new Set<string>()

    db.prepare('DELETE FROM wiki_entry_sources').run()
    db.prepare('DELETE FROM wiki_keyword_relations').run()

    for (const e of args.entries) {
      const canonical = normalizeWikiKeyword(e.canonicalKeyword)
      if (!canonical) continue
      let entryId = keywordToEntry.get(canonical)
      if (!entryId) {
        const existing = db
          .prepare('SELECT id FROM wiki_entries WHERE canonical_keyword = ? LIMIT 1')
          .get(canonical) as { id: string } | undefined
        entryId = existing?.id ?? insertWikiEntryForKeyword(db, canonical)
        keywordToEntry.set(canonical, entryId)
      } else {
        mergedCount++
      }
      const usableSources = [...new Set(e.sourceIds.filter((sid) => sourceSet.has(sid)))]
      const sourceIds = usableSources.length > 0 ? usableSources : []
      for (const sid of sourceIds) {
        db.prepare('INSERT OR REPLACE INTO wiki_entry_sources (entry_id, source_id) VALUES (?, ?)').run(entryId, sid)
        mappedSources.add(sid)
      }
      const title = e.title.trim() || titleCaseKeyword(canonical)
      const body = e.body.trim() || `::: glossary\n**${titleCaseKeyword(canonical)}** — No distilled definition was generated.\n:::`
      const { revisionId } = createWikiEntryRevision(db, {
        entryId,
        title,
        body,
        modelId: args.modelId,
        promptVersion: args.promptVersion ?? WIKI_REANALYZE_PROMPT_VERSION,
        sourceIds
      })
      entryToRevision.set(entryId, revisionId)
    }

    const orphanSources = [...sourceSet].filter((sid) => !mappedSources.has(sid))
    for (const sid of orphanSources) {
      const source = db.prepare('SELECT title FROM kb_sources WHERE id = ?').get(sid) as { title: string } | undefined
      const canonical = normalizeWikiKeyword(source?.title ?? sid)
      let entryId = keywordToEntry.get(canonical)
      if (!entryId) {
        const existing = db
          .prepare('SELECT id FROM wiki_entries WHERE canonical_keyword = ? LIMIT 1')
          .get(canonical) as { id: string } | undefined
        entryId = existing?.id ?? insertWikiEntryForKeyword(db, canonical)
        keywordToEntry.set(canonical, entryId)
      }
      db.prepare('INSERT OR REPLACE INTO wiki_entry_sources (entry_id, source_id) VALUES (?, ?)').run(entryId, sid)
      if (!entryToRevision.has(entryId)) {
        const body = defaultWikiBodyForSource(db, sid)
        const { revisionId } = createWikiEntryRevision(db, {
          entryId,
          title: titleCaseKeyword(canonical),
          body,
          modelId: args.modelId,
          promptVersion: 'auto-fallback',
          sourceIds: [sid]
        })
        entryToRevision.set(entryId, revisionId)
      }
    }

    const existingEntryByKeyword = new Map<string, string>()
    const allEntries = db
      .prepare('SELECT id, canonical_keyword as canonicalKeyword FROM wiki_entries')
      .all() as { id: string; canonicalKeyword: string }[]
    for (const r of allEntries) existingEntryByKeyword.set(r.canonicalKeyword, r.id)

    for (const e of args.entries) {
      const fromCanonical = normalizeWikiKeyword(e.canonicalKeyword)
      const fromEntry = existingEntryByKeyword.get(fromCanonical)
      if (!fromEntry) continue
      const revisionId = entryToRevision.get(fromEntry)
      if (!revisionId) continue
      for (const rel of e.relations) {
        const toKeyword = normalizeWikiKeyword(rel.toKeyword)
        if (!toKeyword || toKeyword === fromCanonical) continue
        const toEntryId = existingEntryByKeyword.get(toKeyword)
        db.prepare(
          `INSERT INTO wiki_keyword_relations
            (id, from_entry_id, to_entry_id, to_keyword, relation_type, confidence, source_revision_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          fromEntry,
          toEntryId ?? null,
          toKeyword,
          rel.relationType.trim().slice(0, 96) || 'related',
          clampConfidence(rel.confidence),
          revisionId,
          Date.now()
        )
      }
    }

    const processedEntries = Number(
      (db.prepare('SELECT COUNT(*) as c FROM wiki_entries').get() as { c: number } | undefined)?.c ?? 0
    )
    return {
      ok: true,
      processedSources: sourceSet.size,
      processedEntries,
      mergedEntries: mergedCount,
      skippedSources: 0,
      modelId: args.modelId,
      promptVersion: args.promptVersion ?? WIKI_REANALYZE_PROMPT_VERSION
    } satisfies WikiReanalyzeResult
  })
  const summary = tx()
  refreshGraphProjectionsBestEffort(db)
  return summary
}

function safeWikiExportFileStem(title: string): string {
  return (
    title
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 72) || 'untitled'
  )
}

function uniqueWikiExportFileName(title: string, sourceId: string, used: Set<string>): string {
  const base = safeWikiExportFileStem(title)
  let name = `${base}__${sourceId.slice(0, 8)}.md`
  let n = 1
  const key = (): string => name.toLowerCase()
  while (used.has(key())) {
    name = `${base}__${sourceId.slice(0, 8)}_${n++}.md`
  }
  used.add(key())
  return name
}

/** Write all KB sources as Markdown (compiled from chunks) plus manifest into a ZIP at `outPath`. */
export async function exportWikiZip(db: Database.Database, outPath: string): Promise<void> {
  const rows = db
    .prepare(
      `SELECT id, title, uri, created_at as createdAt, conversation_id as conversationId
       FROM kb_sources ORDER BY created_at ASC`
    )
    .all() as {
      id: string
      title: string
      uri: string
      createdAt: number
      conversationId: string | null
    }[]

  const output = createWriteStream(outPath)
  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })

  const outputClosed = finished(output)
  archive.pipe(output)

  const usedNames = new Set<string>()
  const manifestSources: {
    id: string
    title: string
    uri: string
    kind: WikiSourceKind
    file: string
    createdAt: number
    conversationId: string | null
  }[] = []

  for (const s of rows) {
    const fileName = uniqueWikiExportFileName(s.title, s.id, usedNames)
    const zipPath = `wiki-sources/${fileName}`
    const body = getWikiPageBody(db, s.id)
    const h1 = s.title.replace(/\r?\n/g, ' ').trim() || 'Untitled'
    const md = `# ${h1}\n\n${body}\n`
    archive.append(md, { name: zipPath })
    manifestSources.push({
      id: s.id,
      title: s.title,
      uri: s.uri,
      kind: wikiKindFromUri(s.uri),
      file: zipPath,
      createdAt: s.createdAt,
      conversationId: s.conversationId
    })
  }

  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'local-llm-desktop',
    sourceCount: manifestSources.length,
    sources: manifestSources
  }
  archive.append(JSON.stringify(manifest, null, 2), { name: 'wiki-manifest.json' })
  archive.append(
    [
      '# Wiki export',
      '',
      'Generated by **Local LLM Desktop**. Each file under `wiki-sources/` matches the compiled wiki body shown in the app (reference layout: glossary plus practice, related concepts, and notes — built from indexed chunks and suggested related titles).',
      '',
      'Metadata: `wiki-manifest.json` (ids, URIs, kinds, timestamps).',
      ''
    ].join('\n'),
    { name: 'README.md' }
  )

  await archive.finalize()
  await outputClosed
}

export function listBackfillCandidates(
  db: Database.Database,
  targetExtractionVersion: string,
  limit = 120
): Array<{ sourceId: string; title: string; extractionVersion: string | null; confidenceScore: number | null }> {
  if (!tableExists(db, 'kb_documents')) return []
  return db
    .prepare(
      `SELECT s.id as sourceId,
              s.title as title,
              d.extraction_version as extractionVersion,
              d.confidence_score as confidenceScore
       FROM kb_sources s
       LEFT JOIN kb_documents d ON d.source_id = s.id
       WHERE COALESCE(d.extraction_version, '') != ?
       ORDER BY s.created_at DESC
       LIMIT ?`
    )
    .all(targetExtractionVersion, Math.max(1, Math.min(limit, 1000))) as Array<{
    sourceId: string
    title: string
    extractionVersion: string | null
    confidenceScore: number | null
  }>
}

export async function runImportBenchmarkAndPersist(
  db: Database.Database,
  corpusPath: string
): Promise<ImportBenchmarkSummary> {
  const summary = await runDocumentImportBenchmark(corpusPath)
  if (tableExists(db, 'kb_import_benchmark_runs')) {
    db.prepare(
      `INSERT INTO kb_import_benchmark_runs (id, corpus_path, metrics_json, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(randomUUID(), corpusPath, JSON.stringify(summary), Date.now())
  }
  return summary
}

export function markBackfillQueued(
  db: Database.Database,
  args: {
    sourceId: string
    previousExtractionVersion?: string | null
    nextExtractionVersion: string
    details?: Record<string, unknown>
  }
): void {
  if (!tableExists(db, 'kb_import_backfill_runs')) return
  const now = Date.now()
  db.prepare(
    `INSERT INTO kb_import_backfill_runs
      (id, source_id, previous_extraction_version, next_extraction_version, status, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    args.sourceId,
    args.previousExtractionVersion ?? null,
    args.nextExtractionVersion,
    'queued',
    JSON.stringify(args.details ?? {}),
    now,
    now
  )
}
