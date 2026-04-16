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
    /**
     * llama.cpp only: `-n` default on the server when a client omits `max_tokens`.
     * The desktop app still sends an explicit `max_tokens` on every `/v1/chat/completions` call from settings.
     */
    defaultPredictTokens?: number
    /** llama.cpp only: `-c` context size (prompt + generated tokens must fit). */
    contextTokens?: number
    onLoadProgress?: (e: RuntimeLoadProgress) => void
  }): Promise<void>
  stop(): Promise<void>
  getStatus(): RuntimeStatus
  chat(
    messages: ChatMessage[],
    opts?: {
      /** Max new tokens to generate (Ollama `num_predict`, llama.cpp OpenAI `max_tokens`). All runtimes. */
      maxTokens?: number
      onStreamChunk?: (text: string) => void
      /** Fired when the backend reports final token counts (streaming end). */
      onStreamUsage?: (u: { promptTokens?: number; completionTokens?: number }) => void
      /** Ollama only: per-request model tag (parallel multi-model workers). */
      ollamaModel?: string
      /** Ollama only: alternate daemon URL for this request only (e.g. remote GPU). */
      ollamaBaseUrl?: string
      /** Skip built-in stop strings that cut off simulated “user” continuations. */
      skipDefaultAntiSelfPromptStops?: boolean
      /** Extra `stop` strings merged after defaults (unless skips are disabled). */
      extraStopSequences?: string[]
      /** llama-server OpenAI API; Ollama maps into `options` when set. */
      temperature?: number
      topP?: number
      frequencyPenalty?: number
      presencePenalty?: number
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
