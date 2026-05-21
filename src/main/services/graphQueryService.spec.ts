import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import { ingestText } from './kbService'
import { createGraphQueryService } from './graphQueryService'

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

describeIfSqlite('graphQueryService keyword graph APIs', () => {
  it('returns keyword graph with typed edges and searchable nodes', () => {
    const db = new Database(':memory:')
    migrate(db)
    ingestText(
      db,
      'Platform Graph',
      'file://platform-graph.md',
      'Graph engine uses indexing pipeline. Indexing pipeline supports retrieval engine.'
    )
    const service = createGraphQueryService(db)
    const payload = service.getKeywordGraph({ query: 'engine', limitNodes: 120, limitEdges: 260 })
    expect(payload.nodes.length).toBeGreaterThan(0)
    expect(payload.edges.length).toBeGreaterThan(0)
    const hits = service.searchKeywordGraphNodes('engine', 8)
    expect(hits.length).toBeGreaterThan(0)
    const neighbors = service.getKeywordGraphNeighbors({ nodeId: payload.nodes[0]!.id, hops: 1 })
    expect(neighbors.nodes.length).toBeGreaterThan(0)
    db.close()
  })
})
