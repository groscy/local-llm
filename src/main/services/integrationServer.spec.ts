import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Store from 'electron-store'
import { configureIntegrationServer, stopIntegrationServer } from './integrationServer'
import type { RuntimeAdapter } from './runtime/types'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

function makeStore(port: number, token = ''): Store<Record<string, unknown>> {
  const map = new Map<string, unknown>([
    ['integrationListenEnabled', true],
    ['integrationPort', port],
    ['integrationToken', token]
  ])
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => map.set(k, v)
  } as unknown as Store<Record<string, unknown>>
}

async function reqJson(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d) => chunks.push(d as Buffer))
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
            })
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function waitForHealth(port: number): Promise<void> {
  for (let i = 0; i < 15; i++) {
    try {
      const r = await reqJson(port, '/health')
      if (r.status === 200) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('integration server did not start')
}

afterEach(() => {
  stopIntegrationServer()
})

describe('integrationServer auth + status contract', () => {
  it('enforces bearer token on protected route', async () => {
    const port = 19440
    const store = makeStore(port, 'secret')
    const runtime: RuntimeAdapter = {
      kind: 'ollama',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'ollama', modelPath: 'qwen2.5:7b' }
      },
      async chat() {
        return 'ok'
      }
    }
    configureIntegrationServer({ store, getRuntime: () => runtime })
    await waitForHealth(port)

    const unauthorized = await reqJson(port, '/v1/runtime/status')
    expect(unauthorized.status).toBe(401)

    const authorized = await reqJson(port, '/v1/runtime/status', {
      Authorization: 'Bearer secret'
    })
    expect(authorized.status).toBe(200)
    expect(authorized.body.running).toBe(true)
    expect(authorized.body.kind).toBe('ollama')
  })
})
