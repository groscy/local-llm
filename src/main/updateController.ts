import { app, BrowserWindow, dialog } from 'electron'
// electron-updater is CJS; named ESM import breaks in packaged Electron (Node ESM loader).
import electronUpdater from 'electron-updater'
import { is } from '@electron-toolkit/utils'

const { autoUpdater } = electronUpdater
import { IPC } from '@shared/ipc'
import type { AppUpdateStatusPayload } from '@shared/appUpdate'

function broadcast(payload: AppUpdateStatusPayload): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send(IPC.APP_UPDATE_STATUS, payload)
    }
  }
}

function parentWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  const first = BrowserWindow.getAllWindows()[0]
  return first && !first.isDestroyed() ? first : undefined
}

let listenersRegistered = false
let backgroundCheckScheduled = false

function registerAutoUpdaterListeners(): void {
  if (listenersRegistered) return
  listenersRegistered = true

  autoUpdater.autoDownload = true
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    broadcast({ phase: 'checking' })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({ phase: 'not_available', currentVersion: app.getVersion() })
  })

  autoUpdater.on('update-available', (info) => {
    broadcast({
      phase: 'available',
      version: info.version,
      releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : undefined
    })
  })

  autoUpdater.on('download-progress', (p) => {
    broadcast({
      phase: 'downloading',
      percent: p.percent,
      transferred: p.transferred,
      total: p.total
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    broadcast({ phase: 'downloaded', version: info.version })
    const parent = parentWindow()
    const opts = {
      type: 'info' as const,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Local LLM Desktop ${info.version} is ready to install.`,
      detail: 'Restart the application to finish updating.'
    }
    const r = parent
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts)
    if (r.response === 0) {
      autoUpdater.quitAndInstall(false, true)
    }
  })

  autoUpdater.on('error', (err) => {
    broadcast({
      phase: 'error',
      message: err.message || String(err)
    })
  })
}

/** Call once after `app.whenReady()` for packaged release builds. */
export function initAppUpdater(): void {
  if (!app.isPackaged || is.dev) {
    return
  }
  registerAutoUpdaterListeners()
  if (!backgroundCheckScheduled) {
    backgroundCheckScheduled = true
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch((e) => {
        broadcast({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    }, 5000)
  }
}

export async function manualCheckForUpdates(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged || is.dev) {
    return { ok: false, error: 'Updates are only available in installed release builds.' }
  }
  registerAutoUpdaterListeners()
  try {
    broadcast({ phase: 'checking' })
    await autoUpdater.checkForUpdates()
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    broadcast({ phase: 'error', message })
    return { ok: false, error: message }
  }
}
