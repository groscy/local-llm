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

  it('applies lod tier defaults and edge density clamp', () => {
    const db = makeDb()
    const ontology = createOntologyService(db)
    ontology.ingestText({
      text: [
        'Renderer uses React.',
        'Renderer uses Canvas.',
        'Renderer uses WebGL.',
        'Renderer uses IPC.',
        'Ontology tracks entities.',
        'Ontology tracks triples.',
        'Graph has nodes.',
        'Graph has edges.',
        'Layout uses force simulation.',
        'Layout uses worker.'
      ].join(' '),
      sourceType: 'test',
      sourceRef: 'spec:lod'
    })
    const detail = ontology.querySubgraph({ query: 'renderer', lodTier: 'detail', limitTriples: 140 })
    const overview = ontology.querySubgraph({
      query: 'renderer',
      lodTier: 'overview',
      limitTriples: 140,
      maxEdgeDensity: 0.2
    })
    expect(detail.edges.length).toBeGreaterThan(0)
    expect(overview.edges.length).toBeGreaterThan(0)
    expect(overview.edges.length).toBeLessThanOrEqual(detail.edges.length)
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

  it('writes deterministic semantic evidence with rule ids', () => {
    const db = makeDb()
    const ontology = createOntologyService(db)
    ontology.ingestText({
      text: 'Renderer uses WebGL. Renderer is a component.',
      sourceType: 'test',
      sourceRef: 'spec:semantic-evidence'
    })
    const evidenceRows = db
      .prepare('SELECT rule_id as ruleId, extraction_method as extractionMethod FROM semantic_evidence_traces')
      .all() as Array<{ ruleId: string | null; extractionMethod: string }>
    expect(evidenceRows.length).toBeGreaterThan(0)
    expect(evidenceRows.some((r) => r.ruleId?.includes('rule.uses'))).toBe(true)
    expect(evidenceRows.every((r) => r.extractionMethod === 'deterministic_rule')).toBe(true)
  })

  it('backfills semantic graph from legacy kb and ontology rows', () => {
    const db = makeDb()
    const now = Date.now()
    db.prepare('INSERT INTO kb_sources (id, title, uri, created_at) VALUES (?, ?, ?, ?)').run(
      'src-1',
      'Transport Notes',
      'file://transport.md',
      now
    )
    db.prepare(
      `INSERT INTO kb_documents (source_id, raw_source_text, raw_text, distilled_body, confidence_score, confidence_reasons_json, diagnostics_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'src-1',
      'Train uses Rail.',
      'Train uses Rail.',
      'Train uses Rail.',
      0.8,
      '["test"]',
      '{"source":"text","parserWarnings":[],"truncated":false,"cleanupEdits":0}',
      now,
      now
    )
    db.prepare(
      `INSERT INTO ontology_triples (id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    ).run('t1', 'app:entity/train', 'app:uses', 'app:entity/rail', 'test', 'spec:legacy', 0.72, now)

    const ontology = createOntologyService(db)
    const result = ontology.backfillSemanticGraph({ maxSources: 10, maxTriples: 20 })
    expect(result.sourcesProcessed).toBeGreaterThan(0)
    expect(result.triplesProcessed).toBeGreaterThan(0)
    const semanticEntityCount =
      (db.prepare('SELECT COUNT(*) as c FROM semantic_entities').get() as { c: number } | undefined)?.c ?? 0
    expect(semanticEntityCount).toBeGreaterThan(0)
  })
})
