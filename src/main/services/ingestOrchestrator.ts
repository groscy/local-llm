import type { CanonicalIngestRecord, IngestBatchResult } from '@shared/types'
import type { GraphWriteService } from './graphWriteService'
import { mapCanonicalRecordToOntology } from './ontologyMappingEngine'

export type IngestOrchestrator = {
  ingestRecord: (record: CanonicalIngestRecord) => IngestBatchResult
}

function confidenceUncertain(value: number): boolean {
  return !Number.isFinite(value) || value < 0.68
}

function refineEntityLabel(label: string): string {
  return label
    .replace(/[^\w\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Placeholder "LLM refinement" path: this keeps the architecture of a cascaded
 * deterministic->LLM pipeline while using a deterministic fallback when no
 * dedicated refinement model/runtime is supplied.
 */
function refineUncertainCandidates(mapped: ReturnType<typeof mapCanonicalRecordToOntology>) {
  const entities = mapped.entities.map((entity) => {
    if (!confidenceUncertain(entity.confidence)) return entity
    const label = refineEntityLabel(entity.label)
    if (!label || label.length < 3) return null
    return {
      ...entity,
      label,
      confidence: Math.min(0.72, Math.max(0.48, entity.confidence + 0.03)),
      confidenceReasons: [...(entity.confidenceReasons ?? []), 'uncertainty_gate_refined']
    }
  }).filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
  const relations = mapped.relations
    .map((relation) => {
      if (!confidenceUncertain(relation.confidence)) return relation
      const fromEntityLabel = refineEntityLabel(relation.fromEntityLabel)
      const toEntityLabel = refineEntityLabel(relation.toEntityLabel)
      if (!fromEntityLabel || !toEntityLabel || fromEntityLabel === toEntityLabel) return null
      return {
        ...relation,
        fromEntityLabel,
        toEntityLabel,
        confidence: Math.min(0.72, Math.max(0.5, relation.confidence + 0.04)),
        confidenceReasons: [...(relation.confidenceReasons ?? []), 'uncertainty_gate_refined']
      }
    })
    .filter((relation): relation is NonNullable<typeof relation> => Boolean(relation))
  const descriptors = mapped.descriptors.map((descriptor) => {
    if (!confidenceUncertain(descriptor.confidence)) return descriptor
    const label = refineEntityLabel(descriptor.label)
    if (!label || label.length < 3) return null
    return {
      ...descriptor,
      label,
      confidence: Math.min(0.68, Math.max(0.46, descriptor.confidence + 0.04)),
      confidenceReasons: [...(descriptor.confidenceReasons ?? []), 'uncertainty_gate_refined']
    }
  }).filter((descriptor): descriptor is NonNullable<typeof descriptor> => Boolean(descriptor))
  return { entities, relations, descriptors }
}

/**
 * Deterministic in-process pipeline:
 * Normalize -> ExtractCandidates -> Resolve+Validate -> Upsert.
 */
export function createIngestOrchestrator(writer: GraphWriteService): IngestOrchestrator {
  return {
    ingestRecord(record) {
      const mapped = mapCanonicalRecordToOntology(record)
      const hasUncertain =
        mapped.entities.some((x) => confidenceUncertain(x.confidence)) ||
        mapped.relations.some((x) => confidenceUncertain(x.confidence)) ||
        mapped.descriptors.some((x) => confidenceUncertain(x.confidence))
      const refined = hasUncertain ? refineUncertainCandidates(mapped) : mapped
      return writer.ingestCanonicalRecord(record, {
        entities: refined.entities,
        relations: refined.relations,
        descriptors: refined.descriptors,
        refinementMode: hasUncertain ? 'heuristic_llm_fallback' : 'none'
      })
    }
  }
}
