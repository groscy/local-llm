import { describe, expect, it } from 'vitest'
import type Store from 'electron-store'
import { migrateChatProfileSettings } from './storeDefaults'

function makeStore(seed: Record<string, unknown> = {}): Store<Record<string, unknown>> {
  const map = new Map<string, unknown>(Object.entries(seed))
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => {
      map.set(k, v)
    },
    has: (k: string) => map.has(k),
    delete: (k: string) => {
      map.delete(k)
    }
  } as unknown as Store<Record<string, unknown>>
}

describe('storeDefaults migrateChatProfileSettings', () => {
  it('backfills presentation and seeding keys', () => {
    const store = makeStore()
    migrateChatProfileSettings(store)
    expect(store.get('presentationModeEnabled')).toBe(true)
    expect(store.get('showAdvancedSurfaces')).toBe(false)
    expect(store.get('demoSeedBundleVersion')).toBe(0)
  })
})
