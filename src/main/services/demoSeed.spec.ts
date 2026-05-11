import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type Store from 'electron-store'
import { migrate } from '../db/migrations'
import { createOntologyService } from './ontologyService'
import { ensureDemoSeeded } from './demoSeed'

const sqliteAvailable = (() => {
  try {
    const probe = new Database(':memory:')
    probe.close()
    return true
  } catch {
    return false
  }
})()

function makeStore(overrides: Record<string, unknown> = {}): Store<Record<string, unknown>> {
  const map = new Map<string, unknown>([
    ['presentationModeEnabled', true],
    ['demoSeedBundleVersion', 0],
    ...Object.entries(overrides)
  ])
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => {
      map.set(k, v)
    }
  } as unknown as Store<Record<string, unknown>>
}

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('demo seed bootstrap', () => {
  it('hydrates starter content once and marks seed version', async () => {
    const db = new Database(':memory:')
    migrate(db)
    const store = makeStore()
    const ontology = createOntologyService(db)

    await ensureDemoSeeded({ db, store, ontology })
    const convoCount = Number((db.prepare('SELECT COUNT(*) as n FROM conversations').get() as { n: number }).n)
    const kbCount = Number((db.prepare('SELECT COUNT(*) as n FROM kb_sources').get() as { n: number }).n)
    expect(convoCount).toBeGreaterThan(0)
    expect(kbCount).toBeGreaterThan(0)
    expect(store.get('demoSeedBundleVersion')).toBe(1)

    await ensureDemoSeeded({ db, store, ontology })
    const convoCountAfter = Number((db.prepare('SELECT COUNT(*) as n FROM conversations').get() as { n: number }).n)
    expect(convoCountAfter).toBe(convoCount)
    db.close()
  })
})
