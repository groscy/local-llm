import type Store from 'electron-store'

/** Matches renderer `CHAT_MAX_TOKENS_MAX` and IPC zod schema. */
export const CHAT_MAX_COMPLETION_TOKENS_HARD_MAX = 262_144

/** Used when store has no `chatMaxTokens` (new profile paths); keep aligned with storeDefaults. */
export const CHAT_MAX_COMPLETION_TOKENS_FALLBACK = 4096

export function clampChatMaxCompletionTokens(n: number): number {
  if (!Number.isFinite(n)) return CHAT_MAX_COMPLETION_TOKENS_FALLBACK
  return Math.min(CHAT_MAX_COMPLETION_TOKENS_HARD_MAX, Math.max(1, Math.floor(n)))
}

export function chatMaxCompletionTokensFromStore(store: Store<Record<string, unknown>>): number {
  const rawMax = store.get('chatMaxTokens')
  if (typeof rawMax === 'number' && Number.isFinite(rawMax)) {
    return clampChatMaxCompletionTokens(rawMax)
  }
  return CHAT_MAX_COMPLETION_TOKENS_FALLBACK
}

/** llama.cpp: optional `llamaChatMaxTokens`, else same as global `chatMaxTokens`. */
export function llamaChatMaxCompletionTokensFromStore(store: Store<Record<string, unknown>>): number {
  const raw = store.get('llamaChatMaxTokens')
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampChatMaxCompletionTokens(raw)
  }
  return chatMaxCompletionTokensFromStore(store)
}

/**
 * Effective completion cap: explicit `maxTokens` wins; otherwise store — for llama.cpp uses
 * `llamaChatMaxTokens` when set, else `chatMaxTokens`; for Ollama uses `chatMaxTokens` only.
 */
export function resolveChatMaxCompletionTokens(
  store: Store<Record<string, unknown>>,
  override?: number,
  runtimeKind?: 'ollama' | 'llamacpp'
): number {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return clampChatMaxCompletionTokens(override)
  }
  if (runtimeKind === 'llamacpp') {
    return llamaChatMaxCompletionTokensFromStore(store)
  }
  return chatMaxCompletionTokensFromStore(store)
}
