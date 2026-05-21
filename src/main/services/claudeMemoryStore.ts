import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type Database from 'better-sqlite3'
import type {
  ClaudeMemoryCaptureStats,
  ClaudeMemoryEventEnvelope,
  ClaudeMemoryEventRecord,
  ClaudeMemorySessionRecord
} from '@shared/types'

const MAX_EVENT_PAYLOAD_BYTES = 1_500_000
const MEMORY_CHUNK_SIZE = 1200
const MEMORY_CHUNK_OVERLAP = 180

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { ok: number } | undefined
  return Boolean(row?.ok)
}

function normalizeJsonObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function payloadAsString(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload)
  } catch {
    return '{}'
  }
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= MEMORY_CHUNK_SIZE) return [clean]
  const out: string[] = []
  let i = 0
  while (i < clean.length) {
    const end = Math.min(clean.length, i + MEMORY_CHUNK_SIZE)
    out.push(clean.slice(i, end))
    if (end >= clean.length) break
    i = Math.max(0, end - MEMORY_CHUNK_OVERLAP)
  }
  return out
}

function titleForEvent(eventType: string, toolName?: string): string {
  if (toolName?.trim()) return `${eventType} (${toolName.trim()})`
  return eventType.replace(/_/g, ' ')
}

function extractMemoryText(event: ClaudeMemoryEventEnvelope): string {
  const payload = event.payload
  const fields = [
    payload.content,
    payload.text,
    payload.message,
    payload.output,
    payload.result,
    payload.diff,
    payload.command,
    payload.stderr,
    payload.stdout
  ]
  const collected = fields
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
  if (collected.length > 0) return collected.join('\n\n')
  return payloadAsString(payload)
}

export function startClaudeMemorySession(
  db: Database.Database,
  input: {
    sessionId: string
    source: string
    projectPath?: string
    startedAt?: number
    metadata?: Record<string, unknown>
  }
): ClaudeMemorySessionRecord {
  const id = input.sessionId.trim()
  if (!id) throw new Error('sessionId is required')
  const now = Date.now()
  const startedAt = toNumber(input.startedAt, now)
  const source = input.source.trim() || 'claude-code'
  const metadataJson = payloadAsString(normalizeJsonObject(input.metadata))
  db.prepare(
    `INSERT INTO claude_memory_sessions
      (id, source, project_path, metadata_json, started_at, ended_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source = excluded.source,
       project_path = COALESCE(excluded.project_path, claude_memory_sessions.project_path),
       metadata_json = COALESCE(excluded.metadata_json, claude_memory_sessions.metadata_json),
       updated_at = excluded.updated_at`
  ).run(id, source, input.projectPath?.trim() || null, metadataJson, startedAt, now, now)
  const row = db
    .prepare(
      `SELECT id, source, project_path as projectPath, started_at as startedAt, ended_at as endedAt,
              created_at as createdAt, updated_at as updatedAt, metadata_json as metadataJson
       FROM claude_memory_sessions WHERE id = ? LIMIT 1`
    )
    .get(id) as
    | {
        id: string
        source: string
        projectPath: string | null
        startedAt: number
        endedAt: number | null
        createdAt: number
        updatedAt: number
        metadataJson: string | null
      }
    | undefined
  if (!row) throw new Error('Failed to create session')
  const counts = db
    .prepare(
      `SELECT COUNT(*) as eventCount,
              COALESCE(SUM(COALESCE(token_prompt, 0)), 0) as tokenPrompt,
              COALESCE(SUM(COALESCE(token_completion, 0)), 0) as tokenCompletion
       FROM claude_memory_events WHERE session_id = ?`
    )
    .get(id) as { eventCount: number; tokenPrompt: number; tokenCompletion: number } | undefined
  return {
    id: row.id,
    source: row.source,
    projectPath: row.projectPath,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    eventCount: Number(counts?.eventCount ?? 0),
    tokenCountPrompt: Number(counts?.tokenPrompt ?? 0),
    tokenCountCompletion: Number(counts?.tokenCompletion ?? 0),
    metadataJson: row.metadataJson
  }
}

