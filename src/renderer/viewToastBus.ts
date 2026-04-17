import { useMemo, useSyncExternalStore } from 'react'
import type { ViewToastInput, ViewToastNavigationSnapshot, ViewToastOrigin, ViewToastVariant } from '@shared/viewToast'
import { viewToastOriginIsForeground } from '@shared/viewToast'

const DEFAULT_DURATION_MS = 6500
const MAX_TOASTS = 5

export type ViewToastRecord = {
  id: string
  origin: ViewToastOrigin
  title?: string
  message: string
  variant: ViewToastVariant
  actionLabel?: string
}

let navigation: ViewToastNavigationSnapshot = {
  activeMainView: 'chat',
  openDrawer: null
}

let toasts: ViewToastRecord[] = []
const listeners = new Set<() => void>()
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()
const actionHandlers = new Map<string, () => void>()

function emit(): void {
  for (const l of listeners) l()
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Keep shell navigation in sync so `notifyWhenBackground` can suppress toasts while the user is on that surface. */
export function setViewToastNavigation(snapshot: ViewToastNavigationSnapshot): void {
  navigation = snapshot
}

export function subscribeViewToasts(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function getViewToastsSnapshot(): readonly ViewToastRecord[] {
  return toasts
}

export function getViewToastsServerSnapshot(): readonly ViewToastRecord[] {
  return []
}

function clearDismissTimer(id: string): void {
  const t = dismissTimers.get(id)
  if (t != null) {
    window.clearTimeout(t)
    dismissTimers.delete(id)
  }
}

export function dismissViewToast(id: string): void {
  clearDismissTimer(id)
  actionHandlers.delete(id)
  if (!toasts.some((x) => x.id === id)) return
  toasts = toasts.filter((x) => x.id !== id)
  emit()
}

export function runViewToastAction(id: string): void {
  const fn = actionHandlers.get(id)
  if (fn) fn()
}

/** Show a toast regardless of the active view. */
export function pushViewToast(input: ViewToastInput): string {
  const id = nextId()
  const variant = input.variant ?? 'info'
  const durationMs = input.durationMs ?? DEFAULT_DURATION_MS
  const rec: ViewToastRecord = {
    id,
    origin: input.origin,
    title: input.title,
    message: input.message,
    variant,
    actionLabel: input.action?.label
  }
  if (input.action?.onClick) actionHandlers.set(id, input.action.onClick)
  else actionHandlers.delete(id)

  let base = toasts
  if (base.length >= MAX_TOASTS) {
    const dropCount = base.length - MAX_TOASTS + 1
    const victims = base.slice(0, dropCount)
    for (const v of victims) {
      clearDismissTimer(v.id)
      actionHandlers.delete(v.id)
    }
    base = base.slice(dropCount)
  }
  toasts = [...base, rec]
  emit()

  clearDismissTimer(id)
  if (durationMs > 0 && durationMs !== Number.POSITIVE_INFINITY && Number.isFinite(durationMs)) {
    dismissTimers.set(
      id,
      window.setTimeout(() => {
        dismissViewToast(id)
      }, durationMs)
    )
  }

  return id
}

/**
 * Show a toast only when the user is not already focused on `origin`
 * (main view matches, or train is also considered foreground when the train drawer is open).
 */
export function notifyWhenBackground(input: ViewToastInput): void {
  if (!input.force && input.origin !== 'global' && viewToastOriginIsForeground(input.origin, navigation)) {
    return
  }
  pushViewToast(input)
}

export function useViewToast(): {
  pushToast: typeof pushViewToast
  notifyWhenBackground: typeof notifyWhenBackground
  dismissToast: typeof dismissViewToast
} {
  return useMemo(
    () => ({
      pushToast: pushViewToast,
      notifyWhenBackground,
      dismissToast: dismissViewToast
    }),
    []
  )
}

export function useViewToastsForDisplay(): readonly ViewToastRecord[] {
  return useSyncExternalStore(subscribeViewToasts, getViewToastsSnapshot, getViewToastsServerSnapshot)
}
