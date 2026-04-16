import type Store from 'electron-store'

/** Default keys written on first launch and after “factory reset”. */
export const ELECTRON_STORE_DEFAULTS: Record<string, unknown> = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  llamaPort: 8080,
  /** Passed to llama-server `-c` (prompt + generation must fit; long chat / RAG needs more). */
  llamaContextTokens: 32_768,
  metricsPinned: false,
  metricsRefreshMs: 3000,
  downloadsPinned: false,
  activityPinned: false,
  issuesPinned: false,
  pinnedWidgetsSide: 'left',
  pinnedWidgetsWidthPx: 308,
  pinnedWidgetsHeightPx: 360,
  /** Relative flex weights for metrics / downloads / activity when multiple pinned widgets are stacked. */
  pinnedWidgetWeights: { metrics: 1, downloads: 1, activity: 1, issues: 1 },
  colorScheme: 'violet',
  /** Upper bound on assistant completion length (Ollama `num_predict`; llama.cpp default unless `llamaChatMaxTokens` is set). */
  chatMaxTokens: 4096,
  /** Max prior user+assistant messages included in the API history (newest retained). */
  chatHistoryMaxMessages: 80,
  /** When true and a user message matched prompt domains with a non-empty system suffix, append that text to the system message (bounded on the server). */
  chatDomainEnhancement: false,
  /** llama.cpp: ask the model to cite RAG snippet numbers [1], [2]; UI may warn if citations are missing. */
  llamaRagGrounding: false,
  /** llama-server `/v1/chat/completions` sampling (OpenAI-style). */
  llamaTemperature: 0.8,
  llamaTopP: 0.95,
  llamaFrequencyPenalty: 0,
  llamaPresencePenalty: 0,
  /** After each assistant reply, run a brief second pass to extract bullet notes into the knowledge base / wiki. */
  wikiAutoExtract: true,
  /** Localhost HTTP API for IDE plugins (127.0.0.1 only). */
  integrationListenEnabled: false,
  integrationPort: 17373,
  integrationToken: '',
  agenticWorkersEnabled: false,
  /** Self-hosted Ollama only (second machine you run); not third-party LLM APIs */
  agentRemoteOllamaUrl: ''
}

export function resetElectronStoreToFactory(store: Store<Record<string, unknown>>): void {
  store.clear()
  for (const [k, v] of Object.entries(ELECTRON_STORE_DEFAULTS)) {
    store.set(k, v)
  }
}

/**
 * Legacy store cleanup and defaults. Call when the app starts.
 */
export function migrateChatProfileSettings(store: Store<Record<string, unknown>>): void {
  if (store.has('chatLlamaMinimalSystem')) {
    store.delete('chatLlamaMinimalSystem')
  }
  if (store.has('chatModelProfileInReplies')) {
    store.delete('chatModelProfileInReplies')
  }
  if (typeof store.get('chatDomainEnhancement') !== 'boolean') {
    store.set('chatDomainEnhancement', false)
  }
}
