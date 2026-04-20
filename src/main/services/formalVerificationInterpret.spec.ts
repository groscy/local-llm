import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  FORMAL_LLM_ADVISORY_DISCLAIMER,
  type CodebaseRecord,
  type FormalToolProfile,
  type FormalVerificationRun
} from '@shared/codebaseRegistry'
import type { RuntimeAdapter } from './runtime/types'
import {
  attachFormalRunLlmAdvisory,
  buildFormalInterpretPromptParts,
  shouldAutoInterpretFormalRun,
  shouldIncludeKbContext,
  truncateForInterpret
} from './formalVerificationInterpret'

const baseRun = (): FormalVerificationRun => ({
  id: '00000000-0000-4000-8000-000000000001',
  codebaseId: '00000000-0000-4000-8000-000000000002',
  profileId: '00000000-0000-4000-8000-000000000003',
  startedAt: 1,
  finishedAt: 2,
  status: 'succeeded',
  exitCode: 0,
  stdout: 'all good',
  stderr: '',
  commandResolved: 'dafny verify {{root}}'.replace('{{root}}', '/tmp/proj')
})

const baseProfile = (): FormalToolProfile => ({
  id: '00000000-0000-4000-8000-000000000003',
  label: 'Dafny smoke',
  commandTemplate: 'dafny verify {{root}}',
  spawnMode: 'shell',
  timeoutMs: 60_000,
  expectedExitCodes: [0]
})

const baseCodebase = (): CodebaseRecord => ({
  id: '00000000-0000-4000-8000-000000000002',
  rootPath: '/tmp/proj',
  displayName: 'Proj',
  origin: 'manual',
  createdAt: 0,
  lastSeenAt: 0,
  disabled: false
})

function mkStore(partial: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(partial))
  return {
    get: (k: string) => map.get(k)
  } as import('electron-store').default<Record<string, unknown>>
}

describe('truncateForInterpret', () => {
  it('returns input unchanged when under max', () => {
    expect(truncateForInterpret('abc', 10)).toBe('abc')
  })

  it('truncates long strings with marker', () => {
    const s = 'x'.repeat(100)
    const out = truncateForInterpret(s, 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out).toContain('…[truncated]')
  })
})

describe('buildFormalInterpretPromptParts', () => {
  it('returns stable promptHash for identical bounded inputs', () => {
    const a = buildFormalInterpretPromptParts({
      run: baseRun(),
      profileLabel: 'P',
      codebase: baseCodebase(),
      kbBlock: '',
      scanBlock: ''
    })
    const b = buildFormalInterpretPromptParts({
      run: baseRun(),
      profileLabel: 'P',
      codebase: baseCodebase(),
      kbBlock: '',
      scanBlock: ''
    })
    expect(a.promptHash).toBe(b.promptHash)
    expect(a.promptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes hash when stdout excerpt changes', () => {
    const r1 = baseRun()
    const r2 = { ...baseRun(), stdout: 'different' }
    const h1 = buildFormalInterpretPromptParts({
      run: r1,
      profileLabel: 'P',
      codebase: baseCodebase(),
      kbBlock: '',
      scanBlock: ''
    }).promptHash
    const h2 = buildFormalInterpretPromptParts({
      run: r2,
      profileLabel: 'P',
      codebase: baseCodebase(),
      kbBlock: '',
      scanBlock: ''
    }).promptHash
    expect(h1).not.toBe(h2)
  })

  it('embeds KB and scan blocks when provided', () => {
    const { user } = buildFormalInterpretPromptParts({
      run: baseRun(),
      profileLabel: 'P',
      codebase: baseCodebase(),
      kbBlock: '## Knowledge base\n- hit',
      scanBlock: '{"root":"/x"}'
    })
    expect(user).toContain('Knowledge base')
    expect(user).toContain('Repository scan summary')
  })
})

describe('shouldAutoInterpretFormalRun / shouldIncludeKbContext', () => {
  it('respects profile override on and off', () => {
    const store = mkStore({ formalVerificationInterpretWithLlm: true })
    expect(shouldAutoInterpretFormalRun(store, { ...baseProfile(), interpretWithLlm: false })).toBe(false)
    expect(shouldAutoInterpretFormalRun(store, { ...baseProfile(), interpretWithLlm: true })).toBe(true)
  })

  it('falls back to global flag when profile inherit', () => {
    const off = mkStore({ formalVerificationInterpretWithLlm: false })
    const on = mkStore({ formalVerificationInterpretWithLlm: true })
    const p = { ...baseProfile() }
    expect(shouldAutoInterpretFormalRun(off, p)).toBe(false)
    expect(shouldAutoInterpretFormalRun(on, p)).toBe(true)
  })

  it('reads include-KB store flag', () => {
    expect(shouldIncludeKbContext(mkStore({ formalVerificationInterpretIncludeKb: true }))).toBe(true)
    expect(shouldIncludeKbContext(mkStore({}))).toBe(false)
  })
})

const stubDb = {} as Database.Database

describe('attachFormalRunLlmAdvisory', () => {
  it('sets llmAdvisoryError when runtime is not running', async () => {
    const db = stubDb
    const out = await attachFormalRunLlmAdvisory({
      store: mkStore(),
      db,
      getRuntime: () =>
        ({
          kind: 'ollama',
          getStatus: () => ({ running: false, kind: 'ollama' as const }),
          chat: vi.fn()
        }) as unknown as RuntimeAdapter,
      run: baseRun(),
      profile: baseProfile(),
      codebase: baseCodebase(),
      includeContext: false
    })
    expect(out.llmAdvisoryError).toContain('not running')
    expect(out.llmAdvisory).toBeUndefined()
  })

  it('sets llmAdvisoryError when getRuntime is null', async () => {
    const out = await attachFormalRunLlmAdvisory({
      store: mkStore(),
      db: stubDb,
      getRuntime: () => null,
      run: baseRun(),
      profile: baseProfile(),
      codebase: baseCodebase(),
      includeContext: false
    })
    expect(out.llmAdvisoryError).toContain('not running')
  })

  it('persists advisory text and disclaimer on successful chat', async () => {
    const db = stubDb
    const chat = vi.fn(async () => '  Summary line  \n')
    const out = await attachFormalRunLlmAdvisory({
      store: mkStore(),
      db,
      getRuntime: () =>
        ({
          kind: 'ollama',
          getStatus: () => ({ running: true, kind: 'ollama' as const }),
          chat
        }) as unknown as RuntimeAdapter,
      run: baseRun(),
      profile: baseProfile(),
      codebase: baseCodebase(),
      includeContext: false
    })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(out.llmAdvisory?.text).toBe('Summary line')
    expect(out.llmAdvisory?.disclaimer).toBe(FORMAL_LLM_ADVISORY_DISCLAIMER)
    expect(out.llmAdvisory?.promptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(out.llmAdvisoryError).toBeUndefined()
  })

  it('captures chat errors into llmAdvisoryError', async () => {
    const db = stubDb
    const out = await attachFormalRunLlmAdvisory({
      store: mkStore(),
      db,
      getRuntime: () =>
        ({
          kind: 'ollama',
          getStatus: () => ({ running: true, kind: 'ollama' as const }),
          chat: vi.fn(async () => {
            throw new Error('model blew up')
          })
        }) as unknown as RuntimeAdapter,
      run: baseRun(),
      profile: baseProfile(),
      codebase: baseCodebase(),
      includeContext: false
    })
    expect(out.llmAdvisoryError).toContain('model blew up')
  })
})
