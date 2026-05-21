import http from 'http'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import type Store from 'electron-store'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { ChatMessage, RuntimeAdapter } from './runtime/types'
import { appendPluginReport } from './pluginIntegrationHub'
import { upsertCodebaseFromPluginReport } from './codebaseFormalStore'
import { appendLearningEvent } from './trainingWorkflowStore'
import type { OntologyService } from './ontologyService'
import { logLine } from '../logger'
import type { ClaudeMemoryEventEnvelope, IntegrationModelActivityEvent } from '@shared/types'
import { runIntegrationChatPipeline } from './integrationChatPipeline'
import { IntegrationJobQueue } from './integrationJobQueue'
import {
  appendClaudeDeadLetter,
  appendClaudeMemoryEvents,
  endClaudeMemorySession,
  exportClaudeMemorySessionsToTrainingJsonl,
  getClaudeMemoryCaptureStats,
  listClaudeMemoryEvents,
  listClaudeMemorySessions,
  pruneClaudeMemoryByAge,
  startClaudeMemorySession
} from './claudeMemoryStore'

const DEFAULT_PORT = 17373

let server: http.Server | null = null
let jobQueue: IntegrationJobQueue<IntegrationJobPayload, IntegrationJobResult> | null = null

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

function emitIntegrationModelActivity(payload: Omit<IntegrationModelActivityEvent, 'receivedAt'>): void {
  const full: IntegrationModelActivityEvent = { ...payload, receivedAt: Date.now() }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.INTEGRATION_MODEL_ACTIVITY, full)
    }
  }
}

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string()
      })
    )
    .min(1),
  /** Optional cap for this request (e.g. IDE inline completion). Falls back to app chat max when omitted. */
  maxTokens: z.number().int().min(1).max(262_144).optional()
})

const jobSubmitSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string()
      })
    )
    .min(1),
  maxTokens: z.number().int().min(1).max(262_144).optional(),
  context: z
    .object({
      projectName: z.string().max(300).optional(),
      projectBasePath: z.string().max(4000).optional(),
      source: z.string().max(120).optional()
    })
    .optional()
})

type IntegrationJobPayload = z.infer<typeof jobSubmitSchema>

const claudeEventSchema = z.object({
  eventId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128).optional(),
  sequence: z.number().int().min(0).max(1_000_000_000),
  eventType: z.enum([
    'session_started',
    'session_ended',
    'user_message',
    'assistant_message',
    'tool_call',
    'tool_result',
    'file_edit',
    'shell_command',
    'diagnostic',
    'metadata'
  ]),
  timestamp: z.number().int().min(0),
  projectPath: z.string().max(4096).optional(),
  model: z.string().max(200).optional(),
  toolName: z.string().max(200).optional(),
  tokenUsage: z
    .object({
      promptTokens: z.number().int().min(0).max(20_000_000).optional(),
      completionTokens: z.number().int().min(0).max(20_000_000).optional()
    })
    .optional(),
  sourceClientVersion: z.string().max(120).optional(),
  payload: z.record(z.unknown()).default({})
})

const claudeSessionStartSchema = z.object({
  sessionId: z.string().min(1).max(128),
  source: z.string().max(120).default('claude-code'),
  projectPath: z.string().max(4096).optional(),
  startedAt: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional()
})

const claudeSessionEndSchema = z.object({
  sessionId: z.string().min(1).max(128),
  endedAt: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional()
})

const claudeEventsBodySchema = z.object({
  source: z.string().max(120).default('claude-code'),
  sessionId: z.string().min(1).max(128),
  events: z.array(claudeEventSchema).min(1).max(500)
})

type IntegrationEditOperation = 'add' | 'update' | 'delete'

type IntegrationJobResult = {
  reply: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  editOperations: Array<{ op: IntegrationEditOperation; path: string }>
}

