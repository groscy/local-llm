/** Rolling mean of successful chat round-trips (wall time for full model completion). */

const MAX_SAMPLES = 64
/** Ignore absurd durations (e.g. clock skew / hung requests) from polluting the average. */
const MAX_ROUNDTRIP_MS = 30 * 60 * 1000

const samples: number[] = []

export function recordChatRoundtripMs(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return
  if (ms > MAX_ROUNDTRIP_MS) return
  samples.push(ms)
  while (samples.length > MAX_SAMPLES) samples.shift()
}

export function averageChatRoundtripMs(): number | undefined {
  if (samples.length === 0) return undefined
  let sum = 0
  for (const x of samples) sum += x
  return sum / samples.length
}
