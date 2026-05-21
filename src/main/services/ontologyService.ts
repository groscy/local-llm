import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type {
  OntologyEdge,
  OntologyEntityDetails,
  OntologyNode,
  OntologyQueryRequest,
  OntologyStats,
  OntologySubgraphPayload
} from '@shared/types'
import {
  ONTOLOGY_ADJECTIVE_PATTERNS,
  ONTOLOGY_PREDICATE,
  ONTOLOGY_RELATION_RULES
} from './ontologyRuleRegistry'

const DEFAULT_NAMESPACE_ROWS: Array<{ prefix: string; baseIri: string }> = [
  { prefix: 'app', baseIri: 'app://ontology/' },
  { prefix: 'schema', baseIri: 'https://schema.org/' },
  { prefix: 'rdf', baseIri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' }
]

const PREDICATE = ONTOLOGY_PREDICATE

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'answer',
  'because',
  'between',
  'build',
  'can',
  'chat',
  'context',
  'create',
  'did',
  'does',
  'domain',
  'from',
  'have',
  'into',
  'just',
  'know',
  'like',
  'model',
  'more',
  'need',
  'only',
  'precise',
  'runtime',
  'should',
  'that',
  'their',
  'there',
  'this',
  'user',
  'using',
  'very',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would'
])

export type OntologyIngestInput = {
  text: string
  sourceType: string
  sourceRef: string
  confidence?: number
  entityType?: string
}

type TripleRow = {
  id: string
  subject_iri: string
  predicate_iri: string
  object_iri: string | null
  object_literal: string | null
  source_type: string
  source_ref: string
  confidence: number
  created_at: number
}

type EntityRow = {
  iri: string
  label: string
  type: string
  confidence: number
}

