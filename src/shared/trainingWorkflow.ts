import type { EvidenceCard, LearningEvent, TrainingExample, TrainingManifest } from './types'
function stableHash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `fnv1a-${(h >>> 0).toString(16)}`
}


function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function serializeLearningEvent(event: LearningEvent): string {
  return JSON.stringify(event)
}

export function parseLearningEvent(raw: string): LearningEvent | null {
  try {
    return JSON.parse(raw) as LearningEvent
  } catch {
    return null
  }
}

export function serializeEvidenceCard(card: EvidenceCard): string {
  return JSON.stringify(card)
}

export function parseEvidenceCard(raw: string): EvidenceCard | null {
  try {
    return JSON.parse(raw) as EvidenceCard
  } catch {
    return null
  }
}

export function renderEvidenceCardMarkdown(card: EvidenceCard): string {
  const tags = card.tags.length ? card.tags.map((t) => `\`${t}\``).join(', ') : '_none_'
  return [
    `### ${clip(card.summary, 120)}`,
    '',
    `- Status: **${card.status}**`,
    `- Provenance: \`${card.provenance}\``,
    `- Confidence: **${Math.round(card.confidence * 100)}%**`,
    `- Novelty: **${Math.round(card.noveltyScore * 100)}%**`,
    `- Tags: ${tags}`,
    `- Supporting events: ${card.supportingEventIds.length}`,
    ''
  ].join('\n')
}

export function renderTrainingExampleMarkdown(example: TrainingExample): string {
  return [
    `### Example ${example.id.slice(0, 8)}`,
    '',
    `**Instruction**: ${clip(example.instruction, 180)}`,
    '',
    `**Context**: ${clip(example.context, 220)}`,
    '',
    `**Preferred output**: ${clip(example.preferredOutput, 220)}`,
    '',
    `**Rationale**: ${clip(example.rationale, 180)}`,
    ''
  ].join('\n')
}

export function buildTrainingManifest(input: {
  id: string
  domainId?: string | null
  modelBase: string
  datasetPath: string
  outputDir: string
  events: LearningEvent[]
  cards: EvidenceCard[]
  examples: TrainingExample[]
  sourceIds?: string[]
}): TrainingManifest {
  const payloadHash = stableHash(
    JSON.stringify({
      domainId: input.domainId ?? null,
      events: input.events.map((e) => e.id),
      cards: input.cards.map((c) => c.id),
      examples: input.examples.map((e) => e.id),
      modelBase: input.modelBase
    })
  )

  const previewMarkdown = [
    '# Training Manifest',
    '',
    `- Domain: ${input.domainId ?? 'global'}`,
    `- Base model: \`${input.modelBase}\``,
    `- Dataset path: \`${input.datasetPath}\``,
    `- Output dir: \`${input.outputDir}\``,
    `- Events: **${input.events.length}**`,
    `- Evidence cards: **${input.cards.length}**`,
    `- Examples: **${input.examples.length}**`,
    '',
    '## Included Evidence',
    ...input.cards.slice(0, 12).map((c) => `- ${clip(c.summary, 120)} (${Math.round(c.confidence * 100)}%)`)
  ].join('\n')

  return {
    id: input.id,
    domainId: input.domainId ?? null,
    datasetHash: payloadHash,
    filters: {
      sourceIds: input.sourceIds,
      domainId: input.domainId ?? undefined,
      approvedOnly: true
    },
    counts: {
      events: input.events.length,
      evidenceCards: input.cards.length,
      examples: input.examples.length
    },
    modelBase: input.modelBase,
    runParams: {
      datasetPath: input.datasetPath,
      outputDir: input.outputDir
    },
    previewMarkdown,
    createdAt: Date.now()
  }
}
