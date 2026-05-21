import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrate } from '../db/migrations'
import {
  buildWikiPagePayload,
  cleanupWikiArticle,
  extractWikiArticlesFromSource,
  getDocumentRecord,
  getKnowledgeGraph,
  getSemanticKnowledgeGraph,
  ingestFile,
  ingestText,
  listIngestJobs,
  listKnowledgeDomains,
  listWikiTopics,
  setSourceDomain,
  resolveWikiTerm
} from './kbService'
import type { RuntimeAdapter } from './runtime/types'

describe('kbService structured wiki flow', () => {
  let db: Database.Database
  const canOpenSqlite = (() => {
    try {
      const probe = new Database(':memory:')
      probe.close()
      return true
    } catch {
      return false
    }
  })()
  const maybeIt = canOpenSqlite ? it : it.skip

  afterEach(() => {
    if (db) db.close()
  })

  maybeIt('stores passage metadata and enforces concise passage titles', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(
      db,
      'Latex Handbook',
      'file://handbook.md',
      '# Intro\n\nThis is an intentionally long paragraph about equations and wiki extraction behavior.\n\n## Details\n\nMore details follow for navigation.'
    )
    const rows = db
      .prepare(
        'SELECT heading, anchor, passage_title as passageTitle FROM kb_chunks WHERE source_id = ? ORDER BY ord'
      )
      .all(src.id) as Array<{ heading: string | null; anchor: string | null; passageTitle: string | null }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => Boolean(r.anchor))).toBe(true)
    expect(rows.every((r) => (r.passageTitle ?? '').split(/\s+/).filter(Boolean).length <= 30)).toBe(true)
  })

  maybeIt('builds wiki payload with passages and keyword candidates', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(
      db,
      'Graph Theory',
      'file://graph.md',
      '## Overview\nNodes and edges connect concepts.\n\n## Algorithms\nShortest path and flow.'
    )
    const payload = buildWikiPagePayload(db, src.id)
    expect(payload.passages.length).toBeGreaterThan(0)
    expect(payload.suggestedKeywords.length).toBeGreaterThan(0)
    expect(payload.confidence?.score ?? 0).toBeGreaterThan(0)
    expect(payload.summaryMarkdown.length).toBeGreaterThan(0)
    expect(payload.metadata?.sourceId).toBe(src.id)
    expect(payload.rawReference?.totalChunkCount).toBe(payload.passages.length)
  })

  maybeIt('extracts selected passages into a separate article', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(
      db,
      'Compiler Notes',
      'file://compiler.md',
      '## Lexer\nTokenization and scanning.\n\n## Parser\nAST generation details.'
    )
    const chunks = db
      .prepare('SELECT id FROM kb_chunks WHERE source_id = ? ORDER BY ord')
      .all(src.id) as Array<{ id: string }>
    const res = extractWikiArticlesFromSource(db, {
      sourceId: src.id,
      keyword: 'parser',
      chunkIds: [chunks[1]?.id ?? chunks[0]!.id]
    })
    expect(res.sourceId).toBeTruthy()
    expect(res.chunkCount).toBe(1)
  })

  maybeIt('emits graph nodes with destination metadata for deep-linking', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(db, 'Routing Guide', 'file://routing.md', '## Section\nClick path example.')
    const kg = getKnowledgeGraph(db)
    const chunkNode = kg.nodes.find((n) => n.kind === 'chunk' && n.sourceId === src.id)
    expect(chunkNode?.targetSourceId).toBe(src.id)
    expect(typeof chunkNode?.sectionOrd).toBe('number')
    const sourceNode = kg.nodes.find((n) => n.id === src.id)
    expect(sourceNode?.targetSourceId).toBe(src.id)
    expect((sourceNode?.confidence ?? 0) > 0).toBe(true)
  })

  maybeIt('stores raw and distilled document records', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(db, 'Signal Processing', 'file://signal.md', 'Line one.\nLine two.\n\nLine three.')
    const doc = getDocumentRecord(db, src.id)
    expect(doc).not.toBeNull()
    expect(doc?.rawText.length ?? 0).toBeGreaterThan(0)
    expect(doc?.distilledBody).toContain('::: glossary')
  })

  maybeIt('tracks ingest jobs and enriches graph relations/domains', async () => {
    db = new Database(':memory:')
    migrate(db)
    const a = ingestText(db, 'Network Security', 'file://security.md', 'Threat modeling and network controls.')
    const b = ingestText(db, 'Security Posture', 'file://posture.md', 'Risk posture and controls for endpoints.')
    expect(a.id).not.toBe(b.id)
    const jobs = listIngestJobs(db, 10)
    expect(Array.isArray(jobs)).toBe(true)
    const hasDomainMembership = db
      .prepare('SELECT COUNT(*) as c FROM kb_domain_membership')
      .get() as { c: number }
    expect(hasDomainMembership.c).toBeGreaterThan(0)
    const hasRelations = db
      .prepare('SELECT COUNT(*) as c FROM kb_doc_relations')
      .get() as { c: number }
    expect(hasRelations.c).toBeGreaterThan(0)
    const kg = getKnowledgeGraph(db)
    const related = kg.edges.filter((e) => e.kind === 'related' || e.kind === 'semantic_related')
    expect(related.length).toBeGreaterThan(0)
  })

  maybeIt('builds semantic graph payload with noun entities and verb relations', () => {
    db = new Database(':memory:')
    migrate(db)
    ingestText(db, 'Transit', 'file://transit.md', 'Bus uses Route. Route is a transport concept.')
    ingestText(db, 'Energy', 'file://energy.md', 'Grid uses Route for monitoring context.')
    const semantic = getSemanticKnowledgeGraph(db)
    expect(semantic.entities.length).toBeGreaterThan(0)
    expect(semantic.relations.length).toBeGreaterThan(0)
    expect(semantic.relations.some((r) => r.verb.includes('uses'))).toBe(true)
    expect(Array.isArray(semantic.evidence)).toBe(true)
  })

  maybeIt('allows manual domain assignment for a document', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(db, 'Infra Notes', 'file://infra.md', 'Kubernetes deployment and observability.')
    const assigned = setSourceDomain(db, { sourceId: src.id, domainTitle: 'Platform Engineering' })
    expect(assigned.ok).toBe(true)
    const topics = listWikiTopics(db)
    const topic = topics.find((t) => t.id === src.id)
    expect(topic?.domainTitle).toBe('Platform Engineering')
    const domains = listKnowledgeDomains(db)
    expect(domains.some((d) => d.title === 'Platform Engineering')).toBe(true)
  })

  maybeIt('resolves clicked terms to existing pages', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(db, 'Event Sourcing', 'file://event.md', 'A pattern for event-driven persistence.')
    const resolved = resolveWikiTerm(db, { term: 'event sourcing', contextSourceId: src.id })
    expect(resolved.matched).toBe(true)
    expect(resolved.sourceId).toBe(src.id)
  })

  maybeIt('prevents duplicate ingest for the same file path', async () => {
    db = new Database(':memory:')
    migrate(db)
    const dir = mkdtempSync(join(tmpdir(), 'kb-ingest-'))
    const filePath = join(dir, 'duplicate-check.txt')
    writeFileSync(filePath, 'duplicate test content', 'utf8')
    try {
      await ingestFile(db, filePath)
      await expect(ingestFile(db, filePath)).rejects.toThrow(/already in your wiki library/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  maybeIt('marks auto cleanup metadata when runtime is unavailable', async () => {
    db = new Database(':memory:')
    migrate(db)
    const dir = mkdtempSync(join(tmpdir(), 'kb-cleanup-auto-'))
    const filePath = join(dir, 'auto-cleanup.txt')
    writeFileSync(filePath, 'Messy   spacing\n\n\n-Item one\n-Item two', 'utf8')
    try {
      const src = await ingestFile(db, filePath)
      const doc = getDocumentRecord(db, src.id)
      expect(doc).not.toBeNull()
      expect(doc?.diagnostics.cleanupMode).toBe('heuristic')
      expect(doc?.diagnostics.cleanupPromptVersion).toMatch(/2026-05-10/)
      expect(doc?.diagnostics.cleanupFallbackReason).toBe('runtime_unavailable')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  maybeIt('stores original raw import text for re-processing', async () => {
    db = new Database(':memory:')
    migrate(db)
    const dir = mkdtempSync(join(tmpdir(), 'kb-raw-source-'))
    const filePath = join(dir, 'raw-source.txt')
    const original = 'Author: Jane\n\n## Intro\n-Item one\nLine\twith   spacing'
    writeFileSync(filePath, original, 'utf8')
    try {
      const src = await ingestFile(db, filePath)
      const doc = getDocumentRecord(db, src.id)
      expect(doc).not.toBeNull()
      expect(doc?.sourceRawText).toBe(original)
      expect((doc?.rawText ?? '')).not.toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  maybeIt('uses runtime summary generation during file ingest when available', async () => {
    db = new Database(':memory:')
    migrate(db)
    const dir = mkdtempSync(join(tmpdir(), 'kb-summary-llm-'))
    const filePath = join(dir, 'summary-llm.txt')
    writeFileSync(filePath, '## Intro\nThis source explains deploy orchestration in distributed systems.', 'utf8')
    let callCount = 0
    const runtime: RuntimeAdapter = {
      kind: 'ollama',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'ollama', modelPath: 'mock-summary-model' } as any
      },
      async chat() {
        callCount += 1
        if (callCount === 1) {
          return '<clean_markdown>\n## Intro\nThis source explains deploy orchestration in distributed systems.\n</clean_markdown>'
        }
        return '<wiki-title>summary-llm.txt</wiki-title>\n::: glossary\n**summary-llm.txt** -- Deploy orchestration reference.\n:::\n\n## Summary\n- Coordinates deployment stages.\n\n## Key Details\n- Tracks workers and retries.\n\n## Caveats\n- Source omits failure budgets.'
      }
    }
    try {
      const src = await ingestFile(db, filePath, undefined, undefined, runtime)
      const doc = getDocumentRecord(db, src.id)
      expect(doc?.diagnostics.summaryMode).toBe('llm')
      expect(doc?.diagnostics.summaryPromptVersion).toMatch(/wiki-summary-ingest/)
      expect(doc?.distilledBody).toContain('## Summary')
      const payload = buildWikiPagePayload(db, src.id)
      expect(payload.summaryMarkdown).toContain('## Summary')
      expect(payload.metadata?.confidence?.score ?? 0).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  maybeIt('cleans up an existing article with llm mode and updates diagnostics', async () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(db, 'Cleanup Candidate', 'file://cleanup.md', '## Intro\nBad   spacing and list\n-Item one')
    const runtime: RuntimeAdapter = {
      kind: 'ollama',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'ollama', modelPath: 'mock-model' } as any
      },
      async chat() {
        return '<clean_markdown>\n## Intro\nBad spacing and list\n- Item one\n</clean_markdown>'
      }
    }
    const result = await cleanupWikiArticle(db, src.id, runtime)
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('llm')
    const payload = buildWikiPagePayload(db, src.id)
    expect(payload.body).toContain('- Item one')
    const doc = getDocumentRecord(db, src.id)
    expect(doc?.diagnostics.cleanupMode).toBe('llm')
    expect(doc?.diagnostics.cleanupPromptVersion).toBe(result.promptVersion)
  })
})
