import { spawn } from 'node:child_process'
import { chmodSync, createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { logLine } from '../logger'
import { probeOllamaReachable } from './runtime/ollamaAdapter'

const UA = 'LocalLLMDesktop/1.0 (Ollama installer helper)'

/** Official first-party scripts and fallbacks. */
const URLS = {
  installPs1: 'https://ollama.com/install.ps1',
  installSh: 'https://ollama.com/install.sh',
  home: 'https://ollama.com/download'
} as const

export type OllamaInstallResult =
  | { ok: true; detail?: string }
  | { ok: false; error: string }
  | { ok: true; needsManualFinish: true; hint: string }

export type OllamaInstallProgressFn = (message: string) => void

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function safeProgress(onProgress: OllamaInstallProgressFn | undefined, message: string): void {
  if (!onProgress) return
  try {
    onProgress(message)
  } catch {
    /* ignore */
  }
}

/** Split stream into lines for UI (handles \n; trims \r). */
function createLineBuffer(onLine: (line: string) => void): {
  push: (chunk: Buffer) => void
  flush: () => void
} {
  let carry = ''
  return {
    push(chunk: Buffer): void {
      carry += chunk.toString('utf8')
      while (true) {
        const n = carry.indexOf('\n')
        if (n < 0) break
        let line = carry.slice(0, n)
        carry = carry.slice(n + 1)
        line = line.replace(/\r/g, '').trim()
        if (line) onLine(line)
      }
      if (carry.length > 64_000) carry = carry.slice(-32_000)
    },
    flush(): void {
      const t = carry.replace(/\r/g, ' ').trim()
      if (t) onLine(t)
      carry = ''
    }
  }
}

/** Hosts Ollama download URLs may redirect to (e.g. GitHub release assets). */
function allowedDownloadHost(hostname: string): boolean {
  if (hostname === 'ollama.com' || hostname.endsWith('.ollama.com')) return true
  if (hostname === 'github.com') return true
  if (hostname === 'objects.githubusercontent.com') return true
  if (hostname === 'release-assets.githubusercontent.com') return true
  if (hostname === 'codeload.github.com') return true
  return false
}

async function downloadToFile(urlStr: string, destPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const follow = (href: string, depth: number): void => {
      if (depth > 14) {
        reject(new Error('Too many redirects'))
        return
      }
      let u: URL
      try {
        u = new URL(href)
      } catch {
        reject(new Error('Invalid download URL'))
        return
      }
      if (!allowedDownloadHost(u.hostname)) {
        reject(new Error(`Blocked redirect to non-Ollama host: ${u.hostname}`))
        return
      }
      const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null
      if (!lib) {
        reject(new Error('Only http(s) downloads are allowed'))
        return
      }
      const req = lib.request(
        u,
        {
          method: 'GET',
          headers: { 'User-Agent': UA },
          timeout: 600_000
        },
        (res) => {
          const code = res.statusCode ?? 0
          if (code >= 300 && code < 400 && res.headers.location) {
            res.resume()
            follow(new URL(res.headers.location, u).href, depth + 1)
            return
          }
          if (code !== 200) {
            res.resume()
            reject(new Error(`Download failed (HTTP ${code || '?'})`))
            return
          }
          const file = createWriteStream(destPath)
          res.pipe(file)
          file.on('finish', () => file.close((err) => (err ? reject(err) : resolve())))
          res.on('error', reject)
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Download timed out'))
      })
      req.end()
    }
    follow(urlStr, 0)
  })
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await unlink(p)
  } catch {
    /* ignore */
  }
}

/** Downloaded `install.ps1` executed with `-File`. */
function runPowerShellInstallFile(
  ps1Path: string,
  onProgress?: OllamaInstallProgressFn
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
      { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let stderr = ''
    const outBuf = createLineBuffer((line) => safeProgress(onProgress, line))
    const errBuf = createLineBuffer((line) => {
      safeProgress(onProgress, `[stderr] ${line}`)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString()
      stderr += s
      errBuf.push(chunk)
      logLine('warn', 'ollama_install_ps_stderr', { chunk: s.slice(0, 800) })
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      outBuf.push(chunk)
      logLine('info', 'ollama_install_ps_stdout', { chunk: chunk.toString().slice(0, 800) })
    })
    child.once('error', reject)
    child.once('close', (code) => {
      outBuf.flush()
      errBuf.flush()
      resolve({ code, stderr: stderr.trim() })
    })
  })
}

const UNIX_INSTALL_TIMEOUT_MS = 900_000

