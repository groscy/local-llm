import { describe, expect, it } from 'vitest'
import type Store from 'electron-store'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrations'
import { ingestText } from './kbService'
import { runIntegrationChatPipeline } from './integrationChatPipeline'
import type { RuntimeAdapter } from './runtime/types'

function makeStore(): Store<Record<string, unknown>> {
  const map = new Map<string, unknown>()
  map.set('ontologyEnabled', false)
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => {
      map.set(k, v)
    }
  } as unknown as Store<Record<string, unknown>>
}

describe('runIntegrationChatPipeline', () => {
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

  it('calls runtime and reports streamed tokens', async () => {
    const store = makeStore()
    const streamed: string[] = []
    const runtime: RuntimeAdapter = {
      kind: 'llamacpp',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'llamacpp', modelPath: 'model.gguf' }
      },
      async chat(_messages, opts) {
        opts?.onStreamChunk?.('A')
        opts?.onStreamChunk?.('B')
        opts?.onStreamUsage?.({ promptTokens: 4, completionTokens: 2 })
        return 'AB'
      }
    }
    const result = await runIntegrationChatPipeline({
      store,
      runtime,
      ontology: null,
      messages: [{ role: 'user', content: 'ping' }],
      progress: {
        onToken: (t) => streamed.push(t)
      }
    })
    expect(result.reply).toBe('AB')
    expect(result.usage.promptTokens).toBe(4)
    expect(result.usage.completionTokens).toBe(2)
    expect(streamed.join('')).toBe('AB')
  })

  maybeIt('injects retrieval context when db is available', async () => {
    const db = new Database(':memory:')
    migrate(db)
    ingestText(db, 'Retry Policy', 'file://retry.md', 'Retry with exponential backoff and jitter for resilience.')
    const store = makeStore()
    const runtime: RuntimeAdapter = {
      kind: 'llamacpp',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'llamacpp', modelPath: 'model.gguf' }
      },
      async chat(messages) {
        const system = messages.find((m) => m.role === 'system')?.content ?? ''
        expect(system).toContain('Retrieved knowledge context')
        return 'ok'
      }
    }
    const result = await runIntegrationChatPipeline({
      store,
      db,
      runtime,
      ontology: null,
      messages: [{ role: 'user', content: 'How should retry logic work?' }]
    })
    expect(result.reply).toBe('ok')
    db.close()
  })
})
