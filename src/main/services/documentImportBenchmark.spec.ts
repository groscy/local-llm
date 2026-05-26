import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runDocumentImportBenchmark } from './documentImportBenchmark'

// Excluded from CI pending benchmark infrastructure decision (requires corpus on disk).
describe.skip('documentImportBenchmark', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    for (const root of tempRoots) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors in tests
      }
    }
    tempRoots.length = 0
  })

  it('scores a local corpus and returns aggregate metrics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-benchmark-'))
    tempRoots.push(root)
    const docPath = join(root, 'routing.txt')
    writeFileSync(
      docPath,
      'Routing Engine depends on Health Monitor. Routing Engine uses Retry Policy for stability.',
      'utf8'
    )
    writeFileSync(
      join(root, 'routing.golden.json'),
      JSON.stringify(
        {
          expectedEntities: ['Routing Engine', 'Health Monitor', 'Retry Policy'],
          expectedRelations: [{ from: 'Routing Engine', predicate: 'app:dependsOn', to: 'Health Monitor' }],
          mustReject: ['context', 'summary']
        },
        null,
        2
      ),
      'utf8'
    )

    const summary = await runDocumentImportBenchmark(root)
    expect(summary.documents).toBe(1)
    expect(summary.results[0]?.filePath).toContain('routing.txt')
    expect(summary.entityPrecision).toBeGreaterThan(0)
    expect(summary.parserHardFailureRate).toBe(0)
  })
})
