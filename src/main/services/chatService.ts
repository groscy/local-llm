import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { ConversationRow, MessageRow } from '@shared/types'

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

export function listMessages(db: Database.Database, conversationId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT id, conversation_id as conversationId, role, content, model_id as modelId, created_at as createdAt
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as MessageRow[]
}

export function deleteConversation(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function appendMessage(
  db: Database.Database,
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  modelId?: string
): MessageRow {
  const id = randomUUID()
  const t = Date.now()
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, role, content, modelId ?? null, t)
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(t, conversationId)
  return { id, conversationId, role, content, createdAt: t, modelId }
}