function extractEditOperations(reply: string): Array<{ op: IntegrationEditOperation; path: string }> {
  const out: Array<{ op: IntegrationEditOperation; path: string }> = []
  const addUnique = (op: IntegrationEditOperation, path: string): void => {
    const p = path.trim()
    if (!p) return
    if (out.some((x) => x.op === op && x.path === p)) return
    out.push({ op, path: p })
  }
  for (const m of reply.matchAll(/<<<LOCAL_LLM_FILE\s+path=["']([^"']+)["']\s*>>>/g)) {
    addUnique('add', m[1] ?? '')
  }
  for (const m of reply.matchAll(/<<<LOCAL_LLM_PATCH\s+path=["']([^"']+)["']\s*>>>/g)) {
    addUnique('update', m[1] ?? '')
  }
  for (const m of reply.matchAll(/<<<LOCAL_LLM_DELETE\s+path=["']([^"']+)["']\s*>>>/g)) {
    addUnique('delete', m[1] ?? '')
  }
  for (const m of reply.matchAll(/(?:\/\/\s*File:|#\s*file:)\s*([^\r\n]+)/gi)) {
    addUnique('update', m[1] ?? '')
  }
  return out.slice(0, 300)
}

const pluginReportMetaValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

const pluginReportBodySchema = z.object({
  source: z.string().max(64).default('intellij'),
  kind: z.enum([
    'chat_job_queued',
    'chat_completed',
    'chat_failed',
    'apply_completed',
    'apply_failed',
    'apply_cancelled',
    'send_cancelled',
    'agent_step',
    'agent_stop',
    'workspace_seen'
  ]),
  message: z.string().max(4000).optional(),
  meta: z.record(z.string(), pluginReportMetaValue).optional()
})

function parseJobRoute(url: string): { id: string; action: 'status' | 'result' | 'cancel' } | null {
  const status = url.match(/^\/v1\/jobs\/([0-9a-fA-F-]+)$/)
  if (status?.[1]) return { id: status[1], action: 'status' }
  const result = url.match(/^\/v1\/jobs\/([0-9a-fA-F-]+)\/result$/)
  if (result?.[1]) return { id: result[1], action: 'result' }
  const cancel = url.match(/^\/v1\/jobs\/([0-9a-fA-F-]+)\/cancel$/)
  if (cancel?.[1]) return { id: cancel[1], action: 'cancel' }
  return null
}

function parseClaudeSessionEventsRoute(url: string): string | null {
  const m = url.match(/^\/v1\/claude\/sessions\/([^/]+)\/events$/)
  if (!m?.[1]) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(max, Math.floor(n)))
}

export function stopIntegrationServer(): void {
  if (jobQueue) {
    jobQueue.shutdown()
    jobQueue = null
  }
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
  getDb?: () => import('better-sqlite3').Database | null
  getOntology?: () => OntologyService | null
}): void {
  stopIntegrationServer()
  const { store, getRuntime, getDb, getOntology } = ctx

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

  jobQueue = new IntegrationJobQueue<IntegrationJobPayload, IntegrationJobResult>(store, {
    storeKey: 'integrationJobQueueState',
    concurrency: 1,
    maxRetained: 120,
    initialProgressText: 'Queued',
    processor: async (job, setProgress) => {
      const rt = getRuntime()
      if (!rt) {
        throw new Error('Runtime not started. Load a model from the desktop app first.')
      }
      const requestId = job.id
      const lastUser = [...job.payload.messages]
        .reverse()
        .find((m) => m.role === 'user' && m.content.trim().length > 0)
      const promptPreview = lastUser?.content?.replace(/\s+/g, ' ').trim().slice(0, 220)
      emitIntegrationModelActivity({
        requestId,
        source: job.payload.context?.source ?? 'intellij-plugin',
        kind: 'started',
        promptPreview
      })
      setProgress('Preprocessing request')
      const result = await runIntegrationChatPipeline({
        store,
        db: getDb?.() ?? null,
        runtime: rt,
        ontology: getOntology?.() ?? null,
        messages: job.payload.messages as ChatMessage[],
        maxTokensOverride: job.payload.maxTokens,
        ontologySourcePrefix: `http-chat:${requestId}`,
        progress: {
          onToken: (text) => {
            emitIntegrationModelActivity({
              requestId,
              source: job.payload.context?.source ?? 'intellij-plugin',
              kind: 'token',
              tokenText: text
            })
          }
        }
      })
      setProgress('Postprocessing response')
      const editOperations = extractEditOperations(result.reply)
      emitIntegrationModelActivity({
        requestId,
        source: job.payload.context?.source ?? 'intellij-plugin',
        kind: 'completed',
        responseText: result.responsePreview
      })
      const modelPath = rt.getStatus().modelPath
      return {
        reply: result.reply,
        model: modelPath,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        editOperations
      }
    }
  })

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

      if (method === 'GET' && url === '/v1/claude/health') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const rt = getRuntime()
        const st = rt?.getStatus()
        const db = getDb?.() ?? null
        const stats = db ? getClaudeMemoryCaptureStats(db) : null
        sendJson(res, 200, {
          ok: true,
          integration: 'claude-direct',
          runtimeRunning: Boolean(st?.running),
          runtimeKind: st?.kind ?? 'none',
          captureEnabled: store.get('claudeMemoryCaptureEnabled') !== false,
          sessions: stats?.sessions ?? 0,
          events: stats?.events ?? 0,
          lastIngestAt: stats?.lastIngestAt ?? null
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
        const requestId = randomUUID()
        const lastUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim().length > 0)
        const promptPreview = lastUser?.content?.replace(/\s+/g, ' ').trim().slice(0, 220)
        emitIntegrationModelActivity({
          requestId,
          source: 'intellij-plugin',
          kind: 'started',
          promptPreview
        })
        try {
          const result = await runIntegrationChatPipeline({
            store,
            db: getDb?.() ?? null,
            runtime: rt,
            ontology: getOntology?.() ?? null,
            messages,
            maxTokensOverride: parsed.data.maxTokens,
            ontologySourcePrefix: `http-chat:${requestId}`,
            progress: {
              onToken: (text) => {
                emitIntegrationModelActivity({
                  requestId,
                  source: 'intellij-plugin',
                  kind: 'token',
                  tokenText: text
                })
              }
            }
          })
          const body: Record<string, unknown> = { reply: result.reply, model: rt.getStatus().modelPath }
          if (typeof result.usage.promptTokens === 'number') body.promptTokens = result.usage.promptTokens
          if (typeof result.usage.completionTokens === 'number') body.completionTokens = result.usage.completionTokens
          emitIntegrationModelActivity({
            requestId,
            source: 'intellij-plugin',
            kind: 'completed',
            responseText: result.responsePreview
          })
          sendJson(res, 200, body)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          logLine('warn', 'integration_chat_error', { message: msg })
          emitIntegrationModelActivity({
            requestId,
            source: 'intellij-plugin',
            kind: 'error',
            error: msg.slice(0, 400)
          })
          sendJson(res, 502, { error: msg })
        }
        return
      }

      if (method === 'POST' && url === '/v1/jobs') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        if (!jobQueue) {
          sendJson(res, 503, { error: 'Integration job queue unavailable' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = jobSubmitSchema.safeParse(body)
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: expected { messages, maxTokens?, context? }' })
          return
        }
        const job = jobQueue.submit(parsed.data)
        sendJson(res, 202, {
          jobId: job.id,
          status: job.state,
          progress: job.progressText,
          createdAt: job.createdAt,
          schemaVersion: 1
        })
        return
      }

      const jobRoute = parseJobRoute(url)
      if (jobRoute) {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        if (!jobQueue) {
          sendJson(res, 503, { error: 'Integration job queue unavailable' })
          return
        }
        const rec = jobQueue.get(jobRoute.id)
        if (!rec) {
          sendJson(res, 404, { error: 'Job not found' })
          return
        }
        if (jobRoute.action === 'cancel') {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' })
            return
          }
          const ok = jobQueue.cancel(jobRoute.id)
          const next = jobQueue.get(jobRoute.id)
          sendJson(res, 200, { ok, status: next?.state ?? rec.state, progress: next?.progressText ?? rec.progressText })
          return
        }
        if (method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        if (jobRoute.action === 'status') {
          sendJson(res, 200, {
            jobId: rec.id,
            status: rec.state,
            progress: rec.progressText,
            createdAt: rec.createdAt,
            startedAt: rec.startedAt,
            updatedAt: rec.updatedAt,
            finishedAt: rec.finishedAt,
            error: rec.error,
            hasResult: rec.result != null,
            schemaVersion: 1
          })
          return
        }
        if (rec.state !== 'completed' || !rec.result) {
          sendJson(res, 409, {
            error: 'Job has no result yet',
            status: rec.state,
            progress: rec.progressText
          })
          return
        }
        sendJson(res, 200, {
          jobId: rec.id,
          status: rec.state,
          result: rec.result,
          completedAt: rec.finishedAt,
          schemaVersion: 1
        })
        return
      }

      if (method === 'POST' && url === '/v1/plugin/report') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = pluginReportBodySchema.safeParse(body)
        if (!parsed.success) {
          sendJson(res, 400, { error: 'Invalid body: expected { source?, kind, message?, meta? }' })
          return
        }
        const d = parsed.data
        const full = appendPluginReport({
          source: d.source,
          kind: d.kind,
          message: d.message,
          meta: d.meta
        })
        try {
          const db = getDb?.()
          if (db) {
            appendLearningEvent(db, {
              source: 'intellij-plugin',
              actor: d.source,
              interactionType: 'plugin_report',
              payloadRef: `plugin:${full.receivedAt}:${d.kind}`,
              summary: d.message?.slice(0, 280) || `${d.kind} from ${d.source}`,
              details: { kind: d.kind, meta: d.meta ?? {} }
            })
          }
        } catch (e) {
          logLine('warn', 'integration_learning_event_failed', {
            error: e instanceof Error ? e.message : String(e)
          })
        }
        upsertCodebaseFromPluginReport(store, full)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && url === '/v1/claude/session/start') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const db = getDb?.()
        if (!db) {
          sendJson(res, 503, { error: 'Database unavailable' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = claudeSessionStartSchema.safeParse(body)
        if (!parsed.success) {
          appendClaudeDeadLetter(db, { source: 'claude-code', reason: 'session_start_invalid_body', body })
          sendJson(res, 400, { error: 'Invalid body: expected { sessionId, source?, projectPath?, startedAt?, metadata? }' })
          return
        }
        const row = startClaudeMemorySession(db, parsed.data)
        sendJson(res, 200, { ok: true, session: row })
        return
      }

      if (method === 'POST' && url === '/v1/claude/session/end') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const db = getDb?.()
        if (!db) {
          sendJson(res, 503, { error: 'Database unavailable' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = claudeSessionEndSchema.safeParse(body)
        if (!parsed.success) {
          appendClaudeDeadLetter(db, { source: 'claude-code', reason: 'session_end_invalid_body', body })
          sendJson(res, 400, { error: 'Invalid body: expected { sessionId, endedAt?, metadata? }' })
          return
        }
        const ok = endClaudeMemorySession(db, parsed.data)
        sendJson(res, 200, { ok })
        return
      }

      if (method === 'POST' && url === '/v1/claude/events') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const db = getDb?.()
        if (!db) {
          sendJson(res, 503, { error: 'Database unavailable' })
          return
        }
        if (store.get('claudeMemoryCaptureEnabled') === false) {
          sendJson(res, 200, { accepted: 0, duplicates: 0, derivedUnits: 0, disabled: true })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          appendClaudeDeadLetter(db, { source: 'claude-code', reason: 'events_invalid_json' })
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = claudeEventsBodySchema.safeParse(body)
        if (!parsed.success) {
          appendClaudeDeadLetter(db, { source: 'claude-code', reason: 'events_invalid_body', body })
          sendJson(res, 400, { error: 'Invalid body: expected { sessionId, source?, events[] }' })
          return
        }
        const maxPayloadBytesRaw = store.get('claudeMemoryMaxEventBytes')
        const maxPayloadBytes =
          typeof maxPayloadBytesRaw === 'number' && Number.isFinite(maxPayloadBytesRaw)
            ? Math.max(2048, Math.min(8_000_000, Math.floor(maxPayloadBytesRaw)))
            : undefined
        const retentionDaysRaw = store.get('claudeMemoryRetentionDays')
        const retentionDays =
          typeof retentionDaysRaw === 'number' && Number.isFinite(retentionDaysRaw) ? retentionDaysRaw : 0
        if (retentionDays > 0) {
          try {
            pruneClaudeMemoryByAge(db, retentionDays)
          } catch {
            /* best effort pruning */
          }
        }
        const outcome = appendClaudeMemoryEvents(db, {
          source: parsed.data.source,
          sessionId: parsed.data.sessionId,
          events: parsed.data.events as ClaudeMemoryEventEnvelope[],
          maxPayloadBytes
        })
        sendJson(res, 202, { ok: true, ...outcome })
        return
      }

      if (method === 'GET' && url.startsWith('/v1/claude/sessions')) {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const db = getDb?.()
        if (!db) {
          sendJson(res, 503, { error: 'Database unavailable' })
          return
        }
        if (url === '/v1/claude/sessions' || url.startsWith('/v1/claude/sessions?')) {
          const u = new URL(`http://127.0.0.1${url}`)
          const limit = parsePositiveInt(u.searchParams.get('limit'), 100, 300)
          const offset = parsePositiveInt(u.searchParams.get('offset'), 0, 200_000)
          const sessions = listClaudeMemorySessions(db, { limit, offset })
          sendJson(res, 200, { sessions, limit, offset })
          return
        }
        const sessionId = parseClaudeSessionEventsRoute(url.split('?')[0] ?? '')
        if (!sessionId) {
          sendJson(res, 404, { error: 'Not found' })
          return
        }
        const u = new URL(`http://127.0.0.1${url}`)
        const limit = parsePositiveInt(u.searchParams.get('limit'), 300, 2000)
        const offset = parsePositiveInt(u.searchParams.get('offset'), 0, 500_000)
        const events = listClaudeMemoryEvents(db, sessionId, { limit, offset })
        sendJson(res, 200, { sessionId, events, limit, offset })
        return
      }

      if (method === 'GET' && url === '/v1/claude/memory/stats') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const db = getDb?.()
        if (!db) {
          sendJson(res, 503, { error: 'Database unavailable' })
          return
        }
        sendJson(res, 200, { ...getClaudeMemoryCaptureStats(db) })
        return
      }

      if (method === 'POST' && url === '/v1/claude/memory/export-jsonl') {
        if (!authOkForProtectedRoutes(store, req)) {
          sendJson(res, 401, { error: 'Unauthorized' })
          return
        }
        const db = getDb?.()
        if (!db) {
          sendJson(res, 503, { error: 'Database unavailable' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          appendClaudeDeadLetter(db, { source: 'claude-code', reason: 'export_invalid_json' })
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }
        const parsed = z
          .object({
            sessionIds: z.array(z.string().min(1)).min(1).max(200),
            destPath: z.string().min(1).max(8192)
          })
          .safeParse(body)
        if (!parsed.success) {
          appendClaudeDeadLetter(db, { source: 'claude-code', reason: 'export_invalid_body', body })
          sendJson(res, 400, { error: 'Invalid body: expected { sessionIds, destPath }' })
          return
        }
        try {
          const out = exportClaudeMemorySessionsToTrainingJsonl(db, parsed.data.sessionIds, parsed.data.destPath)
          sendJson(res, 200, { ok: true, ...out, path: parsed.data.destPath })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          sendJson(res, 400, { ok: false, error: message })
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
