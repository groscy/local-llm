import { describe, expect, it } from 'vitest'
import type Store from 'electron-store'
import { IntegrationJobQueue } from './integrationJobQueue'

function makeStore(): Store<Record<string, unknown>> {
  const m = new Map<string, unknown>()
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => {
      m.set(k, v)
    }
  } as unknown as Store<Record<string, unknown>>
}

describe('IntegrationJobQueue', () => {
  it('runs queued jobs and stores completed result', async () => {
    const store = makeStore()
    const q = new IntegrationJobQueue<{ text: string }, { out: string }>(store, {
      processor: async (job, setProgress) => {
        setProgress('running processor')
        return { out: job.payload.text.toUpperCase() }
      }
    })
    const submitted = q.submit({ text: 'hello' })
    expect(['queued', 'running']).toContain(submitted.state)
    await new Promise((r) => setTimeout(r, 25))
    const done = q.get(submitted.id)
    expect(done?.state).toBe('completed')
    expect(done?.result?.out).toBe('HELLO')
  })

  it('marks queued jobs cancelled and keeps metadata', async () => {
    const store = makeStore()
    const q = new IntegrationJobQueue<{ n: number }, { out: number }>(store, {
      processor: async (job) => ({ out: job.payload.n * 2 })
    })
    const submitted = q.submit({ n: 5 })
    const ok = q.cancel(submitted.id)
    expect(ok).toBe(true)
    const state = q.get(submitted.id)
    expect(state?.state).toBe('cancelled')
  })
})
