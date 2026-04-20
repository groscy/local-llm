import { spawn, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import {
  MAX_FORMAL_RUN_STREAM_BYTES,
  type FormalSpawnMode,
  type FormalToolProfile,
  type FormalVerificationRun,
  type FormalVerificationRunStatus
} from '@shared/codebaseRegistry'

/** Expand `{{root}}` with minimal escaping for POSIX / cmd shell one-liners. */
export function expandCommandTemplate(commandTemplate: string, rootPath: string): string {
  const abs = resolve(rootPath.trim())
  const q =
    process.platform === 'win32'
      ? abs.includes(' ')
        ? `"${abs.replace(/"/g, '""')}"`
        : abs
      : abs.includes(' ') || abs.includes("'")
        ? `'${abs.replace(/'/g, `'\\''`)}'`
        : abs
  return commandTemplate.split('{{root}}').join(q)
}

function truncateUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8')
  if (buf.length <= maxBytes) return s
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end--
  }
  return buf.subarray(0, end).toString('utf8') + '\n…[truncated]'
}

export interface FormalRunCallbacks {
  onStdoutAppend: (chunk: string) => void
  onStderrAppend: (chunk: string) => void
}

export interface FormalRunnerDeps {
  spawnFn?: typeof spawn
  platform?: NodeJS.Platform
}

/**
 * Runs `profile.commandResolved` (already expanded) with cwd = codebase root.
 * Caps each stream at MAX_FORMAL_RUN_STREAM_BYTES.
 */
export function runFormalVerificationJob(p: {
  commandResolved: string
  cwd: string
  spawnMode: FormalSpawnMode
  timeoutMs: number
  expectedExitCodes: number[]
  callbacks?: FormalRunCallbacks
  deps?: FormalRunnerDeps
}): Promise<{ exitCode: number | null; status: FormalVerificationRunStatus; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const spawnImpl = p.deps?.spawnFn ?? spawn
    const platform = p.deps?.platform ?? process.platform
    let stdoutBuf = ''
    let stderrBuf = ''
    let killed = false
    const capEach = MAX_FORMAL_RUN_STREAM_BYTES

    const appendOut = (to: 'stdout' | 'stderr', chunk: string) => {
      if (to === 'stdout') {
        stdoutBuf += chunk
        if (stdoutBuf.length > capEach * 1.5) stdoutBuf = truncateUtf8(stdoutBuf, capEach)
        p.callbacks?.onStdoutAppend(chunk)
      } else {
        stderrBuf += chunk
        if (stderrBuf.length > capEach * 1.5) stderrBuf = truncateUtf8(stderrBuf, capEach)
        p.callbacks?.onStderrAppend(chunk)
      }
    }

    let child: ChildProcess
    const useShell = p.spawnMode === 'shell' || platform === 'win32'
    if (useShell) {
      if (platform === 'win32') {
        const shellExe = process.env.ComSpec || 'cmd.exe'
        child = spawnImpl(shellExe, ['/d', '/s', '/c', p.commandResolved], {
          cwd: p.cwd,
          windowsHide: true,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } else {
        child = spawnImpl('/bin/sh', ['-c', p.commandResolved], {
          cwd: p.cwd,
          windowsHide: true,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      }
    } else {
      const parts = p.commandResolved.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [p.commandResolved]
      const argv = parts.map((x) => (x.startsWith('"') && x.endsWith('"') ? x.slice(1, -1) : x))
      const cmd = argv[0] ?? p.commandResolved
      const args = argv.slice(1)
      child = spawnImpl(cmd, args, {
        cwd: p.cwd,
        windowsHide: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    }

    const stdout = child.stdout
    const stderr = child.stderr
    if (!stdout || !stderr) {
      resolvePromise({ exitCode: null, status: 'failed', stdout: '', stderr: 'Process has no stdout/stderr pipes.' })
      return
    }

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }, 2000).unref?.()
    }, Math.max(1000, p.timeoutMs))

    stdout.setEncoding('utf8')
    stderr.setEncoding('utf8')
    stdout.on('data', (d: string) => appendOut('stdout', d))
    stderr.on('data', (d: string) => appendOut('stderr', d))

    const finish = (status: FormalVerificationRunStatus, code: number | null) => {
      clearTimeout(timer)
      stdoutBuf = truncateUtf8(stdoutBuf, capEach)
      stderrBuf = truncateUtf8(stderrBuf, capEach)
      resolvePromise({ exitCode: code, status, stdout: stdoutBuf, stderr: stderrBuf })
    }

    child.on('error', () => {
      finish('failed', null)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const exitCode = typeof code === 'number' ? code : null
      if (killed) {
        finish('timeout', exitCode)
        return
      }
      const ok = exitCode != null && p.expectedExitCodes.includes(exitCode)
      finish(ok ? 'succeeded' : 'failed', exitCode)
    })
  })
}

export function finalizeRunRow(
  base: FormalVerificationRun,
  result: Awaited<ReturnType<typeof runFormalVerificationJob>>
): FormalVerificationRun {
  return {
    ...base,
    finishedAt: Date.now(),
    status: result.status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  }
}
