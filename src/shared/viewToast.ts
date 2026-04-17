import type { AppMainView, ToolDrawerId } from './uiRole'

/** Shell view an update belongs to; use `global` to always show (unless deduped). */
export type ViewToastOrigin = AppMainView | 'global'

export type ViewToastVariant = 'info' | 'success' | 'warning'

export type ViewToastInput = {
  origin: ViewToastOrigin
  message: string
  title?: string
  variant?: ViewToastVariant
  /**
   * Auto-dismiss after this many ms. Defaults to 6500.
   * Set to 0 (or `Infinity`) to keep the toast until the user dismisses it.
   */
  durationMs?: number
  /** When true, show even if the user is already on `origin` (foreground). */
  force?: boolean
  action?: { label: string; onClick: () => void }
}

/** Matches renderer drawer state: tool panels plus settings. */
export type ViewToastDrawerState = ToolDrawerId | 'settings' | null

export type ViewToastNavigationSnapshot = {
  activeMainView: AppMainView
  openDrawer: ViewToastDrawerState
}

export function viewToastOriginIsForeground(
  origin: ViewToastOrigin,
  nav: ViewToastNavigationSnapshot
): boolean {
  if (origin === 'global') return false
  if (nav.activeMainView === origin) return true
  if (origin === 'train' && nav.openDrawer === 'train') return true
  return false
}
