import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/migrations'
import { buildOntologyContext } from './ontologyContextBuilder'
import { createOntologyService } from './ontologyService'

const sqliteAvailable = (() => {
  try {
    const probe = new Database(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('ontology service', () => {
  it('ingests text and persists triples', () => {
    const db = makeDb()
    const ontology = createOntologyService(db)
    const result = ontology.ingestText({
      text: 'React uses TypeScript. Ontology is a graph.',
      sourceType: 'test',
      sourceRef: 'spec:1'
    })
    expect(result.entities).toBeGreaterThan(0)
    expect(result.triples).toBeGreaterThan(0)
    const stats = ontology.getStats()
    expect(stats.entityCount).toBeGreaterThan(0)
    expect(stats.tripleCount).toBeGreaterThan(0)
  })

  it('queries subgraph and entity details', () => {
    const db = makeDb()
    const ontology = createOntologyService(db)
    ontology.ingestText({
      text: 'Electron contains main process. Main process uses IPC.',
      sourceType: 'test',
      sourceRef: 'spec:2'
    })
    const graph = ontology.querySubgraph({ query: 'process', limitTriples: 40 })
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
    const node = graph.nodes[0]
    expect(node).toBeTruthy()
    if (!node) return
    const details = ontology.entityDetails(node.iri)
    expect(details.entity?.iri).toBe(node.iri)
    expect(details.outgoing.length + details.incoming.length).toBeGreaterThan(0)
  })

  it('builds bounded ontology prompt context', () => {
    const db = makeDb()
    const ontology = createOntologyService(db)
    ontology.ingestText({
      text: 'Cursor uses Electron. Electron uses IPC. IPC relates renderer and main.',
      sourceType: 'test',
      sourceRef: 'spec:3'
    })
    const ctx = buildOntologyContext(ontology, {
      messages: [{ role: 'user', content: 'How does Electron IPC work?' }],
      maxTriples: 8,
      maxTokens: 120
    })
    expect(ctx.context).toContain('Ontology context')
    expect(ctx.triplesUsed).toBeGreaterThan(0)
    expect(ctx.triplesUsed).toBeLessThanOrEqual(8)
  })
})
