import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { PluginIntegrationReport } from '@shared/types'
import { logLine } from '../logger'

const MAX_HISTORY = 50
const history: PluginIntegrationReport[] = []

/**
 * Stores IDE plugin reports and pushes them to all open renderer windows.
 */
export function appendPluginReport(entry: Omit<PluginIntegrationReport, 'receivedAt'>): void {
  const full: PluginIntegrationReport = { ...entry, receivedAt: Date.now() }
  history.push(full)
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY)
  }
  logLine('info', 'integration_plugin_report', {
    source: full.source,
    kind: full.kind,
    hasMessage: Boolean(full.message)
  })
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.INTEGRATION_PLUGIN_REPORT, full)
    }
  }
}

export function getPluginReportHistory(): PluginIntegrationReport[] {
  return [...history]
}
