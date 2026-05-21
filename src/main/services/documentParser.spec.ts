import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDocumentFromBytes } from './documentParser'

const getTextMock = vi.fn()
const destroyMock = vi.fn()

vi.mock('pdf-parse', () => {
  return {
    PDFParse: class {
      async getText(opts: unknown): Promise<unknown> {
        return await getTextMock(opts)
      }
      async destroy(): Promise<void> {
        await destroyMock()
      }
    }
  }
})

describe('documentParser', () => {
  beforeEach(() => {
    getTextMock.mockReset()
    destroyMock.mockReset()
  })

  it('parses html inputs into normalized text sections', async () => {
    const parsed = await parseDocumentFromBytes({
      fileName: 'example.html',
      bytes: Buffer.from('<html><body><h1>Intro</h1><p>Hello <b>world</b>.</p></body></html>')
    })
    expect(parsed.format).toBe('html')
    expect(parsed.parserMode).toBe('html_text')
    expect(parsed.normalizedText).toContain('Hello world.')
    expect(parsed.sections.length).toBeGreaterThan(0)
  })

  it('returns pdf parser diagnostics and mode', async () => {
    getTextMock.mockResolvedValue({
      text: 'Systems use routing for failover.\nRouting improves uptime.',
      total: 1
    })
    destroyMock.mockResolvedValue(undefined)
    const parsed = await parseDocumentFromBytes({
      fileName: 'sample.pdf',
      bytes: Buffer.from('%PDF')
    })
    expect(parsed.format).toBe('pdf')
    expect(parsed.sourceKind).toBe('pdf')
    expect(parsed.parserMode).toBe('text_layer')
    expect(parsed.parserDiagnostics?.truncated).toBe(false)
    expect(parsed.extractionVersion).toMatch(/document-parser-v2/)
  })
})
