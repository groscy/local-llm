import { existsSync } from 'fs'
import { ipcMain } from 'electron'
import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import { IPC } from '@shared/ipc'
import type { RuntimeAdapter } from '../services/runtime'
import { fetchOllamaModelTags, probeOllamaReachable } from '../services/runtime/ollamaAdapter'
import { resolveLlamaBinary, validateLlamaServerBinary } from '../services/llamaDetect'
import * as metricsService from '../services/metricsService'

type RuntimeDeps = {
  store: Store<Record<string, unknown>>
  db: Database.Database
  getRuntime: () => RuntimeAdapter | null
}

type RuntimeInstallFastStatus = {
  llamaBinary: string
  ollamaBase: string
  llamaResolvedPath: string
  llamaDetected: boolean
  llamaConfiguredPathValid: boolean
  llamaBinaryValid: boolean
  llamaValidateError: string | null
  ollamaReachable: boolean
}

const FAST_RUNTIME_TTL_MS = 10_000
let cachedFastRuntimeInstall: { at: number; value: RuntimeInstallFastStatus } | null = null

async function computeFastRuntimeInstallStatus(
  store: Store<Record<string, unknown>>
): Promise<RuntimeInstallFastStatus> {
  const configured = (store.get('llamaBinaryPath') as string | undefined) ?? ''
  const trimmed = configured.trim()
  const configuredValid = Boolean(trimmed && existsSync(trimmed))
  const resolved = resolveLlamaBinary(trimmed || undefined)
  const ollamaBase = (store.get('ollamaBaseUrl') as string | undefined) ?? 'http://127.0.0.1:11434'
  const ollamaReachable = await probeOllamaReachable(ollamaBase)
  let llamaBinaryValid = false
  let llamaValidateError: string | null = null
  if (resolved) {
    const validation = await validateLlamaServerBinary(resolved)
    llamaBinaryValid = validation.ok
    llamaValidateError = validation.ok ? null : validation.error
  }
  return {
    llamaBinary: configured,
    ollamaBase,
    llamaResolvedPath: resolved ?? '',
    llamaDetected: Boolean(resolved),
    llamaConfiguredPathValid: configuredValid,
    llamaBinaryValid,
    llamaValidateError,
    ollamaReachable
  }
}

export function registerRuntimeMetricsIpc(deps: RuntimeDeps): void {
  const { store, db, getRuntime } = deps

  // RuntimeProbeClass: fast_status — reads cached runtime state; never calls GPU or disk probes.
  ipcMain.handle(IPC.RUNTIME_STATUS_FAST, () => getRuntime()?.getStatus() ?? { running: false, kind: 'none' as const })

  // RuntimeProbeClass: normal_status — runs install-path probes but caches results for FAST_RUNTIME_TTL_MS (10 s).
  ipcMain.handle(IPC.RUNTIME_INSTALL_PATH_FAST, async () => {
    const now = Date.now()
    if (cachedFastRuntimeInstall && now - cachedFastRuntimeInstall.at < FAST_RUNTIME_TTL_MS) {
      return cachedFastRuntimeInstall.value
    }
    const value = await computeFastRuntimeInstallStatus(store)
    cachedFastRuntimeInstall = { at: now, value }
    return value
  })

  // RuntimeProbeClass: normal_status — makes an outbound HTTP request to the Ollama daemon; avoid on hot paths.
  ipcMain.handle(IPC.RUNTIME_OLLAMA_TAGS, async () => {
    const raw = (store.get('ollamaBaseUrl') as string | undefined)?.trim()
    const ollamaBase = raw || 'http://127.0.0.1:11434'
    return fetchOllamaModelTags(ollamaBase)
  })

  // RuntimeProbeClass: fast_status — returns last cached metrics snapshot; does not trigger a new collection cycle.
  ipcMain.handle(IPC.METRICS_SNAPSHOT_FAST, async (_e, opts?: { persist?: boolean }) => {
    return metricsService.snapshotWithCache(db, getRuntime(), opts)
  })
}
