import type { RuntimeLoadProgress, RuntimeStatus } from '@shared/types'

export type { RuntimeLoadProgress }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface RuntimeAdapter {
  readonly kind: 'llamacpp' | 'ollama'

  start(opts: {
    modelPath: string
    /** llama.cpp only: status / UI path when `-m` points at a different cached file (e.g. converted GGUF). */
    displayModelPath?: string
    binaryPath?: string
    port?: number
    onLoadProgress?: (e: RuntimeLoadProgress) => void
  }): Promise<void>
  stop(): Promise<void>
  getStatus(): RuntimeStatus
  chat(
    messages: ChatMessage[],
    opts?: {
      maxTokens?: number
      onStreamChunk?: (text: string) => void
      /** Fired when the backend reports final token counts (streaming end). */
      onStreamUsage?: (u: { promptTokens?: number; completionTokens?: number }) => void
    }
  ): Promise<string>
  /** Optional: probe health / metrics from server */
  fetchMetrics?(): Promise<{
    tokensPerSec?: number
    ctxUsed?: number
    /** Loaded model footprint (llama child resident set or Ollama-reported size), MiB */
    modelMemoryMb?: number
  }>
}
