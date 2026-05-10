import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrations'
import {
  buildWikiPagePayload,
  extractWikiArticlesFromSource,
  getDocumentRecord,
  getKnowledgeGraph,
  ingestText,
  listIngestJobs,
  resolveWikiTerm
} from './kbService'

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

  maybeIt('resolves clicked terms to existing pages', () => {
    db = new Database(':memory:')
    migrate(db)
    const src = ingestText(db, 'Event Sourcing', 'file://event.md', 'A pattern for event-driven persistence.')
    const resolved = resolveWikiTerm(db, { term: 'event sourcing', contextSourceId: src.id })
    expect(resolved.matched).toBe(true)
    expect(resolved.sourceId).toBe(src.id)
  })
})
