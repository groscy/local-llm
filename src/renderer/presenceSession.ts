const STORAGE_KEY = 'localLlm:presenceSession:v1'

export type PresenceSessionRecord = {
  lastHiddenAt: number
}

function parseRecord(raw: string | null): PresenceSessionRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const t = (o as Record<string, unknown>).lastHiddenAt
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null
    return { lastHiddenAt: Math.floor(t) }
  } catch {
    return null
  }
}

export function readPresenceSession(): { lastHiddenAt: number | null } {
  if (typeof localStorage === 'undefined') return { lastHiddenAt: null }
  const rec = parseRecord(localStorage.getItem(STORAGE_KEY))
  return { lastHiddenAt: rec?.lastHiddenAt ?? null }
}

export function touchPresenceSessionHidden(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: PresenceSessionRecord = { lastHiddenAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota */
  }
}
