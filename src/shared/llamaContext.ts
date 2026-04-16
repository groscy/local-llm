/** llama-server `-c` (context / KV cache tokens). */

export const LLAMA_CONTEXT_TOKENS_MIN = 2048

/** Enough for long chats + RAG on typical GPUs; increase in Settings if needed. */
export const LLAMA_CONTEXT_TOKENS_DEFAULT = 32_768

export const LLAMA_CONTEXT_TOKENS_MAX = 262_144

export function clampLlamaContextTokens(n: number): number {
  if (!Number.isFinite(n)) return LLAMA_CONTEXT_TOKENS_DEFAULT
  return Math.min(LLAMA_CONTEXT_TOKENS_MAX, Math.max(LLAMA_CONTEXT_TOKENS_MIN, Math.floor(n)))
}
