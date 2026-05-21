#!/usr/bin/env node
import { randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = process.env.LOCAL_LLM_INTEGRATION_URL || 'http://127.0.0.1:17373'

function parseArgs(argv) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    token: process.env.LOCAL_LLM_INTEGRATION_TOKEN || ''
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') out.baseUrl = String(argv[++i] || out.baseUrl)
    else if (a === '--token') out.token = String(argv[++i] || '')
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  process.stderr.write(
    [
      'Claude MCP stdio bridge for Local LLM Desktop',
      '',
      'Usage:',
      '  node scripts/claude-bridge-mcp-stdio.mjs [--url <baseUrl>] [--token <bearerToken>]',
      '',
      'Env:',
      '  LOCAL_LLM_INTEGRATION_URL',
      '  LOCAL_LLM_INTEGRATION_TOKEN',
      ''
    ].join('\n')
  )
  process.exit(0)
}

function sendMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

function sendResult(id, result) {
  sendMessage({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message, data) {
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {})
    }
  })
}

async function bridgeRequest(path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (opts.token.trim()) headers.Authorization = `Bearer ${opts.token.trim()}`
  const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { ok: true, raw: text }
  }
}

async function bridgeGet(path) {
  const headers = {}
  if (opts.token.trim()) headers.Authorization = `Bearer ${opts.token.trim()}`
  const res = await fetch(`${opts.baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'GET',
    headers
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { ok: true, raw: text }
  }
}

function okText(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  }
}

const TOOL_DEFS = [
  {
    name: 'bridge_health',
    description: 'Return direct Claude bridge health from Local LLM Desktop.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: 'start_session',
    description: 'Start a Claude memory session in Local LLM Desktop.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        projectPath: { type: 'string' },
        source: { type: 'string' },
        metadata: { type: 'object' }
      },
      additionalProperties: true
    }
  },
  {
    name: 'append_events',
    description: 'Append Claude memory events for a session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        source: { type: 'string' },
        events: { type: 'array' }
      },
      required: ['sessionId', 'events'],
      additionalProperties: true
    }
  },
  {
    name: 'end_session',
    description: 'End a Claude memory session in Local LLM Desktop.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        endedAt: { type: 'number' },
        metadata: { type: 'object' }
      },
      required: ['sessionId'],
      additionalProperties: true
    }
  },
  {
    name: 'record_interaction',
    description: 'Convenience helper to append one user/assistant event.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        role: { type: 'string', enum: ['user', 'assistant'] },
        content: { type: 'string' },
        turnId: { type: 'string' },
        model: { type: 'string' }
      },
      required: ['sessionId', 'role', 'content'],
      additionalProperties: true
    }
  }
]

async function handleCall(name, args) {
  if (name === 'bridge_health') {
    const out = await bridgeGet('/v1/claude/health')
    return okText(out)
  }
  if (name === 'start_session') {
    const body = {
      sessionId: String(args?.sessionId || randomUUID()),
      ...(args?.projectPath ? { projectPath: String(args.projectPath) } : {}),
      ...(args?.source ? { source: String(args.source) } : { source: 'claude-mcp' }),
      ...(args?.metadata && typeof args.metadata === 'object' ? { metadata: args.metadata } : {})
    }
    return okText(await bridgeRequest('/v1/claude/session/start', body))
  }
  if (name === 'append_events') {
    const sessionId = String(args?.sessionId || '').trim()
    if (!sessionId) throw new Error('sessionId is required')
    if (!Array.isArray(args?.events) || args.events.length === 0) throw new Error('events[] is required')
    const body = {
      source: args?.source ? String(args.source) : 'claude-mcp',
      sessionId,
      events: args.events
    }
    return okText(await bridgeRequest('/v1/claude/events', body))
  }
  if (name === 'end_session') {
    const sessionId = String(args?.sessionId || '').trim()
    if (!sessionId) throw new Error('sessionId is required')
    const body = {
      sessionId,
      ...(typeof args?.endedAt === 'number' ? { endedAt: args.endedAt } : {}),
      ...(args?.metadata && typeof args.metadata === 'object' ? { metadata: args.metadata } : {})
    }
    return okText(await bridgeRequest('/v1/claude/session/end', body))
  }
  if (name === 'record_interaction') {
    const sessionId = String(args?.sessionId || '').trim()
    const role = String(args?.role || '').trim()
    const content = String(args?.content || '')
    if (!sessionId) throw new Error('sessionId is required')
    if (role !== 'user' && role !== 'assistant') throw new Error('role must be "user" or "assistant"')
    if (!content.trim()) throw new Error('content is required')
    const ev = {
      eventId: `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      sessionId,
      turnId: args?.turnId ? String(args.turnId) : undefined,
      sequence: typeof args?.sequence === 'number' ? Math.max(0, Math.floor(args.sequence)) : 0,
      eventType: role === 'user' ? 'user_message' : 'assistant_message',
      timestamp: Date.now(),
      model: args?.model ? String(args.model) : undefined,
      payload: { content }
    }
    return okText(
      await bridgeRequest('/v1/claude/events', {
        source: 'claude-mcp',
        sessionId,
        events: [ev]
      })
    )
  }
  throw new Error(`Unknown tool: ${name}`)
}

