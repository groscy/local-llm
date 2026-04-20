import { describe, expect, it } from 'vitest'
import {
  codebaseRootsEqual,
  emptyCodebaseFormalBundle,
  trimFormalRuns,
  upsertCodebaseByPath,
  type CodebaseFormalBundle,
  type FormalVerificationRun
} from './codebaseRegistry'

describe('codebaseRootsEqual', () => {
  it('treats slash variants as equal on case-insensitive comparison', () => {
    expect(codebaseRootsEqual('C:/Proj/A', 'c:\\proj\\a')).toBe(true)
  })

  it('distinguishes different paths', () => {
    expect(codebaseRootsEqual('/a/b', '/a/c')).toBe(false)
  })
})

describe('upsertCodebaseByPath', () => {
  it('inserts with newRecordId', () => {
    const b = emptyCodebaseFormalBundle()
    const now = 1000
    const next = upsertCodebaseByPath(b, '/repo/x', {
      origin: 'intellij_detected',
      linkedIdeProjectName: 'X',
      now,
      newRecordId: 'id-1'
    })
    expect(next.codebases).toHaveLength(1)
    expect(next.codebases[0].id).toBe('id-1')
    expect(next.codebases[0].rootPath).toBe('/repo/x')
    expect(next.codebases[0].origin).toBe('intellij_detected')
  })

  it('updates lastSeen and preserves manual origin when plugin reports again', () => {
    let b: CodebaseFormalBundle = emptyCodebaseFormalBundle()
    b = upsertCodebaseByPath(b, '/repo/y', {
      origin: 'manual',
      now: 1,
      newRecordId: 'id-2'
    })
    b = upsertCodebaseByPath(b, '/repo/y', {
      origin: 'intellij_detected',
      linkedIdeProjectName: 'IDE',
      now: 2
    })
    expect(b.codebases).toHaveLength(1)
    expect(b.codebases[0].origin).toBe('manual')
    expect(b.codebases[0].lastSeenAt).toBe(2)
    expect(b.codebases[0].linkedIdeProjectName).toBe('IDE')
  })

  it('skips insert without newRecordId', () => {
    const b = emptyCodebaseFormalBundle()
    const next = upsertCodebaseByPath(b, '/new', {
      origin: 'manual',
      now: 1
    })
    expect(next.codebases).toHaveLength(0)
  })
})

describe('trimFormalRuns', () => {
  it('drops oldest runs over max', () => {
    const runs: FormalVerificationRun[] = [1, 2, 3, 4].map((n) => ({
      id: `r${n}`,
      codebaseId: 'c',
      profileId: 'p',
      startedAt: n * 1000,
      status: 'succeeded',
      exitCode: 0,
      stdout: '',
      stderr: '',
      commandResolved: 'x'
    }))
    const bundle: CodebaseFormalBundle = {
      ...emptyCodebaseFormalBundle(),
      formalVerificationRuns: runs
    }
    const trimmed = trimFormalRuns(bundle, 2)
    expect(trimmed.formalVerificationRuns.map((r) => r.id)).toEqual(['r3', 'r4'])
  })
})
