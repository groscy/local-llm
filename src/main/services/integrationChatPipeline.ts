import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import type { ChatMessage, RuntimeAdapter } from './runtime/types'
import { buildOntologyContext } from './ontologyContextBuilder'
import type { OntologyService } from './ontologyService'
import { llamaSamplingFromStore } from './llamaChatOptions'
import { resolveChatMaxCompletionTokens } from './chatMaxTokens'
import { recordChatRoundtripMs } from './chatLatencyStats'
import { retrieveChunks } from './retrievalService'

export interface IntegrationPipelineUsage {
  promptTokens?: number
  completionTokens?: number
}

export interface IntegrationPipelineProgress {
  onToken?: (text: string) => void
}

export interface IntegrationPipelineResult {
  reply: string
  runtimeMessages: ChatMessage[]
  usage: IntegrationPipelineUsage
  responsePreview: string
}

export function preprocessIntegrationMessages(args: {
  store: Store<Record<string, unknown>>
  db?: Database.Database | null
  ontology: OntologyService | null
  messages: ChatMessage[]
}): ChatMessage[] {
  const { store, db, ontology, messages } = args
  const ontologyEnabled = store.get('ontologyEnabled') !== false
  if (!ontologyEnabled || !ontology) return messages
  const ontologyMaxTriples =
    typeof store.get('ontologyMaxTriples') === 'number' ? Number(store.get('ontologyMaxTriples')) : undefined
  const ontologyContextTokens =
    typeof store.get('ontologyContextTokens') === 'number' ? Number(store.get('ontologyContextTokens')) : undefined
  const built = buildOntologyContext(ontology, {
    messages,
    maxTriples: ontologyMaxTriples,
    maxTokens: ontologyContextTokens
  })
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim())
  const retrievalContext =
    db && lastUser?.content?.trim()
      ? (() => {
          const hits = retrieveChunks(db, { query: lastUser.content.trim(), limit: 5 })
          if (hits.length === 0) return ''
          return [
            '--- Retrieved knowledge context ---',
            ...hits.map((hit, idx) => `[${idx + 1}] ${hit.sourceTitle}: ${hit.snippet}`)
          ].join('\n')
        })()
      : ''
  const composedContext = [built.context, retrievalContext].filter(Boolean).join('\n\n')
  if (!composedContext) return messages
  const next = [...messages]
  const firstSystem = next.findIndex((m) => m.role === 'system')
  if (firstSystem >= 0) {
    const row = next[firstSystem]
    if (row) row.content = `${row.content}\n\n${composedContext}`
    return next
  }
  return [{ role: 'system' as const, content: composedContext }, ...next]
}

export function ingestOntologyBestEffort(args: {
  ontology: OntologyService | null
  text: string
  sourceType: string
  sourceRef: string
  confidence: number
  entityType: string
}): void {
  const { ontology, text, sourceType, sourceRef, confidence, entityType } = args
  if (!ontology || !text.trim()) return
  try {
    ontology.ingestText({
      text,
      sourceType,
      sourceRef,
      confidence,
      entityType
    })
  } catch {
    /* ontology is best-effort */
  }
}

export async function runIntegrationChatPipeline(args: {
  store: Store<Record<string, unknown>>
  db?: Database.Database | null
  runtime: RuntimeAdapter
  ontology: OntologyService | null
  messages: ChatMessage[]
  maxTokensOverride?: number
  ollamaModel?: string
  ollamaBaseUrl?: string
  ontologySourcePrefix?: string
  progress?: IntegrationPipelineProgress
}): Promise<IntegrationPipelineResult> {
  const {
    store,
    db,
    runtime,
    ontology,
    messages,
    maxTokensOverride,
    ollamaModel,
    ollamaBaseUrl,
    ontologySourcePrefix,
    progress
  } = args
  const runtimeMessages = preprocessIntegrationMessages({ store, db, ontology, messages })
  const status = runtime.getStatus()
  const maxTokens = resolveChatMaxCompletionTokens(
    store,
    maxTokensOverride,
    status.kind === 'llamacpp' ? 'llamacpp' : status.kind === 'ollama' ? 'ollama' : undefined
  )
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && m.content.trim().length > 0)
  if (lastUser) {
    ingestOntologyBestEffort({
      ontology,
      text: lastUser.content,
      sourceType: 'integration_chat_user',
      sourceRef: `${ontologySourcePrefix ?? 'integration-chat'}:user:${Date.now()}`,
      confidence: 0.7,
      entityType: 'user_input'
    })
  }
  const usage: IntegrationPipelineUsage = {}
  const chatStarted = Date.now()
  let streamedText = ''
  const samplingOpts =
    status.kind === 'llamacpp'
      ? (() => {
          const s = llamaSamplingFromStore(store)
          return {
            temperature: s.temperature,
            topP: s.topP,
            frequencyPenalty: s.frequencyPenalty,
            presencePenalty: s.presencePenalty
          }
        })()
      : {}
  const reply = await runtime.chat(runtimeMessages, {
    maxTokens,
    ...(ollamaModel ? { ollamaModel } : {}),
    ...(ollamaBaseUrl ? { ollamaBaseUrl } : {}),
    ...samplingOpts,
    onStreamChunk: (text) => {
      if (!text) return
      streamedText += text
      progress?.onToken?.(text)
    },
    onStreamUsage: (u) => {
      if (typeof u.promptTokens === 'number') usage.promptTokens = u.promptTokens
      if (typeof u.completionTokens === 'number') usage.completionTokens = u.completionTokens
    }
  })
  recordChatRoundtripMs(Date.now() - chatStarted)
  ingestOntologyBestEffort({
    ontology,
    text: reply,
    sourceType: 'integration_chat_assistant',
    sourceRef: `${ontologySourcePrefix ?? 'integration-chat'}:assistant:${Date.now()}`,
    confidence: 0.62,
    entityType: 'assistant_output'
  })
  return {
    reply,
    runtimeMessages,
    usage,
    responsePreview: (streamedText || reply).slice(0, 20_000)
  }
}
