import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import { ingestText } from './kbService'
import { analyzeSourceDomains } from './domainAnalysisService'

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

describeIfSqlite('domainAnalysisService', () => {
  it('creates domain membership and retrieval units', () => {
    const db = new Database(':memory:')
    migrate(db)
    const src = ingestText(
      db,
      'Kubernetes Reliability',
      'file://k8s-reliability.md',
      'Kubernetes reliability focuses on cluster failover, pods, and node health checks.'
    )
    const domainIds = analyzeSourceDomains(db, src.id)
    expect(domainIds.length).toBeGreaterThan(0)
    const membershipCount = (
      db.prepare('SELECT COUNT(*) as c FROM kb_domain_membership WHERE source_id = ?').get(src.id) as { c: number }
    ).c
    expect(membershipCount).toBeGreaterThan(0)
    const retrievalUnits = db
      .prepare('SELECT COUNT(*) as c FROM kb_domain_retrieval_units WHERE domain_id = ?')
      .get(domainIds[0]) as { c: number }
    expect(retrievalUnits.c).toBeGreaterThan(0)
    db.close()
  })
})
