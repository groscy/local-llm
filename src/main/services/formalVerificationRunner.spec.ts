import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { expandCommandTemplate, runFormalVerificationJob } from './formalVerificationRunner'

describe('expandCommandTemplate', () => {
  it('substitutes root placeholder', () => {
    const cmd = expandCommandTemplate('ls {{root}}', '/tmp/proj')
    expect(cmd).not.toContain('{{root}}')
    expect(cmd.toLowerCase()).toMatch(/tmp.*proj/)
  })
})

describe('runFormalVerificationJob', () => {
  it('returns succeeded on zero exit', async () => {
    const mkStream = () => {
      const e = new EventEmitter()
      ;(e as EventEmitter & { setEncoding: (enc: string) => void }).setEncoding = () => {}
      return e
    }
    const fakeChild = new EventEmitter() as NodeJS.EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: (s: string) => boolean
    }
    fakeChild.stdout = mkStream()
    fakeChild.stderr = mkStream()
    fakeChild.kill = () => true

    const spawnFn = vi.fn((_cmd: string, _args: readonly string[], _opts: object) => {
      queueMicrotask(() => {
        fakeChild.stdout.emit('data', 'ok\n')
        fakeChild.emit('close', 0)
      })
      return fakeChild
    })

    const r = await runFormalVerificationJob({
      commandResolved: 'echo ok',
      cwd: '/tmp',
      spawnMode: 'shell',
      timeoutMs: 5000,
      expectedExitCodes: [0],
      deps: { spawnFn: spawnFn as unknown as typeof import('child_process').spawn, platform: 'linux' }
    })
    expect(r.status).toBe('succeeded')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('ok')
  })

  it('treats non-zero exit as failed', async () => {
    const mkStream = () => {
      const e = new EventEmitter()
      ;(e as EventEmitter & { setEncoding: (enc: string) => void }).setEncoding = () => {}
      return e
    }
    const fakeChild = new EventEmitter() as NodeJS.EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    fakeChild.stdout = mkStream()
    fakeChild.stderr = mkStream()

    const spawnFn = vi.fn(() => {
      queueMicrotask(() => {
        fakeChild.stderr.emit('data', 'err')
        fakeChild.emit('close', 2)
      })
      return fakeChild
    })

    const r = await runFormalVerificationJob({
      commandResolved: 'false',
      cwd: '/tmp',
      spawnMode: 'shell',
      timeoutMs: 5000,
      expectedExitCodes: [0],
      deps: { spawnFn: spawnFn as unknown as typeof import('child_process').spawn, platform: 'linux' }
    })
    expect(r.status).toBe('failed')
    expect(r.exitCode).toBe(2)
  })
})
