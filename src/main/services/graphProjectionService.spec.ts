import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import { ingestText, getKnowledgeGraph, getSemanticKnowledgeGraph } from './kbService'
import {
  rebuildKnowledgeGraphProjection,
  rebuildSemanticGraphProjection,
  readProjectedKnowledgeGraph,
  readProjectedSemanticGraph
} from './graphProjectionService'

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

describeIfSqlite('graphProjectionService', () => {
  it('stores and reads structural graph projections', () => {
    const db = new Database(':memory:')
    migrate(db)
    ingestText(db, 'Graph A', 'file://a.md', 'Topic A uses Topic B.')
    const payload = getKnowledgeGraph(db)
    rebuildKnowledgeGraphProjection(db, payload)
    const projected = readProjectedKnowledgeGraph(db)
    expect(projected).not.toBeNull()
    expect(projected?.nodes.length).toBe(payload.nodes.length)
    expect(projected?.projectionMeta?.source).toBe('projection')
    db.close()
  })

  it('stores and reads semantic graph projections', () => {
    const db = new Database(':memory:')
    migrate(db)
    ingestText(db, 'Semantic A', 'file://semantic-a.md', 'Renderer uses WebGL. WebGL is graphics.')
    const payload = getSemanticKnowledgeGraph(db)
    rebuildSemanticGraphProjection(db, payload)
    const projected = readProjectedSemanticGraph(db)
    expect(projected).not.toBeNull()
    expect(projected?.relations.length).toBeGreaterThan(0)
    db.close()
  })

  it('keeps projection-backed graph endpoints fast enough for local p95 target envelope', () => {
    const db = new Database(':memory:')
    migrate(db)
    for (let i = 0; i < 30; i++) {
      ingestText(
        db,
        `Doc ${i}`,
        `file://doc-${i}.md`,
        `Graph doc ${i} uses adapter ${i % 5}. Adapter ${i % 5} depends on pipeline.`
      )
    }
    // Warm projection path.
    getKnowledgeGraph(db)
    const timings: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now()
      getKnowledgeGraph(db)
      timings.push(Date.now() - t0)
    }
    timings.sort((a, b) => a - b)
    const p95 = timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))]
    expect(p95).toBeLessThan(250)
    db.close()
  })
})
