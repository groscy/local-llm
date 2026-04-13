/** Canonical theme ids (saved from the Appearance picker after normalization). */
export const COLOR_SCHEME_IDS = [
  'violet',
  'dark-charcoal-teal',
  'black-oled-blue',
  'light-warm-slate',
  'solarized-light',
  'solarized-dark',
  'cvd-rg-blue-amber',
  'cvd-by-violet-amber'
] as const

/** Older releases stored these; they map to coordinated themes in {@link parseColorScheme}. */
export const LEGACY_COLOR_SCHEME_IDS = ['teal', 'amber', 'rose', 'sky'] as const

export type ColorSchemeId = (typeof COLOR_SCHEME_IDS)[number]

export type StoredColorSchemeId = ColorSchemeId | (typeof LEGACY_COLOR_SCHEME_IDS)[number]

export const ALL_STORED_COLOR_SCHEME_IDS: readonly string[] = [
  ...COLOR_SCHEME_IDS,
  ...LEGACY_COLOR_SCHEME_IDS
]

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = 'violet'

/** User-facing names describe the main color combinations (not single hue labels). */
export const COLOR_SCHEME_LABELS: Record<ColorSchemeId, string> = {
  violet: 'Dark — midnight blue & violet',
  'dark-charcoal-teal': 'Dark — charcoal & sea teal',
  'black-oled-blue': 'Black — OLED & ice blue',
  'light-warm-slate': 'Light — warm paper & slate blue',
  'solarized-light': 'Solarized Light — cream & cyan',
  'solarized-dark': 'Solarized Dark — teal depths & gold',
  'cvd-rg-blue-amber': 'CVD — blue & amber (red–green safe)',
  'cvd-by-violet-amber': 'CVD — violet & gold (blue–yellow safe)'
}

const LEGACY_TO_CANONICAL: Record<string, ColorSchemeId> = {
  teal: 'dark-charcoal-teal',
  amber: 'solarized-dark',
  rose: 'violet',
  sky: 'black-oled-blue'
}

export function isValidStoredColorScheme(raw: string): raw is StoredColorSchemeId {
  return (ALL_STORED_COLOR_SCHEME_IDS as readonly string[]).includes(raw)
}

export function parseColorScheme(raw: unknown): ColorSchemeId {
  if (typeof raw !== 'string') return DEFAULT_COLOR_SCHEME
  if ((COLOR_SCHEME_IDS as readonly string[]).includes(raw)) return raw as ColorSchemeId
  const mapped = LEGACY_TO_CANONICAL[raw]
  if (mapped) return mapped
  return DEFAULT_COLOR_SCHEME
}
