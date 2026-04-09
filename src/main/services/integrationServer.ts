import http from 'http'
import type Store from 'electron-store'
import { z } from 'zod'
import type { ChatMessage, RuntimeAdapter } from './runtime/types'
import { logLine } from '../logger'

const DEFAULT_PORT = 17373

let server: http.Server | null = null

function readChatMaxTokens(store: Store<Record<string, unknown>>): number {
  const rawMax = store.get('chatMaxTokens')
  if (typeof rawMax === 'number' && Number.isFinite(rawMax)) {
    return Math.min(262_144, Math.max(1, Math.floor(rawMax)))
  }
  return 512
}

function expectedToken(store: Store<Record<string, unknown>>): string | null {
  const t = store.get('integrationToken')
  if (typeof t !== 'string') return null
  const s = t.trim()
  return s.length > 0 ? s : null
}

function authOkForProtectedRoutes(store: Store<Record<string, unknown>>, req: http.IncomingMessage): boolean {
  const need = expectedToken(store)
  if (!need) return true
  const h = req.headers.authorization
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return false
  return h.slice(7).trim() === need
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function sendJson(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(buf.length)
  })
  res.end(buf)
}

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string()
      })
    )
    .min(1)
})

export function stopIntegrationServer(): void {
  if (server) {
    server.close()
    server = null
    logLine('info', 'integration_server_stopped', {})
  }
}

/**
 * (Re)starts the localhost HTTP bridge for IDE plugins when enabled in settings.
 * Binds 127.0.0.1 only.
 */
export function configureIntegrationServer(ctx: {
  store: Store<Record<string, unknown>>
  getRuntime: () => RuntimeAdapter | null
}): void {
  stopIntegrationServer()
  const { store, getRuntime } = ctx

  const enabled = store.get('integrationListenEnabled') === true
  if (!enabled) {
    logLine('info', 'integration_server_disabled', {})
    return
  }

  let port = DEFAULT_PORT
  const p = store.get('integrationPort')
  if (typeof p === 'number' && Number.isFinite(p)) {
    port = Math.min(65535, Math.max(1024, Math.floor(p)))
  }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      const url = req.url ?? '/'
      const method = req.method ?? 'GET'

      if (method === 'GET' && (url === '/health' || url === '/')) {
        const rt = getRuntime()
        const st = rt?.getStatus()
        sendJson(res, 200, {
          ok: true,
          name: 'local-llm-desktop',
          runtimeRunning: Boolean(st?.running),
          runtimeKind: st?.kind ?? 'none'
        })
        return
      }

      if (method === 'GET' && url === '/v1/runtime/status') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const rt = getRuntime()
        const st = rt?.getStatus()
        sendJson(res, 200, {
          running: Boolean(st?.running),
          kind: st?.kind ?? 'none',
          modelPath: st?.modelPath,
          endpoint: st?.endpoint
        })
        return
      }

      if (method === 'POST' && url === '/v1/chat') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const rt = getRuntime()
        if (!rt) {
          sendJson(res, 503, { error: 'Runtime not started. Load a model from the desktop app first.' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = chatBodySchema.safeParse(body)
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: expected { messages: [{ role, content }] }' })
          return
        }
        const messages = parsed.data.messages as ChatMessage[]
        const maxTokens = readChatMaxTokens(store)
        try {
          const reply = await rt.chat(messages, { maxTokens })
          sendJson(res, 200, { reply, model: rt.getStatus().modelPath })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          logLine('warn', 'integration_chat_error', { message: msg })
          sendJson(res, 502, { error: msg })
        }
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logLine('error', 'integration_server_handler', { message: msg })
      sendJson(res, 500, { error: msg })
    }
  }

  const s = http.createServer((req, res) => {
    void handler(req, res)
  })

  s.on('error', (err) => {
    logLine('error', 'integration_server_listen', { message: err.message })
  })

  s.listen(port, '127.0.0.1', () => {
    server = s
    logLine('info', 'integration_server_listen', { host: '127.0.0.1', port })
  })
}