function clampConfidence(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.6
  return Math.max(0.05, Math.min(1, v))
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function canonicalEntityLabel(raw: string): string {
  const cleaned = raw.replace(/[`"'()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 128)
}

type SentenceSpan = { sentence: string; start: number; end: number }
type NounCandidate = { label: string; start: number; end: number; confidenceReasons: string[] }
type VerbRelationCandidate = {
  subject: string
  object: string
  predicate: string
  verb: string
  ruleId: string
  start: number
  end: number
  confidenceReasons: string[]
}
type AdjectiveDescriptorCandidate = {
  target: string
  adjective: string
  ruleId: string
  start: number
  end: number
  confidenceReasons: string[]
}

const RELATION_RULES = ONTOLOGY_RELATION_RULES
const ADJECTIVE_PATTERNS = ONTOLOGY_ADJECTIVE_PATTERNS

function splitSentencesWithOffsets(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = []
  const re = /[^.!?\n]+[.!?]?/g
  for (const m of text.matchAll(re)) {
    const raw = m[0] ?? ''
    const sentence = raw.replace(/\s+/g, ' ').trim()
    if (sentence.length < 4) continue
    const start = m.index ?? 0
    out.push({ sentence, start, end: start + raw.length })
    if (out.length >= 48) break
  }
  return out
}

function runNounPass(text: string): NounCandidate[] {
  const counts = new Map<string, { count: number; firstStart: number; firstEnd: number; reasons: Set<string> }>()
  const tokenRe = /[A-Za-z][A-Za-z0-9_/-]{2,}/g
  for (const m of text.matchAll(tokenRe)) {
    const raw = m[0] ?? ''
    const normalized = canonicalEntityLabel(raw)
    const slug = toSlug(normalized)
    if (slug.length < 3) continue
    if (STOP_WORDS.has(slug)) continue
    const start = m.index ?? 0
    const end = start + raw.length
    if (!counts.has(normalized)) {
      counts.set(normalized, {
        count: 0,
        firstStart: start,
        firstEnd: end,
        reasons: new Set(['noun_pass_token_match'])
      })
    }
    const cur = counts.get(normalized)!
    cur.count += 1
    if (cur.count >= 2) cur.reasons.add('noun_pass_frequency_boost')
    if (/^[A-Z]/.test(raw)) cur.reasons.add('noun_pass_titlecase_signal')
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length)
    .slice(0, 42)
    .map(([label, meta]) => ({
      label,
      start: meta.firstStart,
      end: meta.firstEnd,
      confidenceReasons: [...meta.reasons]
    }))
}

function runVerbRelationPass(sentences: SentenceSpan[]): VerbRelationCandidate[] {
  const out: VerbRelationCandidate[] = []
  for (const span of sentences) {
    const s = span.sentence.replace(/\s+/g, ' ').trim()
    if (!s) continue
    for (const rule of RELATION_RULES) {
      const m = s.match(rule.regex)
      if (!m) continue
      const subject = canonicalEntityLabel(m[1] ?? '')
      const object = canonicalEntityLabel(m[2] ?? '')
      if (subject.length < 3 || object.length < 3 || subject === object) continue
      out.push({
        subject,
        object,
        predicate: rule.predicate,
        verb: rule.verb,
        ruleId: rule.id,
        start: span.start,
        end: span.end,
        confidenceReasons: ['verb_pass_rule_match', `verb_pass_${rule.id.replace('.', '_')}`]
      })
      if (out.length >= 64) return out
    }
  }
  return out
}

function runAdjectiveDescriptorPass(sentences: SentenceSpan[]): AdjectiveDescriptorCandidate[] {
  const out: AdjectiveDescriptorCandidate[] = []
  const seen = new Set<string>()
  for (const span of sentences) {
    for (const pattern of ADJECTIVE_PATTERNS) {
      pattern.regex.lastIndex = 0
      for (const m of span.sentence.matchAll(pattern.regex)) {
        const a = pattern.id === 'rule.adj_prefix' ? String(m[2] ?? '') : String(m[2] ?? '')
        const targetRaw = pattern.id === 'rule.adj_prefix' ? String(m[3] ?? '') : String(m[1] ?? '')
        const adjective = a.toLowerCase().trim()
        const target = canonicalEntityLabel(targetRaw)
        if (adjective.length < 3 || adjective.length > 32) continue
        if (target.length < 3) continue
        const key = `${target.toLowerCase()}\0${adjective}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          target,
          adjective,
          ruleId: pattern.id,
          start: span.start,
          end: span.end,
          confidenceReasons: ['adjective_pass_pattern_match', `adjective_pass_${pattern.id.replace('.', '_')}`]
        })
        if (out.length >= 80) return out
      }
    }
  }
  return out
}

