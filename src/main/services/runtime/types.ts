import type { RuntimeStatus } from '@shared/types'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface RuntimeAdapter {
  readonly kind: 'llamacpp' | 'ollama'

  start(opts: { modelPath: string; binaryPath?: string; port?: number }): Promise<void>
  stop(): Promise<void>
  getStatus(): RuntimeStatus
  chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string>
  /** Optional: probe health / metrics from server */
  fetchMetrics?(): Promise<{ tokensPerSec?: number; ctxUsed?: number }>
}
