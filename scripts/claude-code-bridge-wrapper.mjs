#!/usr/bin/env node
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Claude Code wrapper that forwards interaction events to Local LLM Desktop.
 *
 * Usage:
 *   node scripts/claude-code-bridge-wrapper.mjs [wrapper opts] -- [claude args...]
 *
 * Example:
 *   node scripts/claude-code-bridge-wrapper.mjs \
 *     --url http://127.0.0.1:17373 \
 *     --token YOUR_TOKEN \
 *     --project "C:/path/to/project" \
 *     --prompt "Summarize this repository" \
 *     -- --print
 *
 * Wrapper options:
 *   --url <baseUrl>           default: http://127.0.0.1:17373
 *   --token <bearerToken>     optional; can also use LOCAL_LLM_INTEGRATION_TOKEN
 *   --project <projectPath>   default: process.cwd()
 *   --session-id <id>         default: random UUID
 *   --source <name>           default: claude-code-wrapper
 *   --batch-size <n>          default: 24
 *   --claude-bin <path>       default: claude
 *   --prompt <text>           optional explicit user prompt
 *   --help                    show help
 */

const DEFAULT_BASE_URL = process.env.LOCAL_LLM_INTEGRATION_URL || 'http://127.0.0.1:17373'
const DEFAULT_BATCH_SIZE = 24
const DEFAULT_SOURCE = 'claude-code-wrapper'

function usage() {
  process.stdout.write(
    [
      'Claude Code -> Local LLM Desktop bridge wrapper',
      '',
      'Usage:',
      '  node scripts/claude-code-bridge-wrapper.mjs [wrapper opts] -- [claude args...]',
      '',
      'Wrapper options:',
      '  --url <baseUrl>',
      '  --token <bearerToken>',
      '  --project <projectPath>',
      '  --session-id <id>',
      '  --source <name>',
      '  --batch-size <n>',
      '  --claude-bin <path>',
      '  --prompt <text>',
      '  --help',
      '',
      'Environment variables:',
      '  LOCAL_LLM_INTEGRATION_URL',
      '  LOCAL_LLM_INTEGRATION_TOKEN',
      '  CLAUDE_BRIDGE_SPOOL_DIR',
      ''
    ].join('\n')
  )
}

function parseArgs(argv) {
  const result = {
    baseUrl: DEFAULT_BASE_URL,
    token: process.env.LOCAL_LLM_INTEGRATION_TOKEN || '',
    projectPath: process.cwd(),
    sessionId: randomUUID(),
    source: DEFAULT_SOURCE,
    batchSize: DEFAULT_BATCH_SIZE,
    claudeBin: 'claude',
    prompt: '',
    claudeArgs: []
  }
  const args = [...argv]
  const dashDash = args.indexOf('--')
  const mainArgs = dashDash >= 0 ? args.slice(0, dashDash) : args
  result.claudeArgs = dashDash >= 0 ? args.slice(dashDash + 1) : []
  for (let i = 0; i < mainArgs.length; i++) {
    const a = mainArgs[i]
    if (a === '--help' || a === '-h') return { ...result, help: true }
    if (a === '--url') result.baseUrl = String(mainArgs[++i] || result.baseUrl)
    else if (a === '--token') result.token = String(mainArgs[++i] || '')
    else if (a === '--project') result.projectPath = String(mainArgs[++i] || result.projectPath)
    else if (a === '--session-id') result.sessionId = String(mainArgs[++i] || result.sessionId)
    else if (a === '--source') result.source = String(mainArgs[++i] || result.source)
    else if (a === '--batch-size') result.batchSize = Math.max(1, Math.min(200, Number(mainArgs[++i] || DEFAULT_BATCH_SIZE)))
    else if (a === '--claude-bin') result.claudeBin = String(mainArgs[++i] || result.claudeBin)
    else if (a === '--prompt') result.prompt = String(mainArgs[++i] || '')
    else {
      if (!a.startsWith('--')) result.claudeArgs.push(a)
    }
  }
  return result
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  usage()
  process.exit(0)
}

if (!opts.claudeArgs.length && !opts.prompt.trim()) {
  process.stderr.write(
    'No Claude args or --prompt provided. Pass Claude args after "--" or provide --prompt.\n'
  )
}

const spoolDir = process.env.CLAUDE_BRIDGE_SPOOL_DIR || join(homedir(), '.local-llm-desktop', 'claude-bridge-spool')
const spoolFile = join(spoolDir, 'requests.jsonl')
if (!existsSync(spoolDir)) mkdirSync(spoolDir, { recursive: true })

function now() {
  return Date.now()
}

function trimText(text, max = 12000) {
  const t = String(text || '')
  return t.length > max ? `${t.slice(0, max)}...` : t
}

async function postJson(path, body) {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}${path}`
  const headers = { 'Content-Type': 'application/json' }
  if (opts.token.trim()) headers.Authorization = `Bearer ${opts.token.trim()}`
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${response.statusText} ${text}`.trim())
  }
}

