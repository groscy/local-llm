import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { buildTrainingManifest } from '@shared/trainingWorkflow'
import type {
  DomainModelVersion,
  DomainProfile,
  EvidenceCard,
  LearningEvent,
  LearningEventInteractionType,
  LearningEventSource,
  TrainingExample,
  TrainingManifest
} from '@shared/types'

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function toDomainProfile(row: Record<string, unknown>): DomainProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    terminology: parseJsonArray((row.terminology_json as string | null) ?? null),
    objective: String(row.objective ?? ''),
    allowedSources: parseJsonArray((row.allowed_sources_json as string | null) ?? null).filter(
      (x): x is LearningEventSource => x === 'electron' || x === 'intellij-plugin'
    ),
    retentionDays: Number(row.retention_days ?? 90),
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now())
  }
}

function inferDomainId(summary: string, profiles: DomainProfile[]): string | null {
  const hay = summary.toLowerCase()
  let best: { id: string; score: number } | null = null
  for (const p of profiles) {
    let score = 0
    for (const term of p.terminology) {
      const t = term.trim().toLowerCase()
      if (t && hay.includes(t)) score++
    }
    if (!best || score > best.score) best = { id: p.id, score }
  }
  return best && best.score > 0 ? best.id : null
}

function summarizeInteraction(kind: LearningEventInteractionType, summary: string): string {
  const s = summary.replace(/\s+/g, ' ').trim()
  if (s) return s.slice(0, 400)
  return kind.replace(/_/g, ' ')
}

function cardTags(kind: LearningEventInteractionType, summary: string): string[] {
  const out: string[] = [kind]
  const s = summary.toLowerCase()
  if (s.includes('error') || s.includes('failed')) out.push('failure')
  if (s.includes('apply') || s.includes('accepted')) out.push('accepted')
  if (s.includes('chat')) out.push('chat')
  if (s.includes('wiki')) out.push('wiki')
  return [...new Set(out)]
}

export function listDomainProfiles(db: Database.Database): DomainProfile[] {
  const rows = db
    .prepare('SELECT * FROM domain_profiles ORDER BY updated_at DESC, created_at DESC')
    .all() as Record<string, unknown>[]
  return rows.map(toDomainProfile)
}

export function upsertDomainProfile(
  db: Database.Database,
  input: Omit<DomainProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): DomainProfile {
  const t = Date.now()
  const id = input.id?.trim() || randomUUID()
  const existing = db.prepare('SELECT id FROM domain_profiles WHERE id = ?').get(id) as { id: string } | undefined
  if (existing) {
    db.prepare(
      `UPDATE domain_profiles
       SET name = ?, terminology_json = ?, objective = ?, allowed_sources_json = ?, retention_days = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.name.trim(),
      JSON.stringify(input.terminology),
      input.objective.trim(),
      JSON.stringify(input.allowedSources),
      input.retentionDays,
      t,
      id
    )
  } else {
    db.prepare(
      `INSERT INTO domain_profiles
       (id, name, terminology_json, objective, allowed_sources_json, retention_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name.trim(),
      JSON.stringify(input.terminology),
      input.objective.trim(),
      JSON.stringify(input.allowedSources),
      input.retentionDays,
      t,
      t
    )
  }
  return (
    listDomainProfiles(db).find((p) => p.id === id) ?? {
      id,
      name: input.name.trim(),
      terminology: input.terminology,
      objective: input.objective.trim(),
      allowedSources: input.allowedSources,
      retentionDays: input.retentionDays,
      createdAt: t,
      updatedAt: t
    }
  )
}

export function listLearningEvents(
  db: Database.Database,
  opts: { domainId?: string; source?: LearningEventSource; limit?: number } = {}
): LearningEvent[] {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.domainId) {
    where.push('domain_id = ?')
    params.push(opts.domainId)
  }
  if (opts.source) {
    where.push('source = ?')
    params.push(opts.source)
  }
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200))
  const sql = `SELECT * FROM learning_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY timestamp DESC LIMIT ?`
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
  return rows.map((row) => ({
    id: String(row.id),
    source: row.source as LearningEventSource,
    domainId: (row.domain_id as string | null) ?? null,
    actor: String(row.actor),
    timestamp: Number(row.timestamp),
    interactionType: row.interaction_type as LearningEventInteractionType,
    payloadRef: String(row.payload_ref),
    privacyLevel: 'strict_private',
    summary: String(row.summary ?? ''),
    detailsJson: (row.details_json as string | null) ?? undefined
  }))
}

