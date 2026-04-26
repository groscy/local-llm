import { describe, expect, it } from 'vitest'
import { isSupportedFile, sourceUri } from './dmsSyncOrchestrator'

describe('dmsSyncOrchestrator helpers', () => {
  it('accepts expected ingest file types', () => {
    expect(isSupportedFile('notes.md')).toBe(true)
    expect(isSupportedFile('report.PDF')).toBe(true)
    expect(isSupportedFile('payload.bin', 'text/plain')).toBe(true)
    expect(isSupportedFile('archive.zip', 'application/zip')).toBe(false)
  })

  it('builds deterministic DMS source uris', () => {
    expect(sourceUri('google-drive', 'abc123')).toBe('dms:google-drive:abc123')
  })
})
