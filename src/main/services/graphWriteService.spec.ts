import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrations'
import { createGraphWriteService } from './graphWriteService'
import type { CanonicalIngestRecord } from '@shared/types'

function sampleRecord(): CanonicalIngestRecord {
  return {
    id: 'rec-1',
    recordType: 'document',
    title: 'Quality test',
    body: 'Routing Engine uses Health Monitor. Context should not be a keyword.',
    provenance: {
      sourceSystem: 'kb',
      sourceType: 'text',
      sourceRecordId: 'src-1',
      sourceUri: 'file://quality.md',
      sourceChecksum: 'abc',
      ingestRunId: 'run-1',
      observedAt: Date.now()
    }
  }
}

describe('graphWriteService quality gates', () => {
  const canOpenSqlite = (() => {
    try {
      const probe = new Database(':memory:')
      probe.close()
      return true
    } catch {
      return false
    }
  })()
  const maybeIt = canOpenSqlite ? it : it.skip

  maybeIt('rejects noisy entities and records rejection events', () => {
    const db = new Database(':memory:')
    migrate(db)
    const writer = createGraphWriteService({ db })
    const out = writer.ingestCanonicalRecord(sampleRecord(), {
      entities: [
        { recordId: 'rec-1', label: 'Routing Engine', entityType: 'concept', confidence: 0.88 },
        { recordId: 'rec-1', label: 'context', entityType: 'concept', confidence: 0.96 }
      ],
      relations: [
        {
          recordId: 'rec-1',
          fromEntityLabel: 'Routing Engine',
          toEntityLabel: 'Health Monitor',
          predicate: 'app:uses',
          confidence: 0.86
        }
      ]
    })
    const noisy = db
      .prepare("SELECT COUNT(*) as c FROM kg_core_entities WHERE label = 'context'")
      .get() as { c: number }
    const rejections = db
      .prepare("SELECT COUNT(*) as c FROM semantic_rejection_events WHERE candidate_type = 'entity'")
      .get() as { c: number }
    expect(out.warnings).toContain('entity_rejected')
    expect(noisy.c).toBe(0)
    expect(rejections.c).toBeGreaterThan(0)
    db.close()
  })
})
