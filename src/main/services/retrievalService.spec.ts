import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import { retrieveChunks, retrieveKbHits } from './retrievalService'
import { ingestText } from './kbService'
import { setSourceDomain } from './kbService'

const sqliteAvailable = (() => {
  try {
    const probe = new Database(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('retrievalService', () => {
  it('returns lexical results with deterministic scoring fields', () => {
    const db = new Database(':memory:')
    migrate(db)
    ingestText(db, 'Routing', 'file://routing.md', 'Routing protocol selection and gateway metrics.')
    const hits = retrieveChunks(db, { query: 'routing protocol', limit: 8 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.lexicalScore).toBeTypeOf('number')
    expect(hits[0]?.finalScore).toBeGreaterThanOrEqual(hits[0]?.lexicalScore ?? 0)
    db.close()
  })

  it('supports optional domain filtering', () => {
    const db = new Database(':memory:')
    migrate(db)
    const sourceA = ingestText(db, 'Platform K8s', 'file://k8s.md', 'Kubernetes cluster autoscaling and pods.')
    const sourceB = ingestText(db, 'Marketing', 'file://mkt.md', 'Campaign insights and brand strategy.')
    setSourceDomain(db, { sourceId: sourceA.id, domainTitle: 'Platform Engineering' })
    setSourceDomain(db, { sourceId: sourceB.id, domainTitle: 'Business' })
    const platformDomain = db
      .prepare('SELECT id FROM kb_domains WHERE title = ? LIMIT 1')
      .get('Platform Engineering') as { id: string } | undefined
    expect(platformDomain?.id).toBeTruthy()
    const hits = retrieveChunks(db, {
      query: 'cluster autoscaling',
      limit: 10,
      domainIds: platformDomain ? [platformDomain.id] : []
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.sourceId === sourceA.id)).toBe(true)
    db.close()
  })

  it('returns one best hit per source via retrieveKbHits', () => {
    const db = new Database(':memory:')
    migrate(db)
    const src = ingestText(
      db,
      'Observability',
      'file://obs.md',
      'Metrics first. Metrics and traces combined. Metrics improve alerting.'
    )
    const rows = retrieveKbHits(db, { query: 'metrics', limit: 5 })
    expect(rows.some((r) => r.sourceId === src.id)).toBe(true)
    const fromSource = rows.filter((r) => r.sourceId === src.id)
    expect(fromSource.length).toBe(1)
    db.close()
  })

  it('adds graph-neighborhood boost into semantic scoring', () => {
    const db = new Database(':memory:')
    migrate(db)
    ingestText(
      db,
      'Graph Explainability',
      'file://graph-explain.md',
      'Engine uses indexing pipeline. The pipeline improves retrieval ranking.'
    )
    const hits = retrieveChunks(db, { query: 'indexing', limit: 6 })
    expect(hits.length).toBeGreaterThan(0)
    const top = hits[0]!
    const baselineOverlap = 0.35 // one-token query with one hit -> 1 * 0.35
    expect(top.semanticScore).toBeGreaterThanOrEqual(baselineOverlap)
    db.close()
  })
})