async function handleRequest(msg) {
  const method = msg.method
  if (method === 'initialize') {
    const requestedProtocol =
      msg?.params && typeof msg.params === 'object' && typeof msg.params.protocolVersion === 'string'
        ? msg.params.protocolVersion
        : '2024-11-05'
    sendResult(msg.id, {
      protocolVersion: requestedProtocol,
      capabilities: {
        tools: { listChanged: false },
        resources: {},
        prompts: {}
      },
      serverInfo: {
        name: 'local-llm-claude-bridge',
        version: '1.0.0'
      }
    })
    return
  }
  if (method === 'tools/list') {
    sendResult(msg.id, { tools: TOOL_DEFS })
    return
  }
  if (method === 'resources/list') {
    sendResult(msg.id, { resources: [] })
    return
  }
  if (method === 'prompts/list') {
    sendResult(msg.id, { prompts: [] })
    return
  }
  if (method === 'ping') {
    sendResult(msg.id, {})
    return
  }
  if (method === 'tools/call') {
    const params = msg.params || {}
    const name = String(params.name || '')
    const args = params.arguments || {}
    try {
      const result = await handleCall(name, args)
      sendResult(msg.id, result)
    } catch (error) {
      sendError(msg.id, -32000, error instanceof Error ? error.message : String(error))
    }
    return
  }
  if (method === 'notifications/initialized') return
  if (method === 'notifications/cancelled') return
  if (msg.id != null) {
    sendError(msg.id, -32601, `Method not found: ${method}`)
  }
}

let buffer = Buffer.alloc(0)

function tryParseMessage() {
  const crlfDelimiter = '\r\n\r\n'
  const lfDelimiter = '\n\n'
  const headerEndCrlf = buffer.indexOf(crlfDelimiter)
  const headerEndLf = buffer.indexOf(lfDelimiter)
  let headerEnd = -1
  let delimiterLength = 0
  if (headerEndCrlf >= 0 && (headerEndLf < 0 || headerEndCrlf < headerEndLf)) {
    headerEnd = headerEndCrlf
    delimiterLength = crlfDelimiter.length
  } else if (headerEndLf >= 0) {
    headerEnd = headerEndLf
    delimiterLength = lfDelimiter.length
  } else {
    return null
  }

  const headerText = buffer.slice(0, headerEnd).toString('utf8')
  const headers = new Map()
  for (const line of headerText.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const k = line.slice(0, idx).trim().toLowerCase()
    const v = line.slice(idx + 1).trim()
    headers.set(k, v)
  }
  const lenRaw = headers.get('content-length')
  const len = Number(lenRaw)
  if (!Number.isFinite(len) || len < 0) return null
  const bodyStart = headerEnd + delimiterLength
  if (buffer.length < bodyStart + len) return null
  const body = buffer.slice(bodyStart, bodyStart + len).toString('utf8')
  buffer = buffer.slice(bodyStart + len)
  return body
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const raw = tryParseMessage()
    if (raw == null) break
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      continue
    }
    void handleRequest(msg)
  }
})

process.stdin.resume()