export function appendLearningEvent(
  db: Database.Database,
  input: {
    source: LearningEventSource
    actor: string
    interactionType: LearningEventInteractionType
    payloadRef: string
    summary: string
    details?: Record<string, unknown>
    domainId?: string | null
  }
): LearningEvent {
  const profiles = listDomainProfiles(db)
  const t = Date.now()
  const id = randomUUID()
  const inferredDomainId =
    input.domainId === undefined ? inferDomainId(input.summary, profiles) : (input.domainId ?? null)
  const summary = summarizeInteraction(input.interactionType, input.summary)
  const detailsJson = input.details ? JSON.stringify(input.details) : null
  db.prepare(
    `INSERT INTO learning_events
     (id, source, domain_id, actor, timestamp, interaction_type, payload_ref, privacy_level, summary, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'strict_private', ?, ?)`
  ).run(
    id,
    input.source,
    inferredDomainId,
    input.actor.trim() || 'user',
    t,
    input.interactionType,
    input.payloadRef,
    summary,
    detailsJson
  )

  const confidence = input.source === 'intellij-plugin' ? 0.72 : 0.64
  const noveltyScore = input.summary.length > 140 ? 0.68 : 0.44
  const cardId = randomUUID()
  db.prepare(
    `INSERT INTO evidence_cards
     (id, domain_id, summary, supporting_event_ids_json, confidence, novelty_score, tags_json, provenance, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    cardId,
    inferredDomainId,
    summary,
    JSON.stringify([id]),
    confidence,
    noveltyScore,
    JSON.stringify(cardTags(input.interactionType, input.summary)),
    input.source,
    t,
    t
  )

  return {
    id,
    source: input.source,
    domainId: inferredDomainId,
    actor: input.actor.trim() || 'user',
    timestamp: t,
    interactionType: input.interactionType,
    payloadRef: input.payloadRef,
    privacyLevel: 'strict_private',
    summary,
    detailsJson: detailsJson ?? undefined
  }
}

export function listEvidenceCards(
  db: Database.Database,
  opts: { status?: EvidenceCard['status']; domainId?: string; limit?: number } = {}
): EvidenceCard[] {
  const where: string[] = []
  const args: unknown[] = []
  if (opts.status) {
    where.push('status = ?')
    args.push(opts.status)
  }
  if (opts.domainId) {
    where.push('domain_id = ?')
    args.push(opts.domainId)
  }
  const limit = Math.max(1, Math.min(400, opts.limit ?? 120))
  const sql = `SELECT * FROM evidence_cards ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`
  args.push(limit)
  const rows = db.prepare(sql).all(...args) as Record<string, unknown>[]
  return rows.map((row) => ({
    id: String(row.id),
    domainId: (row.domain_id as string | null) ?? null,
    summary: String(row.summary),
    supportingEventIds: parseJsonArray((row.supporting_event_ids_json as string | null) ?? null),
    confidence: Number(row.confidence ?? 0),
    noveltyScore: Number(row.novelty_score ?? 0),
    tags: parseJsonArray((row.tags_json as string | null) ?? null),
    provenance: row.provenance as LearningEventSource,
    status: row.status as EvidenceCard['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }))
}

export function updateEvidenceCardStatus(
  db: Database.Database,
  cardId: string,
  status: EvidenceCard['status']
): EvidenceCard | null {
  const t = Date.now()
  const res = db.prepare('UPDATE evidence_cards SET status = ?, updated_at = ? WHERE id = ?').run(status, t, cardId)
  if (!res.changes) return null
  return listEvidenceCards(db, { limit: 500 }).find((c) => c.id === cardId) ?? null
}

export function buildApprovedTrainingExamples(
  db: Database.Database,
  opts: { domainId?: string | null } = {}
): TrainingExample[] {
  const cards = listEvidenceCards(db, { status: 'approved', domainId: opts.domainId ?? undefined, limit: 400 })
  return cards.map((c) => ({
    id: c.id,
    domainId: c.domainId ?? null,
    instruction: `Use domain evidence to answer accurately: ${c.summary}`,
    context: `Detected tags: ${c.tags.join(', ') || 'none'}`,
    preferredOutput: `A concise response grounded in: ${c.summary}`,
    rationale: `Derived from approved evidence card (${c.provenance}).`,
    provenanceEventIds: c.supportingEventIds
  }))
}

export function buildManifestFromApproved(
  db: Database.Database,
  opts: {
    id: string
    domainId?: string | null
    baseModelPath: string
    datasetPath: string
    outputDir: string
    sourceIds?: string[]
  }
): TrainingManifest {
  const domainId = opts.domainId ?? null
  const events = listLearningEvents(db, { domainId: domainId ?? undefined, limit: 800 })
  const cards = listEvidenceCards(db, { status: 'approved', domainId: domainId ?? undefined, limit: 800 })
  const examples = buildApprovedTrainingExamples(db, { domainId })
  const manifest = buildTrainingManifest({
    id: opts.id,
    domainId,
    modelBase: opts.baseModelPath,
    datasetPath: opts.datasetPath,
    outputDir: opts.outputDir,
    events,
    cards,
    examples,
    sourceIds: opts.sourceIds
  })
  db.prepare(
    `INSERT OR REPLACE INTO training_manifests
     (id, domain_id, dataset_hash, filters_json, counts_json, model_base, run_params_json, preview_markdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    manifest.id,
    manifest.domainId ?? null,
    manifest.datasetHash,
    JSON.stringify(manifest.filters),
    JSON.stringify(manifest.counts),
    manifest.modelBase,
    JSON.stringify(manifest.runParams),
    manifest.previewMarkdown,
    manifest.createdAt
  )
  return manifest
}

export function listDomainModelVersions(db: Database.Database, domainId?: string): DomainModelVersion[] {
  const rows = domainId
    ? (db
        .prepare('SELECT * FROM domain_model_versions WHERE domain_id = ? ORDER BY created_at DESC')
        .all(domainId) as Record<string, unknown>[])
    : (db.prepare('SELECT * FROM domain_model_versions ORDER BY created_at DESC').all() as Record<string, unknown>[])
  return rows.map((row) => ({
    id: String(row.id),
    domainId: String(row.domain_id),
    trainJobId: String(row.train_job_id),
    artifactPath: String(row.artifact_path),
    qualitySummary: String(row.quality_summary),
    regressionRisk: row.regression_risk as DomainModelVersion['regressionRisk'],
    createdAt: Number(row.created_at)
  }))
}

export function recordDomainModelVersion(
  db: Database.Database,
  payload: {
    domainId: string
    trainJobId: string
    artifactPath: string
    qualitySummary: string
    regressionRisk: DomainModelVersion['regressionRisk']
  }
): DomainModelVersion {
  const id = randomUUID()
  const t = Date.now()
  db.prepare(
    `INSERT INTO domain_model_versions
     (id, domain_id, train_job_id, artifact_path, quality_summary, regression_risk, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.domainId,
    payload.trainJobId,
    payload.artifactPath,
    payload.qualitySummary,
    payload.regressionRisk,
    t
  )
  return {
    id,
    domainId: payload.domainId,
    trainJobId: payload.trainJobId,
    artifactPath: payload.artifactPath,
    qualitySummary: payload.qualitySummary,
    regressionRisk: payload.regressionRisk,
    createdAt: t
  }
}
