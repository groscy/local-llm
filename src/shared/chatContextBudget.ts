const DEFAULT_CHAT_HISTORY_MAX = 80

/** Max prior user+assistant messages from settings (renderer reads config). */
export function chatHistoryMaxMessagesFromConfig(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 2) {
    return Math.min(500, Math.floor(raw))
  }
  return DEFAULT_CHAT_HISTORY_MAX
}

/** Rough token estimate (chars / 4) for UI warnings and history budgeting. */
export function estimatePromptTokensFromChars(charCount: number): number {
  return Math.max(1, Math.ceil(charCount / 4))
}

export function sliceChatHistoryMessages<T extends { role: string; content: string }>(
  history: T[],
  maxMessages: number
): T[] {
  if (history.length <= maxMessages) return history
  return history.slice(-maxMessages)
}

/** True when estimated prompt tokens exceed `warnRatio` of context window. */
export function promptLikelyExceedsContext(params: {
  estimatedPromptTokens: number
  contextTokens: number
  warnRatio?: number
}): boolean {
  const { estimatedPromptTokens, contextTokens } = params
  const warnRatio = params.warnRatio ?? 0.88
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return false
  return estimatedPromptTokens > contextTokens * warnRatio
}

/** Heuristic: reply should mention [n] when multiple RAG snippets were supplied. */
export function ragReplyMissingSnippetCitations(reply: string, snippetCount: number): boolean {
  if (snippetCount <= 0) return false
  return !/\[\d+\]/.test(reply)
}
