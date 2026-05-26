import { app, ipcMain } from 'electron'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import http from 'node:http'
import { join } from 'path'
import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type {
  BridgeSelfTestStep,
  IntegrationBridgeSelfTestResult,
  IntegrationBridgeSmokeChat
} from '@shared/ideJourney'
import {
  exportClaudeMemorySessionsToTrainingJsonl,
  getClaudeMemoryCaptureStats,
  listClaudeMemoryEvents,
  listClaudeMemorySessions
} from '../services/claudeMemoryStore'
import { getPluginReportHistory } from '../services/pluginIntegrationHub'

/** Loopback HTTP client for IDE bridge self-test (same host as integration server). */
async function localhostJsonRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<{ statusCode: number; body: string }> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { ...opts.headers }
  const body = opts.body
  if (body && headers['Content-Length'] == null) {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
  }
  const timeoutMs = opts.timeoutMs ?? 8000
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    if (body) req.write(body)
    req.end()
  })
}

type IntegrationDeps = {
  store: Store<Record<string, unknown>>
  db: Database.Database
}

export function registerIntegrationIpc(deps: IntegrationDeps): void {
  const { store, db } = deps

  ipcMain.handle(IPC.INTEGRATION_PLUGIN_REPORTS_LIST, () => getPluginReportHistory())
  ipcMain.handle(IPC.CLAUDE_BRIDGE_START, (_e, raw?: unknown) => {
    const p = z
      .object({
        serverName: z.string().min(1).max(64).optional()
      })
      .safeParse(raw ?? {})
    if (!p.success) return { ok: false, error: 'Invalid bridge launch payload' }

    const scriptPath = join(app.getAppPath(), 'scripts', 'claude-bridge-mcp.ps1')
    if (!existsSync(scriptPath)) {
      return { ok: false, error: `Bridge launcher not found at ${scriptPath}` }
    }
    const rawPort = store.get('integrationPort')
    const port =
      typeof rawPort === 'number' && Number.isFinite(rawPort)
        ? Math.min(65535, Math.max(1024, Math.floor(rawPort)))
        : 17373
    const tokenRaw = store.get('integrationToken')
    const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : ''
    const serverName = p.data.serverName?.trim() || 'my-bridge'
    const stdioArgs = [
      'mcp',
      'add',
      '--transport',
      'stdio',
      serverName,
      '--',
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Url',
      `http://127.0.0.1:${port}`,
      ...(token ? ['-Token', token] : [])
    ]

    try {
      spawnSync('claude', ['mcp', 'remove', serverName], {
        cwd: app.getAppPath(),
        shell: process.platform === 'win32',
        stdio: 'ignore'
      })
      const add = spawnSync('claude', stdioArgs, {
        cwd: app.getAppPath(),
        shell: process.platform === 'win32',
        encoding: 'utf8'
      })
      if (add.status !== 0) {
        const detail = [add.stdout, add.stderr].filter(Boolean).join('\n').trim()
        return { ok: false, error: detail || `claude mcp add failed (exit ${add.status ?? 'unknown'})` }
      }
      return {
        ok: true,
        detail: `Configured Claude MCP server "${serverName}".`,
        command: `claude mcp add --transport stdio ${serverName} -- powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}" -Url http://127.0.0.1:${port}${token ? ' -Token YOUR_TOKEN' : ''}`
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.CLAUDE_MEMORY_STATUS, () => getClaudeMemoryCaptureStats(db))
  ipcMain.handle(IPC.CLAUDE_MEMORY_SESSIONS, (_e, raw?: unknown) => {
    const p = z
      .object({
        limit: z.number().int().min(1).max(300).optional(),
        offset: z.number().int().min(0).max(200_000).optional()
      })
      .safeParse(raw ?? {})
    if (!p.success) return listClaudeMemorySessions(db, { limit: 100, offset: 0 })
    return listClaudeMemorySessions(db, { limit: p.data.limit, offset: p.data.offset })
  })
  ipcMain.handle(IPC.CLAUDE_MEMORY_SESSION_EVENTS, (_e, raw: unknown) => {
    const p = z
      .object({
        sessionId: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(2000).optional(),
        offset: z.number().int().min(0).max(500_000).optional()
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid Claude memory event query')
    return listClaudeMemoryEvents(db, p.data.sessionId, { limit: p.data.limit, offset: p.data.offset })
  })
  ipcMain.handle(IPC.CLAUDE_MEMORY_EXPORT_JSONL, (_e, raw: unknown) => {
    const p = z
      .object({
        sessionIds: z.array(z.string().min(1)).min(1).max(200),
        destPath: z.string().min(1).max(8192)
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid Claude memory export payload')
    return exportClaudeMemorySessionsToTrainingJsonl(db, p.data.sessionIds, p.data.destPath)
  })

  ipcMain.handle(IPC.INTEGRATION_BRIDGE_SELF_TEST, async (_e, raw?: unknown): Promise<IntegrationBridgeSelfTestResult> => {
    const smokeChat =
      raw != null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as { smokeChat?: unknown }).smokeChat === true

    const enabled = store.get('integrationListenEnabled') === true
    const rawPort = store.get('integrationPort')
    const port =
      typeof rawPort === 'number' && Number.isFinite(rawPort)
        ? Math.min(65535, Math.max(1024, Math.floor(rawPort)))
        : 17373
    const steps: BridgeSelfTestStep[] = []

    if (!enabled) {
      return {
        ok: false,
        summary: 'IDE HTTP bridge is disabled. Turn it on under Settings -> Integrations.',
        steps: [
          {
            id: 'bridge',
            ok: false,
            detail: 'integrationListenEnabled is false'
          }
        ],
        smokeChat: smokeChat ? { ok: false, detail: 'Bridge disabled' } : null
      }
    }

    const tokenRaw = store.get('integrationToken')
    const token = typeof tokenRaw === 'string' && tokenRaw.trim() ? tokenRaw.trim() : ''
    const authHeaders: Record<string, string> = {}
    if (token) authHeaders.Authorization = `Bearer ${token}`

    let healthRuntimeRunning = false
    try {
      const h = await localhostJsonRequest(port, '/health', { method: 'GET', timeoutMs: 5000 })
      const ok = h.statusCode === 200
      if (ok) {
        try {
          const j = JSON.parse(h.body) as { runtimeRunning?: boolean; runtimeKind?: string }
          healthRuntimeRunning = Boolean(j.runtimeRunning)
          const kind = typeof j.runtimeKind === 'string' ? j.runtimeKind : ''
          steps.push({
            id: 'health',
            ok: true,
            detail: `HTTP ${h.statusCode} · runtimeRunning=${healthRuntimeRunning}${kind ? ` · ${kind}` : ''}`
          })
        } catch {
          steps.push({ id: 'health', ok: true, detail: `HTTP ${h.statusCode} (body not JSON)` })
        }
      } else {
        steps.push({ id: 'health', ok: false, detail: `HTTP ${h.statusCode}` })
      }
    } catch (e) {
      steps.push({
        id: 'health',
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }

    if (!steps.find((s) => s.id === 'health')?.ok) {
      return {
        ok: false,
        summary: 'Health check failed - fix connection or enable the bridge.',
        steps,
        smokeChat: smokeChat ? { ok: false, detail: 'Skipped - health failed' } : null
      }
    }

    try {
      const r = await localhostJsonRequest(port, '/v1/runtime/status', {
        method: 'GET',
        headers: { ...authHeaders },
        timeoutMs: 5000
      })
      const ok = r.statusCode === 200
      let extra = ''
      if (r.statusCode === 401) extra = ' - check bearer token matches this app and your client'
      if (ok) {
        try {
          const j = JSON.parse(r.body) as { running?: boolean; kind?: string }
          extra = ` · running=${Boolean(j.running)}${j.kind ? ` · ${j.kind}` : ''}`
        } catch {
          /* ignore */
        }
      }
      steps.push({
        id: 'runtime_status',
        ok,
        detail: `HTTP ${r.statusCode}${extra}`
      })
    } catch (e) {
      steps.push({
        id: 'runtime_status',
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      })
    }

    let smoke: IntegrationBridgeSmokeChat | null = null
    if (smokeChat) {
      if (!healthRuntimeRunning) {
        smoke = {
          ok: false,
          detail: 'Skipped - start the model runtime first (/health reports runtimeRunning).'
        }
      } else {
        try {
          const chatBody = JSON.stringify({
            messages: [
              { role: 'system', content: 'Reply with a single token.' },
              { role: 'user', content: 'ping' }
            ],
            maxTokens: 1
          })
          const r = await localhostJsonRequest(port, '/v1/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders
            },
            body: chatBody,
            timeoutMs: 120_000
          })
          const ok = r.statusCode === 200
          let preview = ''
          if (ok) {
            try {
              const j = JSON.parse(r.body) as { reply?: string }
              if (typeof j.reply === 'string') preview = j.reply.replace(/\s+/g, ' ').trim().slice(0, 64)
            } catch {
              /* ignore */
            }
          }
          smoke = {
            ok,
            httpStatus: r.statusCode,
            detail: ok
              ? `HTTP ${r.statusCode}${preview ? ` · ${preview}` : ''}`
              : `HTTP ${r.statusCode} - ${r.body.replace(/\s+/g, ' ').trim().slice(0, 160)}`
          }
        } catch (e) {
          smoke = { ok: false, detail: e instanceof Error ? e.message : String(e) }
        }
      }
    }

    const coreOk = steps.every((s) => s.ok)
    const smokeOk = smoke == null || smoke.ok
    const ok = coreOk && smokeOk
    let summary = coreOk
      ? 'Health and /v1/runtime/status succeeded.'
      : 'One or more checks failed - see steps.'
    if (smokeChat && smoke) {
      summary += smoke.ok ? ' Smoke chat succeeded.' : ` Smoke chat: ${smoke.detail}`
    }
    return { ok, summary, steps, smokeChat: smokeChat ? smoke : null }
  })
}
