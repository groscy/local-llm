import type { ChatMessage } from './runtime/types'
import type { OntologyService } from './ontologyService'

export type OntologyContextBuildOptions = {
  messages: ChatMessage[]
  maxTriples?: number
  maxTokens?: number
}

export type OntologyContextBuildResult = {
  context: string
  triplesUsed: number
  nodesUsed: number
  truncated: boolean
}

function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

function trimToTokenBudget(lines: string[], maxTokens: number): { text: string; used: number; truncated: boolean } {
  const kept: string[] = []
  let used = 0
  let truncated = false
  for (const line of lines) {
    const nextTokens = estimateTokensFromChars(line.length + 1)
    if (used + nextTokens > maxTokens) {
      truncated = true
      break
    }
    kept.push(line)
    used += nextTokens
  }
  return { text: kept.join('\n'), used, truncated }
}

export function buildOntologyContext(
  ontology: OntologyService,
  opts: OntologyContextBuildOptions
): OntologyContextBuildResult {
  const lastUser = [...opts.messages]
    .reverse()
    .find((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0)
  const query = lastUser?.content?.trim() ?? ''
  if (!query) {
    return { context: '', triplesUsed: 0, nodesUsed: 0, truncated: false }
  }

  const graph = ontology.querySubgraph({
    query,
    limitTriples: Math.max(5, Math.min(200, Math.floor(opts.maxTriples ?? 40))),
    limitEntities: 120,
    maxHops: 2
  })
  if (graph.edges.length === 0) {
    return { context: '', triplesUsed: 0, nodesUsed: graph.nodes.length, truncated: false }
  }

  const labelByIri = new Map<string, string>()
  for (const node of graph.nodes) labelByIri.set(node.iri, node.label)
  const lines = graph.edges.map((edge) => {
    const subject = labelByIri.get(edge.subjectIri) ?? edge.subjectIri
    const predicate = edge.predicateIri.replace(/^app:/, '')
    const object = edge.objectIri ? (labelByIri.get(edge.objectIri) ?? edge.objectIri) : edge.objectLiteral ?? ''
    return `- ${subject} ${predicate} ${object}`
  })

  const maxTokens = Math.max(64, Math.min(3000, Math.floor(opts.maxTokens ?? 512)))
  const budgeted = trimToTokenBudget(lines, maxTokens - 32)
  const context = [
    '--- Ontology context (runtime knowledge graph) ---',
    'Use these facts when relevant, but do not invent missing links:',
    budgeted.text
  ]
    .filter(Boolean)
    .join('\n')

  return {
    context,
    triplesUsed: budgeted.text ? budgeted.text.split('\n').length : 0,
    nodesUsed: graph.nodes.length,
    truncated: budgeted.truncated || graph.truncated
  }
}
