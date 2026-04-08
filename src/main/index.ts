import { app, BrowserWindow, shell, safeStorage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import Database from 'better-sqlite3'
import { openDatabase, dbPathForUserData } from './db'
import { initLogger, logLine } from './logger'
import { registerIpc, type IpcContext } from './ipc/registerIpc'
import type { RuntimeAdapter } from './services/runtime/types'
import { ELECTRON_STORE_DEFAULTS } from './storeDefaults'

const store = new Store<Record<string, unknown>>({
  defaults: { ...ELECTRON_STORE_DEFAULTS }
})

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null
let runtimeAdapter: RuntimeAdapter | null = null
let hfTokenMem: string | undefined

function loadHfTokenFromStore(): void {
  const enc = store.get('hfTokenEncrypted') as string | undefined
  if (!enc) {
    hfTokenMem = undefined
    return
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(enc, 'base64')
      hfTokenMem = safeStorage.decryptString(buf)
    } else {
      hfTokenMem = enc
    }
  } catch {
    hfTokenMem = enc
  }
}

function windowIconPath(): string | undefined {
  if (is.dev) {
    const dev = join(process.cwd(), 'src/renderer/public/app-icon.png')
    if (existsSync(dev)) return dev
    return undefined
  }
  const prod = join(__dirname, '../renderer/app-icon.png')
  if (existsSync(prod)) return prod
  return undefined
}

function createWindow(): void {
  const icon = windowIconPath()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    // DevTools triggers harmless CDP noise (e.g. Autofill.setAddresses). Set DISABLE_DEVTOOLS=1 to skip.
    if (process.env.DISABLE_DEVTOOLS !== '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getRuntime(): RuntimeAdapter | null {
  return runtimeAdapter
}

function setRuntime(r: RuntimeAdapter | null): void {
  runtimeAdapter = r
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.localllm.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const userData = app.getPath('userData')
  const logsDir = join(userData, 'logs')
  initLogger(logsDir)
  loadHfTokenFromStore()

  const dbPath = dbPathForUserData(userData)
  db = openDatabase(dbPath)
  logLine('info', 'db_opened', { dbPath })

  const ctx: IpcContext = {
    db,
    store: store as IpcContext['store'],
    userData,
    getHfToken: () => hfTokenMem,
    setHfToken: (t) => {
      hfTokenMem = t
    },
    getRuntime,
    setRuntime
  }
  registerIpc(ctx)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    runtimeAdapter = null
    db?.close()
    app.quit()
  }
})
