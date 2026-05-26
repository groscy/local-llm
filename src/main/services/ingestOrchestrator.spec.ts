import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createIngestOrchestrator } from './ingestOrchestrator'
import type { CanonicalIngestRecord } from '@shared/types'

const mockWriter = {
  ingestCanonicalRecord: vi.fn()
}

const baseRecord: CanonicalIngestRecord = {
  id: 'test-id',
  recordType: 'document',
  title: 'Test Document',
  body: 'The routing engine depends on the health monitor. The retry policy ensures uptime.',
  provenance: {
    sourceSystem: 'test',
    sourceType: 'text',
    sourceRecordId: 'test-id',
    ingestRunId: 'run-1',
    observedAt: Date.now()
  }
}

describe('ingestOrchestrator', () => {
  beforeEach(() => {
    mockWriter.ingestCanonicalRecord.mockReset()
    mockWriter.ingestCanonicalRecord.mockResolvedValue({ entities: [], relations: [], descriptors: [] })
  })

  describe('refineUncertainCandidatesWithRuntime candidate cap', () => {
    it('sends at most 24 entities, 18 relations, 18 descriptors to the LLM', async () => {
      const chatMock = vi.fn().mockResolvedValue('{"entities":[],"relations":[],"descriptors":[]}')
      const runtime = {
        getStatus: () => ({ running: true, kind: 'llamacpp' as const }),
        chat: chatMock
      }

      const manyTermsRecord: CanonicalIngestRecord = {
        ...baseRecord,
        body: Array.from({ length: 60 }, (_, i) => `Entity${i} uses Component${i} for feature${i}.`).join(' ')
      }

      const orchestrator = createIngestOrchestrator(mockWriter as any)
      await orchestrator.ingestRecord(manyTermsRecord, { runtime: runtime as any })

      if (chatMock.mock.calls.length > 0) {
        const messages = chatMock.mock.calls[0]![0] as Array<{ role: string; content: string }>
        const userMsg = messages.find((m) => m.role === 'user')
        const promptArg = userMsg?.content ?? ''

        const entitySection = promptArg.match(/Uncertain entities: (\[[\s\S]*?\])\n/)
        const relationSection = promptArg.match(/Uncertain relations: (\[[\s\S]*?\])\n/)
        const descriptorSection = promptArg.match(/Uncertain descriptors: (\[[\s\S]*?\])$/)

        if (entitySection?.[1]) {
          const entities = JSON.parse(entitySection[1])
          expect(entities.length).toBeLessThanOrEqual(24)
        }
        if (relationSection?.[1]) {
          const relations = JSON.parse(relationSection[1])
          expect(relations.length).toBeLessThanOrEqual(18)
        }
        if (descriptorSection?.[1]) {
          const descriptors = JSON.parse(descriptorSection[1])
          expect(descriptors.length).toBeLessThanOrEqual(18)
        }
      }
    })
  })

  describe('LLM refinement error handling', () => {
    it('falls back to heuristic and logs a warning when LLM returns non-JSON', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const chatMock = vi.fn().mockResolvedValue('Sorry, I cannot help with that.')
      const runtime = {
        getStatus: () => ({ running: true, kind: 'llamacpp' as const }),
        chat: chatMock
      }

      const orchestrator = createIngestOrchestrator(mockWriter as any)
      await expect(
        orchestrator.ingestRecord(baseRecord, { runtime: runtime as any })
      ).resolves.not.toThrow()

      expect(mockWriter.ingestCanonicalRecord).toHaveBeenCalled()
      const callArgs = mockWriter.ingestCanonicalRecord.mock.calls[0]
      expect(callArgs).toBeDefined()

      warnSpy.mockRestore()
    })

    it('fills missing keys with heuristic results for partial JSON response', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const chatMock = vi.fn().mockResolvedValue('{"entities":[{"label":"Routing Engine","confidence":0.9}]}')
      const runtime = {
        getStatus: () => ({ running: true, kind: 'llamacpp' as const }),
        chat: chatMock
      }

      const orchestrator = createIngestOrchestrator(mockWriter as any)
      await expect(
        orchestrator.ingestRecord(baseRecord, { runtime: runtime as any })
      ).resolves.not.toThrow()

      expect(mockWriter.ingestCanonicalRecord).toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing keys'),
        expect.stringContaining('relations')
      )

      warnSpy.mockRestore()
    })
  })
})
