export const ONTOLOGY_PREDICATE = {
  relatedTo: 'app:relatedTo',
  isA: 'app:isA',
  dependsOn: 'app:dependsOn',
  uses: 'app:uses',
  contains: 'app:contains'
} as const

export type OntologyRelationRule = {
  id: string
  regex: RegExp
  predicate: string
  verb: string
}

export const ONTOLOGY_RELATION_RULES: OntologyRelationRule[] = [
  {
    id: 'rule.is_a',
    regex: /\b(.{3,64}?)\s+(?:is|are)\s+(?:an?\s+|the\s+)?(.{3,64})$/i,
    predicate: ONTOLOGY_PREDICATE.isA,
    verb: 'is-a'
  },
  {
    id: 'rule.depends_on',
    regex: /\b(.{3,64}?)\s+depends on\s+(.{3,64})$/i,
    predicate: ONTOLOGY_PREDICATE.dependsOn,
    verb: 'depends on'
  },
  {
    id: 'rule.uses',
    regex: /\b(.{3,64}?)\s+uses\s+(.{3,64})$/i,
    predicate: ONTOLOGY_PREDICATE.uses,
    verb: 'uses'
  },
  {
    id: 'rule.contains',
    regex: /\b(.{3,64}?)\s+(?:contains|includes)\s+(.{3,64})$/i,
    predicate: ONTOLOGY_PREDICATE.contains,
    verb: 'contains'
  }
]

export const ONTOLOGY_ADJECTIVE_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'rule.adj_prefix', regex: /\b(a|an|the)\s+([a-z]{3,32})\s+([A-Za-z][A-Za-z0-9_/-]{2,})\b/gi },
  { id: 'rule.adj_copular', regex: /\b([A-Za-z][A-Za-z0-9_/-]{2,})\s+(?:is|are)\s+([a-z]{3,32})\b/gi }
]
