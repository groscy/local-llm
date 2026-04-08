export const COLOR_SCHEME_IDS = ['violet', 'teal', 'amber', 'rose', 'sky'] as const

export type ColorSchemeId = (typeof COLOR_SCHEME_IDS)[number]

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = 'violet'

export const COLOR_SCHEME_LABELS: Record<ColorSchemeId, string> = {
  violet: 'Violet',
  teal: 'Teal',
  amber: 'Amber',
  rose: 'Rose',
  sky: 'Sky'
}

export function parseColorScheme(raw: unknown): ColorSchemeId {
  if (typeof raw === 'string' && (COLOR_SCHEME_IDS as readonly string[]).includes(raw)) {
    return raw as ColorSchemeId
  }
  return DEFAULT_COLOR_SCHEME
}
