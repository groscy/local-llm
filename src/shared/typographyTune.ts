export const TYPOGRAPHY_FONT_FAMILY_IDS = ['system', 'wide_sans', 'serif_document'] as const

export type TypographyFontFamilyId = (typeof TYPOGRAPHY_FONT_FAMILY_IDS)[number]

export const DEFAULT_TYPOGRAPHY_FONT_FAMILY: TypographyFontFamilyId = 'system'

export const TYPOGRAPHY_FONT_FAMILY_LABELS: Record<TypographyFontFamilyId, string> = {
  system: 'System UI — default stack for this OS',
  wide_sans: 'Wide sans — Segoe / Helvetica-style, slightly open shapes',
  serif_document: 'Serif document — Georgia-style for long reading'
}

export const TYPOGRAPHY_LINE_HEIGHT_FACTOR_MIN = 0.88
export const TYPOGRAPHY_LINE_HEIGHT_FACTOR_MAX = 1.2
export const DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR = 1

export const TYPOGRAPHY_LETTER_EXTRA_EM_MIN = -0.04
export const TYPOGRAPHY_LETTER_EXTRA_EM_MAX = 0.12
export const DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM = 0

export const TYPOGRAPHY_WORD_SPACING_EM_MIN = 0
export const TYPOGRAPHY_WORD_SPACING_EM_MAX = 0.2
export const DEFAULT_TYPOGRAPHY_WORD_SPACING_EM = 0

export function parseTypographyFontFamily(raw: unknown): TypographyFontFamilyId {
  if (typeof raw !== 'string') return DEFAULT_TYPOGRAPHY_FONT_FAMILY
  return (TYPOGRAPHY_FONT_FAMILY_IDS as readonly string[]).includes(raw)
    ? (raw as TypographyFontFamilyId)
    : DEFAULT_TYPOGRAPHY_FONT_FAMILY
}

export function clampTypographyLineHeightFactor(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR
  return Math.min(TYPOGRAPHY_LINE_HEIGHT_FACTOR_MAX, Math.max(TYPOGRAPHY_LINE_HEIGHT_FACTOR_MIN, n))
}

export function parseTypographyLineHeightFactor(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR
  return clampTypographyLineHeightFactor(raw)
}

export function clampTypographyLetterSpacingExtraEm(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM
  return Math.min(TYPOGRAPHY_LETTER_EXTRA_EM_MAX, Math.max(TYPOGRAPHY_LETTER_EXTRA_EM_MIN, n))
}

export function parseTypographyLetterSpacingExtraEm(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM
  return clampTypographyLetterSpacingExtraEm(raw)
}

export function clampTypographyWordSpacingEm(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TYPOGRAPHY_WORD_SPACING_EM
  return Math.min(TYPOGRAPHY_WORD_SPACING_EM_MAX, Math.max(TYPOGRAPHY_WORD_SPACING_EM_MIN, n))
}

export function parseTypographyWordSpacingEm(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_TYPOGRAPHY_WORD_SPACING_EM
  return clampTypographyWordSpacingEm(raw)
}
