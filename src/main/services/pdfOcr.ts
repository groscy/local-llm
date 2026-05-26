import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { spawnSync } from 'child_process'

export type PdfOcrResult = {
  text: string
  pagesProcessed: number
  totalPagesDetected: number
  warnings: string[]
  engine: string
  pages: Array<{ text: string; confidence: number }>
}

export class PdfOcrTimeoutError extends Error {
  constructor(public readonly pageIndex: number, public readonly timeoutMs: number) {
    super(`OCR page ${pageIndex} exceeded timeout of ${timeoutMs} ms`)
    this.name = 'PdfOcrTimeoutError'
  }
}

function hasBinary(name: string, versionArgs: string[] = ['--version']): boolean {
  const probe = spawnSync(name, versionArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  return probe.status === 0 || !probe.error
}

function sortPagePngs(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const pageA = Number((a.match(/-(\d+)\.png$/i) ?? [])[1] ?? 0)
    const pageB = Number((b.match(/-(\d+)\.png$/i) ?? [])[1] ?? 0)
    return pageA - pageB
  })
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Best-effort OCR fallback for image-only or low-signal PDFs.
 * Requires local `pdftoppm` (Poppler) and `tesseract` binaries on PATH.
 */
export function extractPdfTextWithTrueOcrFallback(
  bytes: Uint8Array,
  maxPages = 60,
  pageTimeoutMs = 60_000
): PdfOcrResult | null {
  if (!hasBinary('pdftoppm') || !hasBinary('tesseract')) return null
  let tempDir = ''
  const warnings: string[] = []
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'kb-pdfocr-'))
    const inputPdfPath = join(tempDir, `${randomUUID()}.pdf`)
    const outputPrefix = join(tempDir, 'page')
    writeFileSync(inputPdfPath, bytes)

    const convert = spawnSync(
      'pdftoppm',
      ['-r', '220', '-f', '1', '-l', String(Math.max(1, maxPages)), '-png', inputPdfPath, outputPrefix],
      {
        encoding: 'utf8',
        shell: process.platform === 'win32'
      }
    )
    if (convert.status !== 0) {
      return {
        text: '',
        pagesProcessed: 0,
        totalPagesDetected: 0,
        warnings: ['true_ocr_pdftoppm_failed'],
        engine: 'tesseract-unavailable',
        pages: []
      }
    }

    const pngPaths = sortPagePngs(
      readdirSync(tempDir)
        .filter((name) => /^page-\d+\.png$/i.test(name))
        .map((name) => join(tempDir, name))
    )
    if (pngPaths.length === 0) {
      return {
        text: '',
        pagesProcessed: 0,
        totalPagesDetected: 0,
        warnings: ['true_ocr_no_rendered_pages'],
        engine: 'tesseract',
        pages: []
      }
    }
    if (pngPaths.length >= maxPages) warnings.push('true_ocr_page_limit_applied')

    const pageResults: Array<{ text: string; confidence: number }> = []
    for (const imgPath of pngPaths) {
      const outPrefix = join(tempDir, `ocr-${pageResults.length}`)
      const ocr = spawnSync(
        'tesseract',
        [imgPath, outPrefix, '-l', 'eng', '--psm', '6', 'txt', 'tsv'],
        { encoding: 'utf8', shell: process.platform === 'win32', timeout: pageTimeoutMs }
      )
      if (ocr.signal === 'SIGTERM' || (ocr.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
        throw new PdfOcrTimeoutError(pageResults.length, pageTimeoutMs)
      }
      if (ocr.status !== 0) {
        warnings.push('true_ocr_page_failed')
        continue
      }
      let text = ''
      try {
        text = normalizeOcrText(readFileSync(`${outPrefix}.txt`, 'utf8'))
      } catch {
        warnings.push('true_ocr_page_txt_read_failed')
      }
      let confidence = 0
      try {
        const tsv = readFileSync(`${outPrefix}.tsv`, 'utf8')
        const scores = tsv
          .split('\n')
          .slice(1)
          .map((line) => line.split('\t')[9])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n >= 0)
        confidence = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length / 100 : 0
      } catch {
        // tsv parse failure — leave confidence at 0
      }
      if (text) pageResults.push({ text, confidence })
    }

    return {
      text: normalizeOcrText(pageResults.map((p) => p.text).join('\n\n')),
      pagesProcessed: pageResults.length,
      totalPagesDetected: pngPaths.length,
      warnings,
      engine: 'pdftoppm+tesseract',
      pages: pageResults
    }
  } catch (err) {
    if (err instanceof PdfOcrTimeoutError) throw err
    return {
      text: '',
      pagesProcessed: 0,
      totalPagesDetected: 0,
      warnings: ['true_ocr_error'],
      engine: 'tesseract',
      pages: []
    }
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore temp cleanup failures
      }
    }
  }
}