export function endClaudeMemorySession(
  db: Database.Database,
  input: { sessionId: string; endedAt?: number; metadata?: Record<string, unknown> }
): boolean {
  const id = input.sessionId.trim()
  if (!id) throw new Error('sessionId is required')
  const now = Date.now()
  const endedAt = toNumber(input.endedAt, now)
  const metadata = input.metadata ? payloadAsString(normalizeJsonObject(input.metadata)) : null
  const res = db
    .prepare(
      `UPDATE claude_memory_sessions
       SET ended_at = ?, updated_at = ?, metadata_json = COALESCE(?, metadata_json)
       WHERE id = ?`
    )
    .run(endedAt, now, metadata, id)
  return res.changes > 0
}

export function appendClaudeDeadLetter(
  db: Database.Database,
  input: { source: string; reason: string; body?: unknown }
): void {
  if (!tableExists(db, 'claude_memory_dead_letters')) return
  const serialized =
    input.body == null
      ? null
      : (() => {
          try {
            return JSON.stringify(input.body)
          } catch {
            return null
          }
        })()
  db.prepare(
    `INSERT INTO claude_memory_dead_letters (id, source, reason, body_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), input.source.trim() || 'claude-code', input.reason.slice(0, 400), serialized, Date.now())
}

function deriveMemoryUnitsForEvent(db: Database.Database, event: ClaudeMemoryEventEnvelope): number {
  if (!tableExists(db, 'claude_memory_rag_units')) return 0
  const extracted = extractMemoryText(event)
  const chunks = chunkText(extracted).slice(0, 24)
  if (chunks.length === 0) return 0
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO claude_memory_rag_units
      (id, session_id, event_id, ord, title, text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, ord) DO UPDATE SET
       title = excluded.title,
       text = excluded.text,
       updated_at = excluded.updated_at`
  )
  for (const [idx, text] of chunks.entries()) {
    insert.run(
      randomUUID(),
      event.sessionId,
      event.eventId,
      idx,
      titleForEvent(event.eventType, event.toolName),
      text,
      now,
      now
    )
  }
  return chunks.length
}

