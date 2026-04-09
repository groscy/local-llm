import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { ConversationRow, MessageAppendUsage, MessageRow } from '@shared/types'

export function listConversations(db: Database.Database): ConversationRow[] {
  return db
    .prepare('SELECT id, title, created_at as createdAt, updated_at as updatedAt FROM conversations ORDER BY updated_at DESC')
    .all() as ConversationRow[]
}

export function createConversation(db: Database.Database, title: string): ConversationRow {
  const id = randomUUID()
  const t = Date.now()
  db.prepare(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, title || 'New chat', t, t)
  return { id, title: title || 'New chat', createdAt: t, updatedAt: t }
}

function rowToMessageRow(raw: Record<string, unknown>): MessageRow {
  const pte = raw.prompt_tokens_estimated
  const cte = raw.completion_tokens_estimated
  return {
    id: String(raw.id),
    conversationId: String(raw.conversationId),
    role: raw.role as MessageRow['role'],
    content: String(raw.content),
    createdAt: Number(raw.createdAt),
    modelId: raw.modelId != null ? String(raw.modelId) : undefined,
    promptTokens: typeof raw.prompt_tokens === 'number' ? raw.prompt_tokens : null,
    completionTokens: typeof raw.completion_tokens === 'number' ? raw.completion_tokens : null,
    promptTokensIsEstimate: pte === 1 ? true : pte === 0 ? false : undefined,
    completionTokensIsEstimate: cte === 1 ? true : cte === 0 ? false : undefined
  }
}

export function listMessages(db: Database.Database, conversationId: string): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT id, conversation_id as conversationId, role, content, model_id as modelId, created_at as createdAt,
              prompt_tokens, completion_tokens, prompt_tokens_estimated, completion_tokens_estimated
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as Record<string, unknown>[]
  return rows.map(rowToMessageRow)
}

export function deleteConversation(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function renameConversation(
  db: Database.Database,
  id: string,
  title: string
): ConversationRow | undefined {
  const row = db
    .prepare('SELECT id, title, created_at as createdAt, updated_at as updatedAt FROM conversations WHERE id = ?')
    .get(id) as ConversationRow | undefined
  if (!row) return undefined
  const nextTitle = title.trim() || 'New chat'
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(nextTitle, id)
  return { ...row, title: nextTitle }
}

export function appendMessage(
  db: Database.Database,
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  modelId?: string,
  usage?: MessageAppendUsage
): MessageRow {
  const id = randomUUID()
  const t = Date.now()
  let completionTokens: number | null = null
  let completionTokensEstimated: number | null = null
  if (role === 'assistant' && usage?.completionTokens != null && Number.isFinite(usage.completionTokens)) {
    completionTokens = Math.max(0, Math.round(usage.completionTokens))
    completionTokensEstimated = usage.completionIsEstimate ? 1 : 0
  }
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, model_id, created_at,
      prompt_tokens, completion_tokens, prompt_tokens_estimated, completion_tokens_estimated)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`
  ).run(id, conversationId, role, content, modelId ?? null, t, completionTokens, completionTokensEstimated)
  if (
    role === 'assistant' &&
    usage?.promptTokens != null &&
    Number.isFinite(usage.promptTokens)
  ) {
    const pt = Math.max(0, Math.round(usage.promptTokens))
    const pEst = usage.promptIsEstimate ? 1 : 0
    db.prepare(
      `UPDATE messages SET prompt_tokens = ?, prompt_tokens_estimated = ?
       WHERE id = (
         SELECT id FROM messages WHERE conversation_id = ? AND role = 'user'
         ORDER BY created_at DESC LIMIT 1
       )`
    ).run(pt, pEst, conversationId)
  }
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, conversationId)
  const row: MessageRow = {
    id,
    conversationId,
    role,
    content,
    createdAt: t,
    modelId,
    promptTokens: null,
    completionTokens,
    completionTokensIsEstimate:
      completionTokensEstimated === null ? undefined : completionTokensEstimated === 1
  }
  return row
}
