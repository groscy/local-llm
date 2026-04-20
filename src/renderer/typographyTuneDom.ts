import {
  DEFAULT_TYPOGRAPHY_FONT_FAMILY,
  type TypographyFontFamilyId
} from '@shared/typographyTune'

export type TypographyFineTune = {
  fontFamily: TypographyFontFamilyId
  lineHeightFactor: number
  letterSpacingExtraEm: number
  wordSpacingEm: number
}

/** Applies font + spacing tuning via `data-typography-font` and custom properties on `<html>`. */
export function applyTypographyFineTuneToDocument(p: TypographyFineTune): void {
  const el = document.documentElement
  if (p.fontFamily === DEFAULT_TYPOGRAPHY_FONT_FAMILY) {
    el.removeAttribute('data-typography-font')
  } else {
    el.setAttribute('data-typography-font', p.fontFamily)
  }
  el.style.setProperty('--typography-user-line-height-factor', String(p.lineHeightFactor))
  el.style.setProperty('--typography-user-letter-extra', `${p.letterSpacingExtraEm}em`)
  el.style.setProperty('--typography-user-word-spacing', p.wordSpacingEm === 0 ? 'normal' : `${p.wordSpacingEm}em`)
}
