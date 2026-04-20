import type { ColorSchemeId } from '@shared/colorScheme'

export function applyColorSchemeToDocument(id: ColorSchemeId): void {
  if (id === 'violet') {
    document.documentElement.removeAttribute('data-color-scheme')
  } else {
    document.documentElement.setAttribute('data-color-scheme', id)
  }
}
