import { useEffect } from 'react'

type PollTaskOptions = {
  enabled: boolean
  intervalMs: number
  run: () => void | Promise<void>
  runImmediately?: boolean
}

/**
 * Lightweight polling primitive used by the workflow shell.
 * Keeps interval setup/teardown consistent and avoids orphaned timers.
 */
export function usePollTask(opts: PollTaskOptions): void {
  const { enabled, intervalMs, run, runImmediately = true } = opts
  useEffect(() => {
    if (!enabled) return
    if (runImmediately) void run()
    const id = window.setInterval(() => void run(), intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, intervalMs, run, runImmediately])
}
