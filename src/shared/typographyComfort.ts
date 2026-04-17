export const TYPOGRAPHY_COMFORT_IDS = ['compact', 'balanced', 'relaxed', 'reader'] as const

export type TypographyComfortId = (typeof TYPOGRAPHY_COMFORT_IDS)[number]

/** Default favors slightly larger type and more line height than legacy “compact”. */
export const DEFAULT_TYPOGRAPHY_COMFORT: TypographyComfortId = 'balanced'

export const TYPOGRAPHY_COMFORT_LABELS: Record<TypographyComfortId, string> = {
  compact: 'Compact — dense UI (smaller type, tighter lines)',
  balanced: 'Balanced — easier on the eyes for daily use (recommended)',
  relaxed: 'Relaxed — roomier lines for long sessions',
  reader: 'Reader — largest comfortable scale for long reading'
}

export function parseTypographyComfort(raw: unknown): TypographyComfortId {
  if (typeof raw !== 'string') return DEFAULT_TYPOGRAPHY_COMFORT
  return (TYPOGRAPHY_COMFORT_IDS as readonly string[]).includes(raw)
    ? (raw as TypographyComfortId)
    : DEFAULT_TYPOGRAPHY_COMFORT
}
