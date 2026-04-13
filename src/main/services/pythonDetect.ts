import { execFile } from 'child_process'
import { existsSync } from 'fs'
import type Store from 'electron-store'
import { logLine } from '../logger'

const PROBE_TIMEOUT_MS = 8000

/** After a successful probe-or-skip this session, skip further probes until reset. */
let sessionAutoDetectFinished = false

export function resetPythonAutoDetectSession(): void {
  sessionAutoDetectFinished = false
}

function firstLinePath(stdout: string): string | null {
  const line = stdout.trim().split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
  if (!line) return null
  const p = line.replace(/^file:\/\//i, '')
  try {
    return existsSync(p) ? p : null
  } catch {
    return null
  }
}

function probeCommand(cmd: string, prefixArgs: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const args = [...prefixArgs, '-c', 'import sys; print(sys.executable)']
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(firstLinePath(String(stdout)))
    })
  })
}

/**
 * Find a working Python interpreter on PATH (absolute path from sys.executable).
 */
export async function detectPythonInterpreter(): Promise<string | null> {
  const isWin = process.platform === 'win32'
  const tries: { cmd: string; prefix: string[] }[] = isWin
    ? [
        { cmd: 'py', prefix: ['-3'] },
        { cmd: 'py', prefix: [] },
        { cmd: 'python', prefix: [] },
        { cmd: 'python3', prefix: [] }
      ]
    : [
        { cmd: 'python3', prefix: [] },
        { cmd: 'python', prefix: [] }
      ]

  for (const { cmd, prefix } of tries) {
    try {
      const p = await probeCommand(cmd, prefix)
      if (p) return p
    } catch {
      /* timeout or spawn error */
    }
  }
  return null
}

/**
 * If `llamaPythonPath` is unset, probe once per app session and persist the first working interpreter.
 */
export async function ensureAutoDetectedPythonInStore(store: Store<Record<string, unknown>>): Promise<void> {
  const cur = store.get('llamaPythonPath')
  if (typeof cur === 'string' && cur.trim()) {
    sessionAutoDetectFinished = true
    return
  }
  if (sessionAutoDetectFinished) return
  sessionAutoDetectFinished = true

  const found = await detectPythonInterpreter()
  if (found) {
    store.set('llamaPythonPath', found)
    logLine('info', 'python_auto_detected_for_convert', { path: found })
  }
}
