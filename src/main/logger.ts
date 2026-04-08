import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

let logDir = ''

export function initLogger(dir: string): void {
  logDir = dir
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
}

export function logLine(level: string, msg: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta
  })
  // eslint-disable-next-line no-console
  console.log(line)
  if (logDir) {
    try {
      appendFileSync(join(logDir, 'app.log'), line + '\n', 'utf8')
    } catch {
      /* ignore disk errors */
    }
  }
}