export function appendClaudeMemoryEvents(
  db: Database.Database,
  input: { source: string; sessionId: string; events: ClaudeMemoryEventEnvelope[]; maxPayloadBytes?: number }
): { accepted: number; duplicates: number; derivedUnits: number } {
  const source = input.source.trim() || 'claude-code'
  const sessionId = input.sessionId.trim()
  if (!sessionId) throw new Error('sessionId is required')
  const events = input.events
    .filter((event) => event.sessionId.trim() === sessionId)
    .sort((a, b) => a.sequence - b.sequence || a.timestamp - b.timestamp)
  if (events.length === 0) return { accepted: 0, duplicates: 0, derivedUnits: 0 }
  const cap = Math.max(2048, Math.min(8_000_000, input.maxPayloadBytes ?? MAX_EVENT_PAYLOAD_BYTES))
  startClaudeMemorySession(db, {
    sessionId,
    source,
    projectPath: events[0]?.projectPath,
    startedAt: events[0]?.timestamp
  })
  let accepted = 0
  let duplicates = 0
  let derivedUnits = 0
  const insertEvent = db.prepare(
    `INSERT INTO claude_memory_events
      (event_id, session_id, turn_id, sequence, event_type, timestamp, project_path, model, tool_name,
       source_client_version, token_prompt, token_completion, payload_json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  )
  const tx = db.transaction(() => {
    for (const event of events) {
      const payload = normalizeJsonObject(event.payload)
      const payloadJson = payloadAsString(payload)
      if (Buffer.byteLength(payloadJson, 'utf8') > cap) {
        appendClaudeDeadLetter(db, {
          source,
          reason: `payload_too_large:${event.eventId}`,
          body: { sessionId, eventId: event.eventId, payloadBytes: Buffer.byteLength(payloadJson, 'utf8') }
        })
        continue
      }
      const res = insertEvent.run(
        event.eventId,
        sessionId,
        event.turnId?.trim() || null,
        event.sequence,
        event.eventType,
        event.timestamp,
        event.projectPath?.trim() || null,
        event.model?.trim() || null,
        event.toolName?.trim() || null,
        event.sourceClientVersion?.trim() || null,
        event.tokenUsage?.promptTokens ?? null,
        event.tokenUsage?.completionTokens ?? null,
        payloadJson,
        Date.now()
      )
      if (res.changes > 0) {
        accepted++
        derivedUnits += deriveMemoryUnitsForEvent(db, {
          ...event,
          payload
        })
      } else {
        duplicates++
      }
    }
    db.prepare('UPDATE claude_memory_sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
  })
  tx()
  return { accepted, duplicates, derivedUnits }
}

export function listClaudeMemorySessions(
  db: Database.Database,
  opts: { limit?: number; offset?: number } = {}
): ClaudeMemorySessionRecord[] {
  const limit = Math.max(1, Math.min(300, opts.limit ?? 100))
  const offset = Math.max(0, opts.offset ?? 0)
  const rows = db
    .prepare(
      `SELECT s.id, s.source, s.project_path as projectPath, s.started_at as startedAt, s.ended_at as endedAt,
              s.created_at as createdAt, s.updated_at as updatedAt, s.metadata_json as metadataJson,
              COALESCE(e.eventCount, 0) as eventCount,
              COALESCE(e.tokenPrompt, 0) as tokenPrompt,
              COALESCE(e.tokenCompletion, 0) as tokenCompletion
       FROM claude_memory_sessions s
       LEFT JOIN (
         SELECT session_id as sessionId,
                COUNT(*) as eventCount,
                COALESCE(SUM(COALESCE(token_prompt, 0)), 0) as tokenPrompt,
                COALESCE(SUM(COALESCE(token_completion, 0)), 0) as tokenCompletion
         FROM claude_memory_events
         GROUP BY session_id
       ) e ON e.sessionId = s.id
       ORDER BY s.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<Record<string, unknown>>
  return rows.map((row) => ({
    id: String(row.id),
    source: String(row.source),
    projectPath: (row.projectPath as string | null) ?? null,
    startedAt: Number(row.startedAt ?? 0),
    endedAt: (row.endedAt as number | null) ?? null,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
    eventCount: Number(row.eventCount ?? 0),
    tokenCountPrompt: Number(row.tokenPrompt ?? 0),
    tokenCountCompletion: Number(row.tokenCompletion ?? 0),
    metadataJson: (row.metadataJson as string | null) ?? null
  }))
}

export function listClaudeMemoryEvents(
  db: Database.Database,
  sessionId: string,
  opts: { limit?: number; offset?: number } = {}
): ClaudeMemoryEventRecord[] {
  const id = sessionId.trim()
  if (!id) return []
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 300))
  const offset = Math.max(0, opts.offset ?? 0)
  const rows = db
    .prepare(
      `SELECT event_id as eventId, session_id as sessionId, turn_id as turnId, sequence, event_type as eventType,
              timestamp, project_path as projectPath, model, tool_name as toolName, source_client_version as sourceClientVersion,
              token_prompt as tokenPrompt, token_completion as tokenCompletion, payload_json as payloadJson, received_at as receivedAt
       FROM claude_memory_events
       WHERE session_id = ?
       ORDER BY sequence ASC, timestamp ASC
       LIMIT ? OFFSET ?`
    )
    .all(id, limit, offset) as Array<Record<string, unknown>>
  return rows.map((row) => {
    let payload: Record<string, unknown> = {}
    const payloadJson = typeof row.payloadJson === 'string' ? row.payloadJson : '{}'
    try {
      payload = normalizeJsonObject(JSON.parse(payloadJson))
    } catch {
      payload = {}
    }
    return {
      eventId: String(row.eventId),
      sessionId: String(row.sessionId),
      turnId: (row.turnId as string | null) ?? undefined,
      sequence: Number(row.sequence ?? 0),
      eventType: String(row.eventType) as ClaudeMemoryEventRecord['eventType'],
      timestamp: Number(row.timestamp ?? 0),
      projectPath: (row.projectPath as string | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
      toolName: (row.toolName as string | null) ?? undefined,
      tokenUsage: {
        ...(typeof row.tokenPrompt === 'number' ? { promptTokens: row.tokenPrompt } : {}),
        ...(typeof row.tokenCompletion === 'number' ? { completionTokens: row.tokenCompletion } : {})
      },
      sourceClientVersion: (row.sourceClientVersion as string | null) ?? undefined,
      payload,
      payloadJson,
      receivedAt: Number(row.receivedAt ?? 0)
    }
  })
}