/** Run downloaded `install.sh` (macOS + Linux official installer). */
function runUnixInstallSh(
  shPath: string,
  onProgress?: OllamaInstallProgressFn
): Promise<{ code: number | null; combined: string }> {
  return new Promise((resolve, reject) => {
    const useTty = process.stdin.isTTY === true
    const child = spawn('/bin/sh', [shPath], {
      stdio: useTty ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })
    let combined = ''
    const outBuf = createLineBuffer((line) => {
      combined += `${line}\n`
      safeProgress(onProgress, line)
    })
    const errBuf = createLineBuffer((line) => {
      combined += `${line}\n`
      safeProgress(onProgress, `[stderr] ${line}`)
    })
    if (!useTty) {
      child.stdout?.on('data', (c: Buffer) => {
        outBuf.push(c)
        logLine('info', 'ollama_install_sh_stdout', { chunk: c.toString().slice(0, 600) })
      })
      child.stderr?.on('data', (c: Buffer) => {
        errBuf.push(c)
        logLine('warn', 'ollama_install_sh_stderr', { chunk: c.toString().slice(0, 600) })
      })
    } else {
      safeProgress(onProgress, 'Install script output is attached to this terminal session.')
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      logLine('warn', 'ollama_install_sh_timeout', { ms: UNIX_INSTALL_TIMEOUT_MS })
    }, UNIX_INSTALL_TIMEOUT_MS)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (!useTty) {
        outBuf.flush()
        errBuf.flush()
      }
      resolve({ code, combined: useTty ? '' : combined.trim() })
    })
  })
}

async function waitForOllama(
  baseUrl: string,
  maxWaitMs: number,
  onProgress?: OllamaInstallProgressFn
): Promise<boolean> {
  const start = Date.now()
  const deadline = start + maxWaitMs
  safeProgress(onProgress, `Waiting for Ollama API at ${baseUrl}…`)
  let lastPulseAt = start
  while (Date.now() < deadline) {
    if (await probeOllamaReachable(baseUrl)) {
      safeProgress(onProgress, 'Ollama API is responding.')
      return true
    }
    await sleep(2000)
    const now = Date.now()
    if (now - lastPulseAt >= 15_000) {
      lastPulseAt = now
      const elapsed = Math.floor((now - start) / 1000)
      safeProgress(
        onProgress,
        `Still waiting for API… (${elapsed}s / ${Math.floor(maxWaitMs / 1000)}s max)`
      )
    }
  }
  return false
}

export async function installOllamaForPlatform(
  ollamaBaseUrl: string,
  onProgress?: OllamaInstallProgressFn
): Promise<OllamaInstallResult> {
  const base = ollamaBaseUrl.replace(/\/$/, '')
  const prog = onProgress

  if (process.platform === 'win32') {
    const psPath = join(app.getPath('temp'), `ollama-install-${Date.now()}.ps1`)
    try {
      safeProgress(prog, 'Downloading official install.ps1 from ollama.com…')
      logLine('info', 'ollama_install_download', { platform: 'win32', url: URLS.installPs1 })
      await downloadToFile(URLS.installPs1, psPath)
      safeProgress(prog, 'Running PowerShell installer (progress may appear below)…')
      logLine('info', 'ollama_install_run', { path: psPath })
      const { code, stderr } = await runPowerShellInstallFile(psPath, prog)
      logLine('info', 'ollama_install_ps_exit', { code })
      if (code !== 0) {
        const tail = stderr ? ` ${stderr.slice(-400)}` : ''
        return {
          ok: false,
          error: `Install script exited with code ${code ?? 'unknown'}.${tail ? ` Output: ${tail}` : ''}`
        }
      }
      if (await waitForOllama(base, 180_000, prog)) {
        return {
          ok: true,
          detail: 'Ollama was installed from the official ollama.com script and is responding on your configured URL.'
        }
      }
      return {
        ok: false,
        error:
          'The installer finished but the API is not reachable yet. Open Ollama from the Start menu, wait until it is running, then use Refresh in Run.'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logLine('error', 'ollama_install_failed', { platform: 'win32', error: msg })
      return { ok: false, error: msg }
    } finally {
      await safeUnlink(psPath)
    }
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const shPath = join(tmpdir(), `ollama-install-${Date.now()}.sh`)
    try {
      safeProgress(prog, 'Downloading official install.sh from ollama.com…')
      logLine('info', 'ollama_install_download', { platform: process.platform, url: URLS.installSh })
      await downloadToFile(URLS.installSh, shPath)
      chmodSync(shPath, 0o700)
      safeProgress(prog, 'Running install script…')
      logLine('info', 'ollama_install_run', { path: shPath })
      const { code, combined } = await runUnixInstallSh(shPath, prog)
      logLine('info', 'ollama_install_sh_exit', { code })
      if (code !== 0) {
        const tail = combined.slice(-800)
        const sudoHint =
          process.platform === 'linux' && /sudo|password|tty|authentication/i.test(combined)
            ? ' If the script needed sudo, run the app from a terminal so the password prompt can appear, or install Ollama manually from ollama.com.'
            : ''
        return {
          ok: false,
          error: `Official install.sh exited with code ${code ?? 'unknown'}.${tail ? ` Last output: ${tail}` : ''}${sudoHint}`
        }
      }
      if (await waitForOllama(base, 180_000, prog)) {
        return {
          ok: true,
          detail: 'Ollama was installed via the official ollama.com script and is responding on your configured URL.'
        }
      }
      return {
        ok: false,
        error:
          'The install script finished but the API is not reachable yet. Start the Ollama app or ollama serve, then use Refresh in Run.'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logLine('error', 'ollama_install_failed', { platform: process.platform, error: msg })
      return { ok: false, error: msg }
    } finally {
      await safeUnlink(shPath)
    }
  }

  safeProgress(prog, 'Opening ollama.com download page in your browser…')
  await shell.openExternal(URLS.home)
  return {
    ok: true,
    needsManualFinish: true,
    hint: 'Open the download page in your browser to install Ollama for your system, then return here.'
  }
}
