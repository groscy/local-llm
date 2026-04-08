import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'

/** Resident set size of a process in MiB (best-effort; platform-specific). */
export function processRssMb(pid: number | undefined): number | undefined {
  if (pid == null || pid < 1 || !Number.isFinite(pid)) return undefined
  try {
    if (process.platform === 'linux') {
      const st = readFileSync(`/proc/${pid}/status`, 'utf8')
      const m = /^VmRSS:\s+(\d+)\s+kB$/m.exec(st)
      if (m) return Number(m[1]) / 1024
      return undefined
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024
      }).trim()
      const kb = parseInt(out, 10)
      if (Number.isFinite(kb)) return kb / 1024
      return undefined
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 }
      ).trim()
      const bytes = parseInt(out, 10)
      if (Number.isFinite(bytes)) return bytes / (1024 * 1024)
      return undefined
    }
  } catch {
    return undefined
  }
  return undefined
}
