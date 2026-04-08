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
  colorScheme: 'violet'
}

export function resetElectronStoreToFactory(store: Store<Record<string, unknown>>): void {
  store.clear()
  for (const [k, v] of Object.entries(ELECTRON_STORE_DEFAULTS)) {
    store.set(k, v)
  }
}
