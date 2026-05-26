import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDocumentFromBytes } from './documentParser'

const { getTextMock, destroyMock, spawnSyncMock, ocrMock, readFileSyncMock } = vi.hoisted(() => ({
  getTextMock: vi.fn(),
  destroyMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  ocrMock: vi.fn(),
  readFileSyncMock: vi.fn()
}))

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

vi.mock('child_process', () => ({ spawnSync: spawnSyncMock }))

vi.mock('./pdfOcr', () => ({ extractPdfTextWithTrueOcrFallback: ocrMock }))

vi.mock('fs', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return { ...original, readFileSync: readFileSyncMock }
})

const GOOD_TEXT = 'The routing engine depends on the health monitor for stability. Uptime metrics are tracked.'
const PDFTOTXT_TEXT =
  'Text layer extraction produced this content using the pdftotext fallback pipeline tool for scanned documents. The routing engine depends on the health monitor for uptime.'
const OCR_TEXT = 'OCR extracted page content with high confidence from the scanned document image pixels.'

describe('documentParser', () => {
  beforeEach(() => {
    getTextMock.mockReset()
    destroyMock.mockReset()
    spawnSyncMock.mockReset()
    ocrMock.mockReset()
    readFileSyncMock.mockReset()
    // default: pdftotext binary not found, no OCR
    spawnSyncMock.mockReturnValue({ status: 1, error: new Error('not found') })
    ocrMock.mockReturnValue(null)
    // default: readFileSync passthrough to throw (temp files shouldn't be read in most tests)
    readFileSyncMock.mockImplementation((path: string, ...args: unknown[]) => {
      throw new Error(`readFileSync: unexpected call for ${path}`)
    })
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

  it('returns pdf parser diagnostics and mode for text_layer', async () => {
    getTextMock.mockResolvedValue({ text: GOOD_TEXT, total: 1 })
    destroyMock.mockResolvedValue(undefined)
    const parsed = await parseDocumentFromBytes({
      fileName: 'sample.pdf',
      bytes: Buffer.from('%PDF')
    })
    expect(parsed.format).toBe('pdf')
    expect(parsed.sourceKind).toBe('pdf')
    expect(parsed.parserMode).toBe('text_layer')
    expect(parsed.parserDiagnostics?.truncated).toBe(false)
    expect(parsed.extractionVersion).toMatch(/document-parser-v3/)
  })

  it('uses pdftotext_fallback when text layer is low-signal and pdftotext succeeds', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 0 })
    destroyMock.mockResolvedValue(undefined)
    // pdftotext binary probe succeeds, run succeeds
    spawnSyncMock.mockReturnValue({ status: 0 })
    // readFileSync returns pdftotext output when called for the .txt temp file
    readFileSyncMock.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.txt')) return PDFTOTXT_TEXT
      throw new Error(`unexpected readFileSync: ${path}`)
    })
    ocrMock.mockReturnValue(null)
    const parsed = await parseDocumentFromBytes({
      fileName: 'text-only.pdf',
      bytes: Buffer.from('%PDF')
    })
    expect(parsed.parserMode).toBe('pdftotext_fallback')
    expect(parsed.ocrApplied).toBe(false)
    expect(parsed.normalizedText).toContain('pdftotext')
  })

  it('uses true_ocr_fallback when text layer is low-signal and only OCR succeeds', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 0 })
    destroyMock.mockResolvedValue(undefined)
    spawnSyncMock.mockReturnValue({ status: 1, error: new Error('pdftotext not found') })
    ocrMock.mockReturnValue({
      text: OCR_TEXT,
      pagesProcessed: 1,
      totalPagesDetected: 1,
      warnings: [],
      engine: 'pdftoppm+tesseract',
      pages: [{ text: OCR_TEXT, confidence: 0.87 }]
    })
    const parsed = await parseDocumentFromBytes({
      fileName: 'image-only.pdf',
      bytes: Buffer.from('%PDF')
    })
    expect(parsed.parserMode).toBe('true_ocr_fallback')
    expect(parsed.ocrApplied).toBe(true)
    expect(parsed.ocrCoverage).toBeGreaterThan(0)
  })

  it('uses hybrid_merged when pdftotext and OCR both contribute text', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 0 })
    destroyMock.mockResolvedValue(undefined)
    spawnSyncMock.mockReturnValue({ status: 0 })
    readFileSyncMock.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.txt')) return PDFTOTXT_TEXT
      throw new Error(`unexpected readFileSync: ${path}`)
    })
    ocrMock.mockReturnValue({
      text: OCR_TEXT,
      pagesProcessed: 2,
      totalPagesDetected: 2,
      warnings: [],
      engine: 'pdftoppm+tesseract',
      pages: [
        { text: OCR_TEXT, confidence: 0.92 },
        { text: 'More OCR content on page two.', confidence: 0.88 }
      ]
    })
    const parsed = await parseDocumentFromBytes({
      fileName: 'hybrid.pdf',
      bytes: Buffer.from('%PDF')
    })
    expect(parsed.parserMode).toBe('hybrid_merged')
    expect(parsed.ocrApplied).toBe(true)
  })
})
