import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type {
  CanonicalEntityCandidate,
  CanonicalIngestRecord,
  CanonicalRelationCandidate,
  IngestBatchResult
} from '@shared/types'
import { createOntologyService, type OntologyService } from './ontologyService'

export type GraphWriteService = {
  ingestCanonicalRecord: (
    record: CanonicalIngestRecord,
    extracted?: {
      entities?: CanonicalEntityCandidate[]
      relations?: CanonicalRelationCandidate[]
      descriptors?: CanonicalEntityCandidate[]
      refinementMode?: 'none' | 'heuristic_llm_fallback'
    }
  ) => IngestBatchResult
}

type GraphWriteServiceDeps = {
  db: Database.Database
  ontology?: OntologyService
}

type QualityGateDecision = {
  accepted: boolean
  reasons: string[]
}

const NOISY_TERMS = new Set([
  'article',
  'context',
  'document',
  'example',
  'information',
  'keyword',
  'note',
  'section',
  'summary',
  'text',
  'thing'
])

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | undefined
  return Boolean(row?.ok)
}

function semanticSourceType(record: CanonicalIngestRecord): 'pdf' | 'text' | 'codebase' | 'chat' | 'other' {
  if (record.metadata?.sourceKind === 'pdf') return 'pdf'
  if (record.provenance.sourceType === 'codebase') return 'codebase'
  if (record.provenance.sourceType === 'chat') return 'chat'
  return 'text'
}

