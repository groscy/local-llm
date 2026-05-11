import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import type { OntologyService } from './ontologyService'
import * as chatService from './chatService'
import * as kbService from './kbService'
import * as metricsService from './metricsService'
import { appendLearningEvent, upsertDomainProfile } from './trainingWorkflowStore'
import { logLine } from '../logger'

const DEMO_SEED_BUNDLE_VERSION = 1
const DEMO_CONVERSATION_TITLE = 'Presentation kickoff'

type DemoSeedDeps = {
  db: Database.Database
  store: Store<Record<string, unknown>>
  ontology: OntologyService
}

function hasConversation(db: Database.Database): boolean {
  const row = db.prepare('SELECT id FROM conversations LIMIT 1').get() as { id: string } | undefined
  return Boolean(row?.id)
}

function hasKnowledgeSources(db: Database.Database): boolean {
  const row = db.prepare('SELECT id FROM kb_sources LIMIT 1').get() as { id: string } | undefined
  return Boolean(row?.id)
}

function seedConversation(db: Database.Database): { id: string } {
  const conversation = chatService.createConversation(db, DEMO_CONVERSATION_TITLE)
  chatService.appendMessage(
    db,
    conversation.id,
    'user',
    'Prepare a demo-ready workflow from setup to model training and release readiness.'
  )
  chatService.appendMessage(
    db,
    conversation.id,
    'assistant',
    [
      'Demo workflow prepared.',
      '1) Run: Start a local model.',
      '2) Knowledge: Capture domain context in wiki.',
      '3) Train: Approve evidence and launch a train job.',
      '4) Metrics: Verify runtime + quality signals.',
      '5) Release readiness: confirm feature confidence.'
    ].join('\n')
  )
  return conversation
}

function seedKnowledge(db: Database.Database, conversationId: string): void {
  kbService.ingestText(
    db,
    'Demo domain brief',
    'demo://brief',
    [
      '# Domain brief',
      'This sample workspace represents a support automation domain.',
      'Focus terms: onboarding, incident triage, release confidence.',
      'Use this source to demonstrate graph and ontology linkage.'
    ].join('\n'),
    undefined,
    conversationId
  )
  kbService.ingestText(
    db,
    'Demo training checklist',
    'demo://training-checklist',
    [
      '# Training checklist',
      '- Approve evidence cards that match business intent.',
      '- Choose a base model and dataset path.',
      '- Launch training and monitor throughput.',
      '- Validate resulting model behavior before release.'
    ].join('\n'),
    undefined,
    conversationId
  )
}

function seedOntology(ontology: OntologyService): void {
  ontology.ingestText({
    text: [
      'Support onboarding depends on incident triage quality.',
      'Release readiness requires metrics trend review and validated training outcomes.'
    ].join(' '),
    sourceType: 'demo_seed',
    sourceRef: 'demo://ontology/seed',
    confidence: 0.8,
    entityType: 'domain_concept'
  })
}

function seedTrainingDomain(db: Database.Database): void {
  const profile = upsertDomainProfile(db, {
    name: 'Support automation',
    terminology: ['onboarding', 'incident triage', 'release readiness', 'support workflow'],
    objective: 'Improve support workflow quality while maintaining response consistency.',
    allowedSources: ['electron', 'intellij-plugin'],
    retentionDays: 180
  })
  appendLearningEvent(db, {
    source: 'electron',
    actor: 'assistant',
    interactionType: 'tool_outcome',
    payloadRef: 'demo://seed/evidence',
    summary: 'Demo evidence card seeded for release-readiness walkthrough.',
    domainId: profile.id
  })
}

export async function ensureDemoSeeded({ db, store, ontology }: DemoSeedDeps): Promise<void> {
  const enabled = store.get('presentationModeEnabled') !== false
  if (!enabled) return
  const seededVersionRaw = store.get('demoSeedBundleVersion')
  const seededVersion =
    typeof seededVersionRaw === 'number' && Number.isFinite(seededVersionRaw) ? Math.floor(seededVersionRaw) : 0
  if (seededVersion >= DEMO_SEED_BUNDLE_VERSION) return

  if (!hasConversation(db) && !hasKnowledgeSources(db)) {
    const conversation = seedConversation(db)
    seedKnowledge(db, conversation.id)
    seedOntology(ontology)
    seedTrainingDomain(db)
    await metricsService.collectSnapshot(db, null)
    logLine('info', 'demo_seed_applied', { bundleVersion: DEMO_SEED_BUNDLE_VERSION })
  } else {
    logLine('info', 'demo_seed_skipped_existing_data', { bundleVersion: DEMO_SEED_BUNDLE_VERSION })
  }

  store.set('demoSeedBundleVersion', DEMO_SEED_BUNDLE_VERSION)
}