export function getClaudeMemoryCaptureStats(db: Database.Database): ClaudeMemoryCaptureStats {
  const sessions = db.prepare('SELECT COUNT(*) as c FROM claude_memory_sessions').get() as { c: number } | undefined
  const events = db.prepare('SELECT COUNT(*) as c FROM claude_memory_events').get() as { c: number } | undefined
  const rag = db.prepare('SELECT COUNT(*) as c FROM claude_memory_rag_units').get() as { c: number } | undefined
  const dead = db.prepare('SELECT COUNT(*) as c FROM claude_memory_dead_letters').get() as { c: number } | undefined
  const bytes = db
    .prepare(
      `SELECT
          COALESCE(SUM(LENGTH(payload_json)), 0) + COALESCE(SUM(LENGTH(COALESCE(metadata_json, ''))), 0) as bytesApprox
       FROM (
         SELECT payload_json, NULL as metadata_json FROM claude_memory_events
         UNION ALL
         SELECT '' as payload_json, metadata_json FROM claude_memory_sessions
       )`
    )
    .get() as { bytesApprox: number } | undefined
  const last = db
    .prepare('SELECT MAX(updated_at) as t FROM claude_memory_sessions')
    .get() as { t: number | null } | undefined
  return {
    sessions: Number(sessions?.c ?? 0),
    events: Number(events?.c ?? 0),
    ragUnits: Number(rag?.c ?? 0),
    deadLetters: Number(dead?.c ?? 0),
    bytesApprox: Number(bytes?.bytesApprox ?? 0),
    lastIngestAt: typeof last?.t === 'number' ? last.t : undefined
  }
}

export function exportClaudeMemorySessionsToTrainingJsonl(
  db: Database.Database,
  sessionIds: string[],
  destPath: string
): { linesWritten: number; sessionsUsed: string[] } {
  const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) throw new Error('Select at least one memory session.')
  mkdirSync(dirname(destPath), { recursive: true })
  const lines: string[] = []
  const sessionsUsed: string[] = []
  for (const sessionId of ids) {
    const events = listClaudeMemoryEvents(db, sessionId, { limit: 5000, offset: 0 })
    if (events.length === 0) continue
    sessionsUsed.push(sessionId)
    const turns = new Map<
      string,
      {
        user?: string
        assistant?: string
        model?: string
      }
    >()
    for (const event of events) {
      const turnId = event.turnId?.trim() || `seq-${Math.floor(event.sequence / 2)}`
      if (!turns.has(turnId)) turns.set(turnId, {})
      const row = turns.get(turnId)!
      const text = extractMemoryText(event).slice(0, 12000)
      if (event.eventType === 'user_message') row.user = text
      if (event.eventType === 'assistant_message') {
        row.assistant = text
        row.model = event.model
      }
    }
    for (const [turnId, turn] of turns.entries()) {
      if (!turn.user || !turn.assistant) continue
      lines.push(
        JSON.stringify({
          instruction: turn.user,
          context: `Claude Code memory session ${sessionId}`,
          input: '',
          output: turn.assistant,
          rationale: 'Captured from local interaction memory.',
          provenance: {
            source: 'claude-memory',
            sessionId,
            turnId,
            model: turn.model ?? null
          }
        })
      )
    }
  }
  if (lines.length === 0) {
    throw new Error('No usable user/assistant pairs were found in selected sessions.')
  }
  writeFileSync(destPath, `${lines.join('\n')}\n`, 'utf8')
  return { linesWritten: lines.length, sessionsUsed }
}

export function pruneClaudeMemoryByAge(db: Database.Database, retentionDays: number): number {
  const days = Math.floor(retentionDays)
  if (!Number.isFinite(days) || days <= 0) return 0
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const res = db
    .prepare(
      `DELETE FROM claude_memory_sessions
       WHERE COALESCE(ended_at, updated_at, started_at) < ?`
    )
    .run(cutoff)
  return res.changes
}