function canonicalLabel(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[`"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function canonicalIri(label: string): string {
  const slug = slugify(label)
  return `kg:keyword:${slug || 'unknown'}`
}

function canonicalScopeIri(label: string): string {
  const slug = slugify(label)
  return `kg:scope:${slug || 'unknown'}`
}

function qualityGateEntity(entity: CanonicalEntityCandidate): QualityGateDecision {
  const reasons: string[] = []
  const label = canonicalLabel(entity.label)
  const words = label.split(/\s+/).filter(Boolean)
  if (!label) reasons.push('empty_label')
  if (entity.confidence < 0.54) reasons.push('low_confidence')
  if (words.length === 0) reasons.push('no_words')
  if (words.length > 7) reasons.push('label_too_long')
  if (words.some((w) => NOISY_TERMS.has(w.toLowerCase()))) reasons.push('blocked_term')
  if (/https?:\/\//i.test(label)) reasons.push('url_like')
  if (/^[a-f0-9]{12,}$/i.test(label)) reasons.push('hash_like')
  if (/[{}[\]<>]/.test(label)) reasons.push('markup_noise')
  return { accepted: reasons.length === 0, reasons }
}

function qualityGateRelation(relation: CanonicalRelationCandidate): QualityGateDecision {
  const reasons: string[] = []
  const from = canonicalLabel(relation.fromEntityLabel)
  const to = canonicalLabel(relation.toEntityLabel)
  if (!from || !to) reasons.push('missing_endpoint')
  if (from.toLowerCase() === to.toLowerCase()) reasons.push('self_relation')
  if (relation.confidence < 0.55) reasons.push('low_confidence')
  if (!/^app:[A-Za-z][A-Za-z0-9]+$/.test(relation.predicate || '')) reasons.push('predicate_invalid')
  if (NOISY_TERMS.has(from.toLowerCase()) || NOISY_TERMS.has(to.toLowerCase())) reasons.push('blocked_endpoint')
  return { accepted: reasons.length === 0, reasons }
}

export function createGraphWriteService(deps: GraphWriteServiceDeps): GraphWriteService {
  const ontology = deps.ontology ?? createOntologyService(deps.db)
  const hasRejectionTable = tableExists(deps.db, 'semantic_rejection_events')
  const ensureCoreEntity = deps.db.prepare(
    `INSERT INTO kg_core_entities (id, iri, label, entity_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(iri) DO UPDATE SET
       label = excluded.label,
       entity_type = excluded.entity_type,
       updated_at = excluded.updated_at`
  )
  const ensureProvenance = deps.db.prepare(
    `INSERT INTO kg_core_provenance
      (id, source_system, source_type, source_record_id, source_uri, source_checksum, ingest_run_id, observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const ensureRelation = deps.db.prepare(
    `INSERT INTO kg_core_relations
      (id, subject_iri, predicate_iri, object_iri, object_literal, confidence, source_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertRejection = hasRejectionTable
    ? deps.db.prepare(
        `INSERT INTO semantic_rejection_events
          (id, source_ref, candidate_type, candidate_label, confidence, reasons_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
    : null
  return {
    ingestCanonicalRecord(record, extracted) {
      const runId = record.provenance.ingestRunId
      const body = record.body.trim()
      if (!body) {
        return {
          runId,
          recordsProcessed: 1,
          recordsSucceeded: 0,
          recordsFailed: 1,
          entitiesWritten: 0,
          relationsWritten: 0,
          warnings: ['empty_record_body']
        }
      }
      const result = ontology.ingestText({
        text: body,
        sourceType: semanticSourceType(record),
        sourceRef: record.provenance.sourceRecordId || record.id,
        confidence: 0.74,
        entityType: 'concept'
      })
      const now = Date.now()
      const entityCandidates = extracted?.entities ?? []
      const relationCandidates = extracted?.relations ?? []
      const descriptorCandidates = extracted?.descriptors ?? []
      const scopeLabels = new Set<string>()
      const canonicalEntityBySlug = new Map<string, string>()
      const qualityFlags = new Set<string>()
      let entityWrites = 0
      for (const entity of entityCandidates) {
        const label = canonicalLabel(entity.label)
        const gate = qualityGateEntity(entity)
        if (!gate.accepted) {
          qualityFlags.add('entity_rejected')
          if (insertRejection) {
            insertRejection.run(
              randomUUID(),
              record.provenance.sourceRecordId || record.id,
              'entity',
              label,
              entity.confidence,
              JSON.stringify(gate.reasons),
              now
            )
          }
          continue
        }
        const iri = canonicalIri(label)
        canonicalEntityBySlug.set(slugify(label), iri)
        ensureCoreEntity.run(randomUUID(), iri, label, 'keyword', now, now)
        entityWrites++
      }
      for (const descriptor of descriptorCandidates) {
        if (descriptor.entityType !== 'descriptor') continue
        const bits = descriptor.label.trim().split(/\s+/)
        if (bits.length < 2) continue
        const adjective = bits[0] ?? ''
        const target = bits.slice(1).join(' ')
        if (!target) continue
        const scope = `${adjective.toLowerCase()} context`
        scopeLabels.add(scope)
        const scopeIri = canonicalScopeIri(scope)
        const targetIri = canonicalIri(target)
        ensureCoreEntity.run(randomUUID(), scopeIri, scope, 'scope', now, now)
        ensureRelation.run(
          randomUUID(),
          targetIri,
          'app:describedBy',
          scopeIri,
          null,
          Math.max(0.4, Math.min(1, descriptor.confidence)),
          record.provenance.sourceRecordId || record.id,
          now
        )
      }
      let relationWrites = 0
      for (const rel of relationCandidates) {
        const from = canonicalLabel(rel.fromEntityLabel)
        const to = canonicalLabel(rel.toEntityLabel)
        const gate = qualityGateRelation({
          ...rel,
          fromEntityLabel: from,
          toEntityLabel: to
        })
        if (!gate.accepted) {
          qualityFlags.add('relation_rejected')
          if (insertRejection) {
            insertRejection.run(
              randomUUID(),
              record.provenance.sourceRecordId || record.id,
              'relation',
              `${from} -> ${to}`,
              rel.confidence,
              JSON.stringify(gate.reasons),
              now
            )
          }
          continue
        }
        const fromIri = canonicalEntityBySlug.get(slugify(from)) ?? canonicalIri(from)
        const toIri = canonicalEntityBySlug.get(slugify(to)) ?? canonicalIri(to)
        const predicate = rel.predicate.trim() || 'app:relatedTo'
        ensureCoreEntity.run(randomUUID(), fromIri, from, 'keyword', now, now)
        ensureCoreEntity.run(randomUUID(), toIri, to, 'keyword', now, now)
        ensureRelation.run(
          randomUUID(),
          fromIri,
          predicate,
          toIri,
          null,
          Math.max(0.2, Math.min(1, rel.confidence)),
          record.provenance.sourceRecordId || record.id,
          now
        )
        relationWrites++
      }
      try {
        ensureProvenance.run(
          randomUUID(),
          record.provenance.sourceSystem,
          record.provenance.sourceType,
          record.provenance.sourceRecordId,
          record.provenance.sourceUri ?? null,
          record.provenance.sourceChecksum ?? null,
          record.provenance.ingestRunId,
          record.provenance.observedAt,
          now
        )
      } catch {
        // provenance rows are append-only diagnostics; collisions should not fail ingestion
      }
      return {
        runId,
        recordsProcessed: 1,
        recordsSucceeded: 1,
        recordsFailed: 0,
        entitiesWritten: result.entities + entityWrites + scopeLabels.size,
        relationsWritten: result.triples + relationWrites,
        warnings: [
          ...(extracted?.refinementMode === 'heuristic_llm_fallback' ? ['llm_refinement_fallback_applied'] : []),
          ...[...qualityFlags]
        ]
      }
    }
  }
}