function rowToEdge(row: TripleRow): OntologyEdge {
  return {
    id: row.id,
    subjectIri: row.subject_iri,
    predicateIri: row.predicate_iri,
    objectIri: row.object_iri,
    objectLiteral: row.object_literal,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    confidence: row.confidence,
    createdAt: row.created_at
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | undefined
  return Boolean(row?.ok)
}

export type OntologyService = {
  ingestText: (input: OntologyIngestInput) => { entities: number; triples: number }
  backfillSemanticGraph: (opts?: { maxSources?: number; maxTriples?: number }) => {
    sourcesProcessed: number
    triplesProcessed: number
  }
  getStats: () => OntologyStats
  querySubgraph: (request?: OntologyQueryRequest) => OntologySubgraphPayload
  entityDetails: (iri: string, limit?: number) => OntologyEntityDetails
  rebuildSnapshot: () => { ok: true; snapshotId: string }
  exportJsonLd: () => Record<string, unknown>
}

export function createOntologyService(db: Database.Database): OntologyService {
  const hasSemanticTables =
    tableExists(db, 'semantic_entities') &&
    tableExists(db, 'semantic_relations') &&
    tableExists(db, 'semantic_descriptors') &&
    tableExists(db, 'semantic_evidence_traces')

  const insertEntity = db.prepare(
    `INSERT INTO ontology_entities (id, iri, label, type, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(iri) DO UPDATE SET
       label = excluded.label,
       type = excluded.type,
       confidence = ((ontology_entities.confidence * 0.85) + (excluded.confidence * 0.15)),
       updated_at = excluded.updated_at`
  )
  const insertTriple = db.prepare(
    `INSERT OR IGNORE INTO ontology_triples
      (id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertSemanticEntity = hasSemanticTables
    ? db.prepare(
        `INSERT INTO semantic_entities (id, lemma, label, entity_type, canonical_id, alias_of, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lemma, entity_type) DO UPDATE SET
           label = excluded.label,
           canonical_id = COALESCE(excluded.canonical_id, semantic_entities.canonical_id),
           alias_of = COALESCE(excluded.alias_of, semantic_entities.alias_of),
           confidence = ((semantic_entities.confidence * 0.8) + (excluded.confidence * 0.2)),
           updated_at = excluded.updated_at`
      )
    : null
  const selectSemanticEntityId = hasSemanticTables
    ? db.prepare('SELECT id FROM semantic_entities WHERE lemma = ? AND entity_type = ? LIMIT 1')
    : null
  const insertSemanticRelation = hasSemanticTables
    ? db.prepare(
        `INSERT INTO semantic_relations (id, from_entity_id, to_entity_id, verb, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(from_entity_id, to_entity_id, verb) DO UPDATE SET
           confidence = ((semantic_relations.confidence * 0.8) + (excluded.confidence * 0.2))`
      )
    : null
  const selectSemanticRelationId = hasSemanticTables
    ? db.prepare(
        `SELECT id
         FROM semantic_relations
         WHERE from_entity_id = ? AND to_entity_id = ? AND verb = ?
         LIMIT 1`
      )
    : null
  const insertSemanticDescriptor = hasSemanticTables
    ? db.prepare(
        `INSERT OR IGNORE INTO semantic_descriptors
          (id, target_type, target_id, adjective, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
    : null
  const insertSemanticEvidence = hasSemanticTables
    ? db.prepare(
        `INSERT INTO semantic_evidence_traces
          (id, source_type, source_ref, extraction_method, rule_id, span_start, span_end, span_text, span_page, span_anchor,
           confidence, confidence_reasons_json, parser_warnings_json, fallback_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
    : null
  const linkEntityEvidence = hasSemanticTables
    ? db.prepare('INSERT OR IGNORE INTO semantic_entity_evidence (entity_id, evidence_id) VALUES (?, ?)')
    : null
  const linkRelationEvidence = hasSemanticTables
    ? db.prepare('INSERT OR IGNORE INTO semantic_relation_evidence (relation_id, evidence_id) VALUES (?, ?)')
    : null
  const linkDescriptorEvidence = hasSemanticTables
    ? db.prepare('INSERT OR IGNORE INTO semantic_descriptor_evidence (descriptor_id, evidence_id) VALUES (?, ?)')
    : null
  const selectEntity = db.prepare(
    'SELECT iri, label, type, confidence FROM ontology_entities WHERE iri = ?'
  )
  const selectEntitiesByIri = db.prepare(
    'SELECT iri, label, type, confidence FROM ontology_entities WHERE iri IN (SELECT value FROM json_each(?))'
  )
  const selectTriplesByIri = db.prepare(
    `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
     FROM ontology_triples
     WHERE subject_iri IN (SELECT value FROM json_each(?))
        OR object_iri IN (SELECT value FROM json_each(?))
     ORDER BY created_at DESC
     LIMIT ?`
  )
  const selectOutgoing = db.prepare(
    `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
     FROM ontology_triples
     WHERE subject_iri = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )
  const selectIncoming = db.prepare(
    `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
     FROM ontology_triples
     WHERE object_iri = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )

  for (const row of DEFAULT_NAMESPACE_ROWS) {
    db.prepare('INSERT OR IGNORE INTO ontology_namespaces (prefix, base_iri) VALUES (?, ?)').run(
      row.prefix,
      row.baseIri
    )
  }

  function upsertEntity(labelRaw: string, type: string, confidence: number): string | null {
    const label = canonicalEntityLabel(labelRaw)
    if (!label || label.length < 2) return null
    const slug = toSlug(label)
    if (!slug) return null
    const iri = `app:entity/${slug}`
    const now = Date.now()
    insertEntity.run(randomUUID(), iri, label, type, clampConfidence(confidence), now, now)
    return iri
  }

  function writeTriple(args: {
    subjectIri: string
    predicateIri: string
    objectIri?: string | null
    objectLiteral?: string | null
    sourceType: string
    sourceRef: string
    confidence: number
  }): boolean {
    const rowId = randomUUID()
    const out = insertTriple.run(
      rowId,
      args.subjectIri,
      args.predicateIri,
      args.objectIri ?? null,
      args.objectLiteral ?? null,
      args.sourceType,
      args.sourceRef,
      clampConfidence(args.confidence),
      Date.now()
    )
    return out.changes > 0
  }

  function upsertSemanticEntityId(labelRaw: string, entityType: string, confidence: number): string | null {
    if (!hasSemanticTables || !insertSemanticEntity || !selectSemanticEntityId) return null
    const label = canonicalEntityLabel(labelRaw)
    const lemma = toSlug(label)
    if (!lemma) return null
    const canonicalId = `${entityType}:${lemma}`
    const now = Date.now()
    insertSemanticEntity.run(randomUUID(), lemma, label, entityType, canonicalId, null, clampConfidence(confidence), now, now)
    const row = selectSemanticEntityId.get(lemma, entityType) as { id: string } | undefined
    return row?.id ?? null
  }

  function upsertSemanticRelationId(args: {
    fromEntityId: string
    toEntityId: string
    verb: string
    confidence: number
  }): string | null {
    if (!hasSemanticTables || !insertSemanticRelation || !selectSemanticRelationId) return null
    const now = Date.now()
    insertSemanticRelation.run(
      randomUUID(),
      args.fromEntityId,
      args.toEntityId,
      args.verb.trim().slice(0, 96),
      clampConfidence(args.confidence),
      now
    )
    const row = selectSemanticRelationId.get(args.fromEntityId, args.toEntityId, args.verb.trim().slice(0, 96)) as
      | { id: string }
      | undefined
    return row?.id ?? null
  }

  function writeEvidenceTrace(args: {
    sourceType: string
    sourceRef: string
    extractionMethod: 'deterministic_rule' | 'heuristic' | 'llm_enrichment' | 'manual'
    ruleId?: string
    start?: number
    end?: number
    text?: string
    confidence: number
    confidenceReasons: string[]
    parserWarnings?: string[]
    fallbackReason?: string
  }): string | null {
    if (!hasSemanticTables || !insertSemanticEvidence) return null
    const id = randomUUID()
    insertSemanticEvidence.run(
      id,
      args.sourceType,
      args.sourceRef,
      args.extractionMethod,
      args.ruleId ?? null,
      args.start ?? null,
      args.end ?? null,
      args.text?.slice(0, 360) ?? null,
      null,
      null,
      clampConfidence(args.confidence),
      JSON.stringify(args.confidenceReasons ?? []),
      JSON.stringify(args.parserWarnings ?? []),
      args.fallbackReason ?? null,
      Date.now()
    )
    return id
  }

  function seedEntitiesFromQuery(query: string, limit: number, typeFilters: string[]): string[] {
    const q = query.trim().toLowerCase()
    const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 6)
    if (words.length === 0) return []
    const clauses: string[] = []
    const params: unknown[] = []
    for (const w of words) {
      clauses.push('LOWER(label) LIKE ?')
      params.push(`%${w}%`)
    }
    const typeClause = typeFilters.length > 0 ? ' AND type IN (SELECT value FROM json_each(?))' : ''
    if (typeFilters.length > 0) params.push(JSON.stringify(typeFilters))
    params.push(limit)
    const sql = `SELECT iri FROM ontology_entities WHERE (${clauses.join(' OR ')})${typeClause} ORDER BY updated_at DESC LIMIT ?`
    const rows = db.prepare(sql).all(...params) as Array<{ iri: string }>
    return rows.map((r) => r.iri)
  }

  function listRecentEntitySeeds(limit: number): string[] {
    const rows = db
      .prepare(
        `SELECT DISTINCT subject_iri as iri
         FROM ontology_triples
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ iri: string }>
    return rows.map((r) => r.iri)
  }

  function inferSourceTypeFromUri(uri: string): string {
    const t = uri.trim().toLowerCase()
    if (!t) return 'text'
    if (t.startsWith('file://') && t.endsWith('.pdf')) return 'pdf'
    if (t.startsWith('codebase-analysis:')) return 'codebase'
    if (t.startsWith('chat:')) return 'chat'
    if (t.startsWith('file://')) return 'text'
    return 'other'
  }

  function labelFromIri(iri: string): string {
    const tail = iri.split('/').pop() ?? iri.split(':').pop() ?? iri
    return canonicalEntityLabel(tail.replace(/[-_]+/g, ' ')) || iri
  }

  function verbFromPredicate(predicateIri: string): string {
    const tail = predicateIri.split('/').pop() ?? predicateIri.split(':').pop() ?? 'related'
    return tail.replace(/[-_]+/g, ' ').trim().toLowerCase() || 'related'
  }

  return {
    ingestText(input: OntologyIngestInput): { entities: number; triples: number } {
      const text = input.text.trim()
      if (!text) return { entities: 0, triples: 0 }
      const baseConfidence = clampConfidence(input.confidence)
      const entityType = input.entityType?.trim() || 'concept'
      const sentences = splitSentencesWithOffsets(text)
      const nounCandidates = runNounPass(text)
      const verbRelations = runVerbRelationPass(sentences)
      const adjectiveDescriptors = runAdjectiveDescriptorPass(sentences)
      const iris: string[] = []
      const semanticEntityByLabel = new Map<string, string>()
      for (const noun of nounCandidates) {
        const iri = upsertEntity(noun.label, entityType, baseConfidence)
        if (iri) iris.push(iri)
        const semanticEntityId = upsertSemanticEntityId(noun.label, entityType, baseConfidence)
        if (semanticEntityId) {
          semanticEntityByLabel.set(noun.label.toLowerCase(), semanticEntityId)
          const evidenceId = writeEvidenceTrace({
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            extractionMethod: 'deterministic_rule',
            ruleId: 'noun_pass.token_frequency',
            start: noun.start,
            end: noun.end,
            text: text.slice(noun.start, Math.min(text.length, noun.end + 140)),
            confidence: baseConfidence,
            confidenceReasons: noun.confidenceReasons
          })
          if (evidenceId && linkEntityEvidence) linkEntityEvidence.run(semanticEntityId, evidenceId)
        }
      }

      let triplesWritten = 0
      for (const rel of verbRelations) {
        const a = upsertEntity(rel.subject, entityType, baseConfidence)
        const b = upsertEntity(rel.object, entityType, baseConfidence)
        if (!a || !b) continue
        if (
          writeTriple({
            subjectIri: a,
            predicateIri: rel.predicate,
            objectIri: b,
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            confidence: baseConfidence
          })
        ) {
          triplesWritten += 1
        }
        const fromSemanticId =
          semanticEntityByLabel.get(rel.subject.toLowerCase()) ?? upsertSemanticEntityId(rel.subject, entityType, baseConfidence)
        const toSemanticId =
          semanticEntityByLabel.get(rel.object.toLowerCase()) ?? upsertSemanticEntityId(rel.object, entityType, baseConfidence)
        if (fromSemanticId && toSemanticId) {
          const relationId = upsertSemanticRelationId({
            fromEntityId: fromSemanticId,
            toEntityId: toSemanticId,
            verb: rel.verb,
            confidence: baseConfidence
          })
          const evidenceId = writeEvidenceTrace({
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            extractionMethod: 'deterministic_rule',
            ruleId: rel.ruleId,
            start: rel.start,
            end: rel.end,
            text: text.slice(rel.start, Math.min(text.length, rel.end + 120)),
            confidence: baseConfidence,
            confidenceReasons: rel.confidenceReasons
          })
          if (relationId && evidenceId && linkRelationEvidence) linkRelationEvidence.run(relationId, evidenceId)
        }
      }

      if (hasSemanticTables && insertSemanticDescriptor) {
        for (const desc of adjectiveDescriptors) {
          const targetEntityId =
            semanticEntityByLabel.get(desc.target.toLowerCase()) ?? upsertSemanticEntityId(desc.target, entityType, baseConfidence)
          if (!targetEntityId) continue
          const descriptorId = randomUUID()
          insertSemanticDescriptor.run(
            descriptorId,
            'entity',
            targetEntityId,
            desc.adjective,
            clampConfidence(baseConfidence * 0.92),
            Date.now()
          )
          const evidenceId = writeEvidenceTrace({
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            extractionMethod: 'deterministic_rule',
            ruleId: desc.ruleId,
            start: desc.start,
            end: desc.end,
            text: text.slice(desc.start, Math.min(text.length, desc.end + 110)),
            confidence: baseConfidence * 0.92,
            confidenceReasons: desc.confidenceReasons
          })
          if (evidenceId && linkDescriptorEvidence) linkDescriptorEvidence.run(descriptorId, evidenceId)
        }
      }

      for (let i = 0; i < iris.length; i++) {
        const a = iris[i]
        const b = iris[i + 1]
        if (!a || !b || a === b) continue
        if (
          writeTriple({
            subjectIri: a,
            predicateIri: PREDICATE.relatedTo,
            objectIri: b,
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            confidence: baseConfidence * 0.85
          })
        ) {
          triplesWritten += 1
        }
      }

      return { entities: iris.length, triples: triplesWritten }
    },

    backfillSemanticGraph(opts?: { maxSources?: number; maxTriples?: number }): {
      sourcesProcessed: number
      triplesProcessed: number
    } {
      if (!hasSemanticTables) return { sourcesProcessed: 0, triplesProcessed: 0 }
      const maxSources = Math.max(1, Math.min(1000, Math.floor(opts?.maxSources ?? 220)))
      const maxTriples = Math.max(1, Math.min(12000, Math.floor(opts?.maxTriples ?? 2200)))
      const existingSemanticRows =
        (db.prepare('SELECT COUNT(*) as c FROM semantic_entities').get() as { c: number } | undefined)?.c ?? 0
      if (existingSemanticRows > 0) return { sourcesProcessed: 0, triplesProcessed: 0 }

      const sourceRows = db
        .prepare(
          `SELECT s.id, s.uri, COALESCE(d.raw_text, d.distilled_body, '') as text
           FROM kb_sources s
           LEFT JOIN kb_documents d ON d.source_id = s.id
           ORDER BY s.created_at DESC
           LIMIT ?`
        )
        .all(maxSources) as Array<{ id: string; uri: string; text: string }>
      let sourcesProcessed = 0
      for (const row of sourceRows) {
        const text = row.text.trim()
        if (!text) continue
        this.ingestText({
          text,
          sourceType: inferSourceTypeFromUri(row.uri),
          sourceRef: row.id,
          confidence: 0.62,
          entityType: 'concept'
        })
        sourcesProcessed++
      }

      const tripleRows = db
        .prepare(
          `SELECT t.subject_iri as subjectIri, t.predicate_iri as predicateIri, t.object_iri as objectIri, t.confidence
           FROM ontology_triples t
           ORDER BY t.created_at DESC
           LIMIT ?`
        )
        .all(maxTriples) as Array<{
        subjectIri: string
        predicateIri: string
        objectIri: string | null
        confidence: number
      }>
      let triplesProcessed = 0
      for (const row of tripleRows) {
        if (!row.objectIri) continue
        const fromId = upsertSemanticEntityId(labelFromIri(row.subjectIri), 'concept', row.confidence)
        const toId = upsertSemanticEntityId(labelFromIri(row.objectIri), 'concept', row.confidence)
        if (!fromId || !toId) continue
        upsertSemanticRelationId({
          fromEntityId: fromId,
          toEntityId: toId,
          verb: verbFromPredicate(row.predicateIri),
          confidence: row.confidence
        })
        triplesProcessed++
      }
      return { sourcesProcessed, triplesProcessed }
    },

    getStats(): OntologyStats {
      const entityCount =
        (db.prepare('SELECT COUNT(*) as c FROM ontology_entities').get() as { c: number } | undefined)?.c ?? 0
      const tripleCount =
        (db.prepare('SELECT COUNT(*) as c FROM ontology_triples').get() as { c: number } | undefined)?.c ?? 0
      const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      const recentTripleCount =
        (
          db
            .prepare('SELECT COUNT(*) as c FROM ontology_triples WHERE created_at >= ?')
            .get(recentCutoff) as { c: number } | undefined
        )?.c ?? 0
      const predRows = db
        .prepare(
          `SELECT predicate_iri as predicate, COUNT(*) as count
           FROM ontology_triples
           GROUP BY predicate_iri
           ORDER BY count DESC
           LIMIT 8`
        )
        .all() as Array<{ predicate: string; count: number }>
      const lastUpdatedAt = (
        db.prepare('SELECT MAX(created_at) as ts FROM ontology_triples').get() as { ts?: number } | undefined
      )?.ts
      return {
        entityCount,
        tripleCount,
        recentTripleCount,
        predicateCount: predRows.length,
        topPredicates: predRows,
        lastUpdatedAt
      }
    },

    querySubgraph(request?: OntologyQueryRequest): OntologySubgraphPayload {
      const lodTier = request?.lodTier ?? 'detail'
      const defaultsByTier: Record<'overview' | 'mid' | 'detail', { entities: number; triples: number; hops: number }> = {
        overview: { entities: 64, triples: 140, hops: 1 },
        mid: { entities: 110, triples: 260, hops: 2 },
        detail: { entities: 150, triples: 420, hops: 3 }
      }
      const tierDefaults = defaultsByTier[lodTier]
      const limitEntities = Math.max(5, Math.min(300, Math.floor(request?.limitEntities ?? tierDefaults.entities)))
      const limitTriplesRaw = Math.max(10, Math.min(900, Math.floor(request?.limitTriples ?? tierDefaults.triples)))
      const maxHops = Math.max(1, Math.min(3, Math.floor(request?.maxHops ?? tierDefaults.hops)))
      const maxEdgeDensity =
        typeof request?.maxEdgeDensity === 'number' && Number.isFinite(request.maxEdgeDensity)
          ? Math.max(0.05, Math.min(1, request.maxEdgeDensity))
          : 1
      const limitTriples = Math.max(10, Math.floor(limitTriplesRaw * maxEdgeDensity))
      const typeFilters = (request?.typeFilters ?? []).filter((v) => typeof v === 'string' && v.trim().length > 0)
      const predicateFilters = (request?.predicateFilters ?? []).filter(
        (v) => typeof v === 'string' && v.trim().length > 0
      )
      const recentOnlyMs =
        typeof request?.recentOnlyMs === 'number' && request.recentOnlyMs > 0 ? request.recentOnlyMs : undefined
      const recentCutoff = recentOnlyMs ? Date.now() - recentOnlyMs : undefined

      const focusSeed = request?.focusNodeId?.trim()
      let frontier = request?.query?.trim()
        ? seedEntitiesFromQuery(request.query, limitEntities, typeFilters)
        : listRecentEntitySeeds(limitEntities)
      if (focusSeed) {
        frontier = [focusSeed, ...frontier.filter((iri) => iri !== focusSeed)].slice(0, limitEntities)
      }
      if (frontier.length === 0) return { nodes: [], edges: [], truncated: false }

      const allIris = new Set<string>(frontier)
      const allEdges: OntologyEdge[] = []
      for (let hop = 0; hop < maxHops; hop++) {
        if (frontier.length === 0 || allEdges.length >= limitTriples) break
        const rows = selectTriplesByIri.all(
          JSON.stringify(frontier),
          JSON.stringify(frontier),
          Math.max(1, limitTriples - allEdges.length)
        ) as TripleRow[]
        const nextFrontier = new Set<string>()
        for (const row of rows) {
          if (recentCutoff && row.created_at < recentCutoff) continue
          if (predicateFilters.length > 0 && !predicateFilters.includes(row.predicate_iri)) continue
          allEdges.push(rowToEdge(row))
          allIris.add(row.subject_iri)
          if (row.object_iri) allIris.add(row.object_iri)
          if (row.subject_iri) nextFrontier.add(row.subject_iri)
          if (row.object_iri) nextFrontier.add(row.object_iri)
          if (allEdges.length >= limitTriples) break
        }
        frontier = [...nextFrontier].slice(0, limitEntities)
      }

      const nodes = (
        selectEntitiesByIri.all(JSON.stringify([...allIris].slice(0, limitEntities))) as EntityRow[]
      )
        .filter((row) => (typeFilters.length > 0 ? typeFilters.includes(row.type) : true))
        .map(
          (row) =>
            ({
              iri: row.iri,
              label: row.label,
              type: row.type,
              confidence: row.confidence
            }) satisfies OntologyNode
        )

      const allowed = new Set(nodes.map((n) => n.iri))
      const edges = allEdges.filter((e) => allowed.has(e.subjectIri) && (!e.objectIri || allowed.has(e.objectIri)))
      return {
        nodes,
        edges: edges.slice(0, limitTriples),
        truncated: edges.length > limitTriples || allIris.size > nodes.length
      }
    },

    entityDetails(iri: string, limit = 40): OntologyEntityDetails {
      const entity = (selectEntity.get(iri) as EntityRow | undefined) ?? null
      const outgoing = (selectOutgoing.all(iri, Math.max(1, Math.min(300, limit))) as TripleRow[]).map(rowToEdge)
      const incoming = (selectIncoming.all(iri, Math.max(1, Math.min(300, limit))) as TripleRow[]).map(rowToEdge)
      return {
        entity: entity
          ? {
              iri: entity.iri,
              label: entity.label,
              type: entity.type,
              confidence: entity.confidence
            }
          : null,
        outgoing,
        incoming
      }
    },

    rebuildSnapshot(): { ok: true; snapshotId: string } {
      const stats = this.getStats()
      const snapshotId = randomUUID()
      db.prepare('INSERT INTO ontology_snapshots (id, summary_json, created_at) VALUES (?, ?, ?)').run(
        snapshotId,
        JSON.stringify(stats),
        Date.now()
      )
      return { ok: true, snapshotId }
    },

    exportJsonLd(): Record<string, unknown> {
      const nsRows = db.prepare('SELECT prefix, base_iri FROM ontology_namespaces').all() as Array<{
        prefix: string
        base_iri: string
      }>
      const edges = db
        .prepare(
          `SELECT id, subject_iri, predicate_iri, object_iri, object_literal, source_type, source_ref, confidence, created_at
           FROM ontology_triples
           ORDER BY created_at DESC
           LIMIT 5000`
        )
        .all() as TripleRow[]
      return {
        '@context': Object.fromEntries(nsRows.map((row) => [row.prefix, row.base_iri])),
        generatedAt: Date.now(),
        triples: edges.map((e) => ({
          id: e.id,
          subject: e.subject_iri,
          predicate: e.predicate_iri,
          object: e.object_iri ?? e.object_literal,
          confidence: e.confidence,
          sourceType: e.source_type,
          sourceRef: e.source_ref,
          createdAt: e.created_at
        }))
      }
    }
  }
}
