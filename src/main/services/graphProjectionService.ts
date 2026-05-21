import type Database from 'better-sqlite3'
import { createHash } from 'crypto'
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphPayload,
  SemanticKnowledgeGraphPayload
} from '@shared/types'

type ProjectionGraphType = 'structural' | 'semantic'

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function ensureProjectionTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_projection_nodes (
      graph_type TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_json TEXT NOT NULL,
      rank REAL NOT NULL DEFAULT 0,
      generated_at INTEGER NOT NULL,
      PRIMARY KEY (graph_type, node_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kg_projection_nodes_type_rank ON kg_projection_nodes(graph_type, rank DESC);
    CREATE TABLE IF NOT EXISTS kg_projection_edges (
      graph_type TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      edge_json TEXT NOT NULL,
      salience REAL NOT NULL DEFAULT 0,
      generated_at INTEGER NOT NULL,
      PRIMARY KEY (graph_type, edge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kg_projection_edges_type_salience ON kg_projection_edges(graph_type, salience DESC);
    CREATE TABLE IF NOT EXISTS kg_projection_meta (
      graph_type TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      node_count INTEGER NOT NULL,
      edge_count INTEGER NOT NULL,
      generated_at INTEGER NOT NULL
    );
  `)
}

function nodeRank(node: KnowledgeGraphNode): number {
  const explicit = typeof node.rank === 'number' ? node.rank : null
  if (explicit != null) return explicit
  const degree = typeof node.degree === 'number' ? node.degree : 0
  const confidence = typeof node.confidence === 'number' ? node.confidence : 0.5
  const novelty = typeof node.novelty === 'number' ? node.novelty : 0.4
  return degree * 0.45 + confidence * 0.35 + novelty * 0.2
}

function edgeId(edge: KnowledgeGraphEdge, index: number, scope = 'global'): string {
  const digest = createHash('sha1')
    .update(`${scope}|${edge.from}|${edge.to}|${edge.kind}|${edge.confidence ?? ''}|${edge.recency ?? ''}|${index}`)
    .digest('hex')
    .slice(0, 20)
  return `${scope}:${digest}`
}

function structuralCounts(db: Database.Database): { nodes: number; edges: number } {
  const nodeCount =
    (db.prepare('SELECT COUNT(*) as c FROM kg_projection_nodes WHERE graph_type = ?').get('structural') as
      | { c: number }
      | undefined)?.c ?? 0
  const edgeCount =
    (db.prepare('SELECT COUNT(*) as c FROM kg_projection_edges WHERE graph_type = ?').get('structural') as
      | { c: number }
      | undefined)?.c ?? 0
  return { nodes: Number(nodeCount), edges: Number(edgeCount) }
}

function upsertStructuralMeta(db: Database.Database, args: { truncated: boolean; generatedAt?: number }): void {
  const now = args.generatedAt ?? Date.now()
  const counts = structuralCounts(db)
  db.prepare(
    `INSERT INTO kg_projection_meta (graph_type, payload_json, node_count, edge_count, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(graph_type) DO UPDATE SET
       payload_json = excluded.payload_json,
       node_count = excluded.node_count,
       edge_count = excluded.edge_count,
       generated_at = excluded.generated_at`
  ).run('structural', JSON.stringify({ truncated: args.truncated }), counts.nodes, counts.edges, now)
}

export function rebuildKnowledgeGraphProjection(db: Database.Database, payload: KnowledgeGraphPayload): void {
  ensureProjectionTables(db)
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM kg_projection_nodes WHERE graph_type = ?').run('structural')
    db.prepare('DELETE FROM kg_projection_edges WHERE graph_type = ?').run('structural')
    const insertNode = db.prepare(
      `INSERT INTO kg_projection_nodes (graph_type, node_id, node_json, rank, generated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    const insertEdge = db.prepare(
      `INSERT INTO kg_projection_edges (graph_type, edge_id, edge_json, salience, generated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const node of payload.nodes) {
      insertNode.run('structural', node.id, JSON.stringify(node), nodeRank(node), now)
    }
    for (const [index, edge] of payload.edges.entries()) {
      insertEdge.run('structural', edgeId(edge, index, 'full'), JSON.stringify(edge), edge.salience ?? 0, now)
    }
    upsertStructuralMeta(db, { truncated: payload.truncated, generatedAt: now })
  })
  tx()
}

export function rebuildSemanticGraphProjection(db: Database.Database, payload: SemanticKnowledgeGraphPayload): void {
  ensureProjectionTables(db)
  const now = Date.now()
  db.prepare(
    `INSERT INTO kg_projection_meta (graph_type, payload_json, node_count, edge_count, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(graph_type) DO UPDATE SET
       payload_json = excluded.payload_json,
       node_count = excluded.node_count,
       edge_count = excluded.edge_count,
       generated_at = excluded.generated_at`
  ).run(
    'semantic',
    JSON.stringify(payload),
    payload.entities.length + payload.scopes.length + payload.intersections.length,
    payload.relations.length,
    now
  )
}

export function readProjectedKnowledgeGraph(db: Database.Database): KnowledgeGraphPayload | null {
  ensureProjectionTables(db)
  const meta = db
    .prepare('SELECT payload_json as payloadJson, generated_at as generatedAt FROM kg_projection_meta WHERE graph_type = ? LIMIT 1')
    .get('structural') as { payloadJson: string; generatedAt: number } | undefined
  const nodeRows = db
    .prepare('SELECT node_json as nodeJson FROM kg_projection_nodes WHERE graph_type = ? ORDER BY rank DESC')
    .all('structural') as Array<{ nodeJson: string }>
  if (!meta && nodeRows.length === 0) return null
  const edgeRows = db
    .prepare('SELECT edge_json as edgeJson FROM kg_projection_edges WHERE graph_type = ? ORDER BY salience DESC')
    .all('structural') as Array<{ edgeJson: string }>
  const metaPayload = parseJson<{ truncated?: boolean }>(meta?.payloadJson, {})
  const nodes = nodeRows.map((r) => parseJson<KnowledgeGraphNode | null>(r.nodeJson, null)).filter((n): n is KnowledgeGraphNode => Boolean(n))
  const edges = edgeRows.map((r) => parseJson<KnowledgeGraphEdge | null>(r.edgeJson, null)).filter((e): e is KnowledgeGraphEdge => Boolean(e))
  return {
    nodes,
    edges,
    truncated: metaPayload.truncated === true,
    projectionMeta: {
      generatedAt: meta?.generatedAt ?? Date.now(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      source: 'projection'
    }
  }
}

export function readProjectedSemanticGraph(db: Database.Database): SemanticKnowledgeGraphPayload | null {
  ensureProjectionTables(db)
  const row = db
    .prepare('SELECT payload_json as payloadJson FROM kg_projection_meta WHERE graph_type = ? LIMIT 1')
    .get('semantic') as { payloadJson: string } | undefined
  if (!row?.payloadJson) return null
  return parseJson<SemanticKnowledgeGraphPayload>(row.payloadJson, {
    entities: [],
    relations: [],
    descriptors: [],
    scopes: [],
    intersections: [],
    evidence: [],
    truncated: false
  })
}

export function clearProjection(db: Database.Database, graphType: ProjectionGraphType): void {
  ensureProjectionTables(db)
  db.prepare('DELETE FROM kg_projection_nodes WHERE graph_type = ?').run(graphType)
  db.prepare('DELETE FROM kg_projection_edges WHERE graph_type = ?').run(graphType)
  db.prepare('DELETE FROM kg_projection_meta WHERE graph_type = ?').run(graphType)
}

export function removeKnowledgeGraphProjectionBySource(db: Database.Database, sourceId: string): void {
  ensureProjectionTables(db)
  const overflowNodeId = `kg-overflow:${sourceId}`
  const sourcePrefix = `${sourceId}|%`
  const sourceMiddle = `%|${sourceId}|%`
  db.prepare(
    `DELETE FROM kg_projection_nodes
     WHERE graph_type = 'structural'
       AND (
         node_id = ?
         OR node_id = ?
         OR json_extract(node_json, '$.sourceId') = ?
         OR json_extract(node_json, '$.targetSourceId') = ?
       )`
  ).run(sourceId, overflowNodeId, sourceId, sourceId)
  db.prepare(
    `DELETE FROM kg_projection_edges
     WHERE graph_type = 'structural'
       AND (
         edge_id LIKE ?
         OR edge_id LIKE ?
         OR json_extract(edge_json, '$.from') = ?
         OR json_extract(edge_json, '$.to') = ?
       )`
  ).run(sourcePrefix, sourceMiddle, sourceId, sourceId)
  const existingMeta = db
    .prepare('SELECT payload_json as payloadJson FROM kg_projection_meta WHERE graph_type = ? LIMIT 1')
    .get('structural') as { payloadJson: string } | undefined
  const truncated = parseJson<{ truncated?: boolean }>(existingMeta?.payloadJson, {}).truncated === true
  upsertStructuralMeta(db, { truncated })
}

export function upsertKnowledgeGraphProjectionSlice(
  db: Database.Database,
  args: { sourceId: string; payload: KnowledgeGraphPayload }
): void {
  ensureProjectionTables(db)
  const now = Date.now()
  const existingMeta = db
    .prepare('SELECT payload_json as payloadJson FROM kg_projection_meta WHERE graph_type = ? LIMIT 1')
    .get('structural') as { payloadJson: string } | undefined
  const previousTruncated = parseJson<{ truncated?: boolean }>(existingMeta?.payloadJson, {}).truncated === true
  const tx = db.transaction(() => {
    removeKnowledgeGraphProjectionBySource(db, args.sourceId)
    const insertNode = db.prepare(
      `INSERT INTO kg_projection_nodes (graph_type, node_id, node_json, rank, generated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(graph_type, node_id) DO UPDATE SET
         node_json = excluded.node_json,
         rank = excluded.rank,
         generated_at = excluded.generated_at`
    )
    const insertEdge = db.prepare(
      `INSERT INTO kg_projection_edges (graph_type, edge_id, edge_json, salience, generated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(graph_type, edge_id) DO UPDATE SET
         edge_json = excluded.edge_json,
         salience = excluded.salience,
         generated_at = excluded.generated_at`
    )
    for (const node of args.payload.nodes) {
      insertNode.run('structural', node.id, JSON.stringify(node), nodeRank(node), now)
    }
    for (const [index, edge] of args.payload.edges.entries()) {
      insertEdge.run('structural', edgeId(edge, index, args.sourceId), JSON.stringify(edge), edge.salience ?? 0, now)
    }
    upsertStructuralMeta(db, { truncated: previousTruncated || args.payload.truncated, generatedAt: now })
  })
  tx()
}
