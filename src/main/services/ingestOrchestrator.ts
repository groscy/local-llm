import type { CanonicalIngestRecord, IngestBatchResult } from '@shared/types'
import type { GraphWriteService } from './graphWriteService'
import { mapCanonicalRecordToOntology } from './ontologyMappingEngine'
import type { RuntimeAdapter } from './runtime/types'

export type IngestOrchestrator = {
  ingestRecord: (
    record: CanonicalIngestRecord,
    options?: {
      runtime?: RuntimeAdapter | null
    }
  ) => Promise<IngestBatchResult>
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
function refineUncertainCandidatesHeuristic(mapped: ReturnType<typeof mapCanonicalRecordToOntology>) {
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

function safeJsonObject(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function normalizeCandidateLabel(label: string): string {
  return label
    .replace(/[^\w\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

async function refineUncertainCandidatesWithRuntime(
  record: CanonicalIngestRecord,
  mapped: ReturnType<typeof mapCanonicalRecordToOntology>,
  runtime: RuntimeAdapter
): Promise<ReturnType<typeof mapCanonicalRecordToOntology> | null> {
  if (!runtime.getStatus().running) return null
  const uncertainEntities = mapped.entities.filter((entity) => confidenceUncertain(entity.confidence)).slice(0, 24)
  const uncertainRelations = mapped.relations.filter((relation) => confidenceUncertain(relation.confidence)).slice(0, 18)
  const uncertainDescriptors = mapped.descriptors
    .filter((descriptor) => confidenceUncertain(descriptor.confidence))
    .slice(0, 18)
  if (uncertainEntities.length + uncertainRelations.length + uncertainDescriptors.length === 0) return null

  const prompt = [
    'Refine uncertain extraction candidates for a local knowledge graph.',
    'Return JSON only with this shape:',
    '{"entities":[{"label":"...","confidence":0.0-1.0}],"relations":[{"from":"...","predicate":"app:uses","to":"...","confidence":0.0-1.0}],"descriptors":[{"label":"...","confidence":0.0-1.0}]}',
    'Rules:',
    '- Keep labels concise noun phrases.',
    '- Use only app:* predicates.',
    '- Drop noisy, generic, or malformed candidates.',
    '',
    `Title: ${record.title}`,
    `Body sample: ${record.body.slice(0, 6000)}`,
    `Uncertain entities: ${JSON.stringify(uncertainEntities.map((entity) => ({ label: entity.label, confidence: entity.confidence })))}`,
    `Uncertain relations: ${JSON.stringify(
      uncertainRelations.map((relation) => ({
        from: relation.fromEntityLabel,
        predicate: relation.predicate,
        to: relation.toEntityLabel,
        confidence: relation.confidence
      }))
    )}`,
    `Uncertain descriptors: ${JSON.stringify(
      uncertainDescriptors.map((descriptor) => ({ label: descriptor.label, confidence: descriptor.confidence }))
    )}`
  ].join('\n')

  let raw = ''
  try {
    raw = await runtime.chat(
      [
        {
          role: 'system',
          content: 'You are a strict JSON information extraction refiner. Output valid JSON only.'
        },
        { role: 'user', content: prompt }
      ],
      { maxTokens: 700, temperature: 0.1, topP: 0.9 }
    )
  } catch {
    return null
  }
  const parsed = safeJsonObject(raw) as
    | {
        entities?: Array<{ label?: string; confidence?: number }>
        relations?: Array<{ from?: string; predicate?: string; to?: string; confidence?: number }>
        descriptors?: Array<{ label?: string; confidence?: number }>
      }
    | null
  if (!parsed) {
    console.warn('[ingestOrchestrator] LLM returned non-JSON response; falling back to heuristic.', raw.slice(0, 120))
    return null
  }
  const missingKeys = (['entities', 'relations', 'descriptors'] as const).filter((k) => !(k in parsed))
  if (missingKeys.length > 0) {
    console.warn('[ingestOrchestrator] LLM response missing keys, filling with heuristic:', missingKeys.join(', '))
  }

  const entityByLabel = new Map(mapped.entities.map((entity) => [normalizeCandidateLabel(entity.label).toLowerCase(), entity]))
  const refinedEntities = (parsed.entities ?? [])
    .map((entity) => {
      const label = normalizeCandidateLabel(String(entity.label ?? ''))
      if (!label) return null
      const base = entityByLabel.get(label.toLowerCase())
      if (!base) return null
      return {
        ...base,
        label,
        confidence: Math.max(base.confidence, Math.min(0.92, Number(entity.confidence ?? base.confidence))),
        confidenceReasons: [...(base.confidenceReasons ?? []), 'runtime_refined_uncertain_candidate']
      }
    })
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))

  const refinedRelationList = (parsed.relations ?? [])
    .map((relation) => {
      const from = normalizeCandidateLabel(String(relation.from ?? ''))
      const to = normalizeCandidateLabel(String(relation.to ?? ''))
      const predicate = String(relation.predicate ?? '').trim()
      if (!from || !to || from === to) return null
      if (!/^app:[A-Za-z][A-Za-z0-9]+$/.test(predicate)) return null
      const base = mapped.relations.find(
        (candidate) =>
          normalizeCandidateLabel(candidate.fromEntityLabel).toLowerCase() === from.toLowerCase() &&
          normalizeCandidateLabel(candidate.toEntityLabel).toLowerCase() === to.toLowerCase() &&
          candidate.predicate === predicate
      )
      if (!base) return null
      return {
        ...base,
        fromEntityLabel: from,
        toEntityLabel: to,
        confidence: Math.max(base.confidence, Math.min(0.94, Number(relation.confidence ?? base.confidence))),
        confidenceReasons: [...(base.confidenceReasons ?? []), 'runtime_refined_uncertain_candidate']
      }
    })
    .filter((relation): relation is NonNullable<typeof relation> => Boolean(relation))

  const descriptorByLabel = new Map(
    mapped.descriptors.map((descriptor) => [normalizeCandidateLabel(descriptor.label).toLowerCase(), descriptor])
  )
  const refinedDescriptors = (parsed.descriptors ?? [])
    .map((descriptor) => {
      const label = normalizeCandidateLabel(String(descriptor.label ?? ''))
      if (!label) return null
      const base = descriptorByLabel.get(label.toLowerCase())
      if (!base) return null
      return {
        ...base,
        label,
        confidence: Math.max(base.confidence, Math.min(0.88, Number(descriptor.confidence ?? base.confidence))),
        confidenceReasons: [...(base.confidenceReasons ?? []), 'runtime_refined_uncertain_candidate']
      }
    })
    .filter((descriptor): descriptor is NonNullable<typeof descriptor> => Boolean(descriptor))

  return {
    entities: mapped.entities.map((entity) => {
      const replacement = refinedEntities.find(
        (candidate) => normalizeCandidateLabel(candidate.label).toLowerCase() === normalizeCandidateLabel(entity.label).toLowerCase()
      )
      return replacement ?? entity
    }),
    relations: mapped.relations.map((relation) => {
      const replacement = refinedRelationList.find(
        (candidate) =>
          normalizeCandidateLabel(candidate.fromEntityLabel).toLowerCase() ===
            normalizeCandidateLabel(relation.fromEntityLabel).toLowerCase() &&
          normalizeCandidateLabel(candidate.toEntityLabel).toLowerCase() ===
            normalizeCandidateLabel(relation.toEntityLabel).toLowerCase() &&
          candidate.predicate === relation.predicate
      )
      return replacement ?? relation
    }),
    descriptors: mapped.descriptors.map((descriptor) => {
      const replacement = refinedDescriptors.find(
        (candidate) =>
          normalizeCandidateLabel(candidate.label).toLowerCase() === normalizeCandidateLabel(descriptor.label).toLowerCase()
      )
      return replacement ?? descriptor
    })
  }
}

/**
 * Deterministic in-process pipeline:
 * Normalize -> ExtractCandidates -> Resolve+Validate -> Upsert.
 */
export function createIngestOrchestrator(writer: GraphWriteService): IngestOrchestrator {
  return {
    async ingestRecord(record, options) {
      const mapped = mapCanonicalRecordToOntology(record)
      const hasUncertain =
        mapped.entities.some((x) => confidenceUncertain(x.confidence)) ||
        mapped.relations.some((x) => confidenceUncertain(x.confidence)) ||
        mapped.descriptors.some((x) => confidenceUncertain(x.confidence))
      let refined = hasUncertain ? refineUncertainCandidatesHeuristic(mapped) : mapped
      let refinementMode: 'none' | 'heuristic_llm_fallback' | 'runtime_json_refinement' = hasUncertain
        ? 'heuristic_llm_fallback'
        : 'none'
      if (hasUncertain && options?.runtime) {
        const runtimeRefined = await refineUncertainCandidatesWithRuntime(record, refined, options.runtime)
        if (runtimeRefined) {
          refined = runtimeRefined
          refinementMode = 'runtime_json_refinement'
        }
      }
      return writer.ingestCanonicalRecord(record, {
        entities: refined.entities,
        relations: refined.relations,
        descriptors: refined.descriptors,
        refinementMode
      })
    }
  }
}