function spoolRequest(kind, body, reason) {
  const rec = { id: randomUUID(), kind, body, reason: trimText(reason, 500), createdAt: now() }
  appendFileSync(spoolFile, `${JSON.stringify(rec)}\n`, 'utf8')
}

async function flushSpool() {
  if (!existsSync(spoolFile)) return
  const lines = readFileSync(spoolFile, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!lines.length) return
  const keep = []
  for (const line of lines) {
    try {
      const rec = JSON.parse(line)
      if (rec.kind === 'session_start') await postJson('/v1/claude/session/start', rec.body)
      else if (rec.kind === 'events') await postJson('/v1/claude/events', rec.body)
      else if (rec.kind === 'session_end') await postJson('/v1/claude/session/end', rec.body)
      else keep.push(line)
    } catch (error) {
      keep.push(line)
      break
    }
  }
  if (keep.length) writeFileSync(spoolFile, `${keep.join('\n')}\n`, 'utf8')
  else writeFileSync(spoolFile, '', 'utf8')
}

function eventId(sessionId, sequence, eventType, payload) {
  const hash = createHash('sha1')
    .update(`${sessionId}|${sequence}|${eventType}|${JSON.stringify(payload || {})}`)
    .digest('hex')
    .slice(0, 12)
  return `${sessionId}:${sequence}:${hash}`
}

let sequence = 0
let queuedEvents = []

function makeEvent(eventType, payload, extra = {}) {
  const ev = {
    eventId: eventId(opts.sessionId, sequence, eventType, payload),
    sessionId: opts.sessionId,
    sequence,
    eventType,
    timestamp: now(),
    projectPath: opts.projectPath,
    sourceClientVersion: 'wrapper-v1',
    payload,
    ...extra
  }
  sequence += 1
  return ev
}

async function sendEvents(force = false) {
  if (!queuedEvents.length) return
  if (!force && queuedEvents.length < opts.batchSize) return
  const batch = queuedEvents.splice(0, queuedEvents.length)
  const body = { source: opts.source, sessionId: opts.sessionId, events: batch }
  try {
    await postJson('/v1/claude/events', body)
  } catch (error) {
    spoolRequest('events', body, error instanceof Error ? error.message : String(error))
  }
}

async function sendSessionStart() {
  const body = {
    sessionId: opts.sessionId,
    source: opts.source,
    projectPath: opts.projectPath,
    startedAt: now(),
    metadata: {
      wrapper: 'claude-code-bridge-wrapper',
      claudeBin: opts.claudeBin,
      claudeArgs: opts.claudeArgs
    }
  }
  try {
    await postJson('/v1/claude/session/start', body)
  } catch (error) {
    spoolRequest('session_start', body, error instanceof Error ? error.message : String(error))
  }
}

async function sendSessionEnd(exitCode, signal) {
  const body = {
    sessionId: opts.sessionId,
    endedAt: now(),
    metadata: {
      exitCode,
      signal: signal || null
    }
  }
  try {
    await postJson('/v1/claude/session/end', body)
  } catch (error) {
    spoolRequest('session_end', body, error instanceof Error ? error.message : String(error))
  }
}

function queueEvent(eventType, payload, extra) {
  queuedEvents.push(makeEvent(eventType, payload, extra))
}

function summarizeStderr(stderrText) {
  const clean = stderrText.trim()
  if (!clean) return null
  return trimText(clean, 16000)
}

async function main() {
  await flushSpool()
  await sendSessionStart()

  queueEvent('shell_command', {
    command: opts.claudeBin,
    args: opts.claudeArgs,
    wrapperPid: process.pid
  })
  if (opts.prompt.trim()) {
    queueEvent('user_message', { content: opts.prompt.trim() })
  }
  await sendEvents(true)

  const child = spawn(opts.claudeBin, opts.claudeArgs, {
    cwd: opts.projectPath,
    shell: process.platform === 'win32',
    stdio: ['inherit', 'pipe', 'pipe']
  })

  let stdoutText = ''
  let stderrText = ''
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    stdoutText += text
    process.stdout.write(text)
  })
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString()
    stderrText += text
    process.stderr.write(text)
  })

  const exit = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code: code ?? 0, signal: signal || null }))
    child.on('error', (error) => resolve({ code: 1, signal: null, spawnError: String(error?.message || error) }))
  })

  const assistant = trimText(stdoutText.trim(), 200000)
  if (assistant) {
    queueEvent('assistant_message', {
      content: assistant
    })
  }
  const stderrSummary = summarizeStderr(stderrText)
  if (stderrSummary) {
    queueEvent('diagnostic', {
      stream: 'stderr',
      message: stderrSummary
    })
  }
  if (exit.spawnError) {
    queueEvent('diagnostic', { stream: 'wrapper', message: trimText(exit.spawnError, 4000) })
  }

  queueEvent('session_ended', {
    exitCode: exit.code,
    signal: exit.signal
  })

  await sendEvents(true)
  await sendSessionEnd(exit.code, exit.signal)
  await flushSpool()

  process.exitCode = exit.code
}

main().catch((error) => {
  process.stderr.write(`[claude-bridge-wrapper] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})

