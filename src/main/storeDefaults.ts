import type Store from 'electron-store'

/** Default keys written on first launch and after “factory reset”. */
export const ELECTRON_STORE_DEFAULTS: Record<string, unknown> = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  llamaPort: 8080,
  metricsPinned: false,
  metricsRefreshMs: 3000,
  downloadsPinned: false,
  activityPinned: false,
  pinnedWidgetsSide: 'left',
  pinnedWidgetsWidthPx: 308,
  pinnedWidgetsHeightPx: 360,
  colorScheme: 'violet',
  /** Upper bound on assistant completion length (Ollama `num_predict`, llama.cpp `max_tokens`). */
  chatMaxTokens: 512,
  /** After each assistant reply, run a brief second pass to extract bullet notes into the knowledge base / wiki. */
  wikiAutoExtract: true,
  /** Localhost HTTP API for IDE plugins (127.0.0.1 only). */
  integrationListenEnabled: false,
  integrationPort: 17373,
  integrationToken: ''
}

export function resetElectronStoreToFactory(store: Store<Record<string, unknown>>): void {
  store.clear()
  for (const [k, v] of Object.entries(ELECTRON_STORE_DEFAULTS)) {
    store.set(k, v)
  }
}
