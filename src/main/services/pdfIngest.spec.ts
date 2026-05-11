import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPdfTextWithDiagnostics, isPdfFilePath } from './pdfIngest'

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

describe('isPdfFilePath', () => {
  it('detects .pdf case-insensitively', () => {
    expect(isPdfFilePath('C:\\docs\\X.PDF')).toBe(true)
    expect(isPdfFilePath('/home/a.pdf')).toBe(true)
    expect(isPdfFilePath('note.md')).toBe(false)
  })
})

describe('extractPdfTextWithDiagnostics', () => {
  beforeEach(() => {
    getTextMock.mockReset()
    destroyMock.mockReset()
  })

  it('cleans hyphenation and hard wraps', async () => {
    getTextMock.mockResolvedValue({
      text: 'inter-\nnal systems\nprocess data.\nThe model\nkeeps context.'
    })
    destroyMock.mockResolvedValue(undefined)

    const out = await extractPdfTextWithDiagnostics(Buffer.from('%PDF'))
    expect(out.text).toContain('internal systems process data.')
    expect(out.text).toContain('The model keeps context.')
    expect(out.diagnostics.cleanupEdits).toBeGreaterThan(0)
    expect(out.diagnostics.truncated).toBe(false)
  })
})
