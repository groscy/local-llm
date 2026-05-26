import { randomUUID } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { extractPdfTextWithDiagnostics, isPdfFilePath, type PdfExtractDiagnostics } from './pdfIngest'
import { extractPdfTextWithTrueOcrFallback } from './pdfOcr'

export type ParsedDocumentSection = {
  heading?: string
  body: string
  pageStart?: number
  pageEnd?: number
}

export type ParsedDocument = {
  format: 'pdf' | 'text' | 'html'
  sourceKind: 'pdf' | 'text'
  rawText: string
  normalizedText: string
  sections: ParsedDocumentSection[]
  warnings: string[]
  parserEngine: string
  parserMode: 'text_layer' | 'pdftotext_fallback' | 'true_ocr_fallback' | 'hybrid_merged' | 'plain_text' | 'html_text'
  parseDurationMs: number
  ocrApplied: boolean
  ocrCoverage: number
  extractionVersion: string
  parserDiagnostics?: PdfExtractDiagnostics
}

type ParseInput = {
  fileName: string
  bytes: Uint8Array
  mimeType?: string
  onPdfPageProgress?: (progress: { processedPages: number; totalPages: number; pagesLeft: number }) => void
}

const PARSER_VERSION = 'document-parser-v3.local.2026-05-25'

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function splitSections(text: string): ParsedDocumentSection[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const lines = normalized.split('\n')
  const sections: ParsedDocumentSection[] = []
  let heading: string | undefined
  let chunk: string[] = []
  const flush = (): void => {
    const body = chunk.join('\n').trim()
    if (!body) return
    sections.push({ heading, body })
    chunk = []
  }
  for (const line of lines) {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (h) {
      flush()
      heading = h[1]?.trim() || undefined
      continue
    }
    chunk.push(line)
  }
  flush()
  return sections.length ? sections : [{ body: normalized }]
}

function likelyHtml(text: string, ext: string, mimeType?: string): boolean {
  const mime = (mimeType ?? '').toLowerCase()
  if (ext === '.html' || ext === '.htm') return true
  if (mime.includes('text/html')) return true
  return /<\s*html[\s>]|<\s*body[\s>]|<\s*div[\s>]/i.test(text.slice(0, 1200))
}

function htmlToText(html: string): string {
  let out = html
  out = out.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  out = out.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  out = out.replace(/<br\s*\/?>/gi, '\n')
  out = out.replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
  out = out.replace(/<[^>]+>/g, ' ')
  out = out
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
  out = out.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
  return normalizeText(out)
}

function lowSignalPdfText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  const alpha = (trimmed.match(/[A-Za-z]/g) ?? []).length
  const spaces = (trimmed.match(/\s/g) ?? []).length
  const len = trimmed.length
  if (len < 80) return true
  const alphaRatio = alpha / Math.max(1, len)
  const spaceRatio = spaces / Math.max(1, len)
  return alphaRatio < 0.45 || spaceRatio < 0.08
}

function attemptPdfToTextFallback(bytes: Uint8Array): { text: string; warning?: string } | null {
  const probe = spawnSync('pdftotext', ['-v'], { encoding: 'utf8', shell: process.platform === 'win32' })
  if (probe.status !== 0 && probe.error) return null
  let tempDir = ''
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'kb-pdftotext-'))
    const inPath = join(tempDir, `${randomUUID()}.pdf`)
    const outPath = join(tempDir, `${randomUUID()}.txt`)
    writeFileSync(inPath, bytes)
    const run = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', inPath, outPath], {
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
    if (run.status !== 0) {
      return {
        text: '',
        warning: 'pdf_to_text_fallback_failed'
      }
    }
    const text = normalizeText(readFileSync(outPath, 'utf8'))
    if (!text) {
      return {
        text: '',
        warning: 'pdf_to_text_fallback_empty'
      }
    }
    return {
      text,
      warning: 'pdf_text_layer_low_signal_fallback_used'
    }
  } catch {
    return {
      text: '',
      warning: 'pdf_to_text_fallback_error'
    }
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ignore temp cleanup errors */
      }
    }
  }
}

function layoutAwareSectionsFromPages(
  pages: Array<{ page: number; text: string }>,
  fallbackText: string
): ParsedDocumentSection[] {
  const sections: ParsedDocumentSection[] = []
  for (const page of pages) {
    const body = normalizeText(page.text)
    if (!body) continue
    sections.push({
      heading: `Page ${page.page}`,
      body,
      pageStart: page.page,
      pageEnd: page.page
    })
  }
  if (sections.length > 0) return sections
  return splitSections(fallbackText)
}

export async function parseDocumentFromBytes(input: ParseInput): Promise<ParsedDocument> {
  const startedAt = Date.now()
  const ext = extname(input.fileName).toLowerCase()
  const mime = (input.mimeType ?? '').toLowerCase()
  const bytes = Buffer.from(input.bytes)
  if (isPdfFilePath(input.fileName) || mime === 'application/pdf') {
    const result = await extractPdfTextWithDiagnostics(bytes, input.onPdfPageProgress)
    let rawText = result.text
    const warnings = [...result.diagnostics.parserWarnings]
    let parserMode: ParsedDocument['parserMode'] = 'text_layer'
    let ocrApplied = false
    let ocrCoverage = 0
    let parserEngine = 'pdf-parse'
    const textLayer = rawText
    const isLowSignal = lowSignalPdfText(textLayer)
    if (isLowSignal) {
      const pdftotextFallback = attemptPdfToTextFallback(input.bytes)
      let pdftotextText = ''
      if (pdftotextFallback?.text) {
        pdftotextText = pdftotextFallback.text
        rawText = pdftotextText
        parserMode = 'pdftotext_fallback'
        parserEngine = 'pdf-parse+pdftotext'
      }
      if (pdftotextFallback?.warning) warnings.push(pdftotextFallback.warning)
      if (!pdftotextFallback || !pdftotextFallback.text) warnings.push('pdftotext_unavailable_or_failed')

      const ocr = extractPdfTextWithTrueOcrFallback(input.bytes)
      if (ocr?.warnings?.length) warnings.push(...ocr.warnings)
      const ocrText = normalizeText(ocr?.text ?? '')
      if (ocr && ocrText) {
        ocrApplied = true
        ocrCoverage = ocr.pagesProcessed > 0 ? Math.min(1, ocr.pagesProcessed / Math.max(1, ocr.totalPagesDetected)) : 0
        if (textLayer && textLayer.length > 120 && !lowSignalPdfText(textLayer)) {
          rawText = normalizeText(`${textLayer}\n\n${ocrText}`)
          parserMode = 'hybrid_merged'
          parserEngine = `pdf-parse+${ocr.engine}+hybrid`
        } else if (pdftotextText && pdftotextText.length > 120) {
          rawText = normalizeText(`${pdftotextText}\n\n${ocrText}`)
          parserMode = 'hybrid_merged'
          parserEngine = `pdf-parse+pdftotext+${ocr.engine}`
        } else {
          rawText = ocrText
          parserMode = 'true_ocr_fallback'
          parserEngine = ocr.engine
        }
      } else if (!pdftotextText) {
        warnings.push('true_ocr_unavailable_or_failed')
      }
    }
    const normalizedText = normalizeText(rawText)
    return {
      format: 'pdf',
      sourceKind: 'pdf',
      rawText,
      normalizedText,
      sections: layoutAwareSectionsFromPages(result.pages, normalizedText),
      warnings,
      parserEngine,
      parserMode,
      parseDurationMs: Date.now() - startedAt,
      ocrApplied,
      ocrCoverage,
      extractionVersion: PARSER_VERSION,
      parserDiagnostics: result.diagnostics
    }
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes)
  const asHtml = likelyHtml(decoded, ext, input.mimeType)
  const rawText = asHtml ? htmlToText(decoded) : normalizeText(decoded)
  return {
    format: asHtml ? 'html' : 'text',
    sourceKind: 'text',
    rawText,
    normalizedText: rawText,
    sections: splitSections(rawText),
    warnings: [],
    parserEngine: asHtml ? 'html-cleanup' : 'utf8',
    parserMode: asHtml ? 'html_text' : 'plain_text',
    parseDurationMs: Date.now() - startedAt,
    ocrApplied: false,
    ocrCoverage: 0,
    extractionVersion: PARSER_VERSION
  }
}

export async function parseDocumentFromFile(input: {
  filePath: string
  mimeType?: string
  onPdfPageProgress?: (progress: { processedPages: number; totalPages: number; pagesLeft: number }) => void
}): Promise<ParsedDocument> {
  const bytes = readFileSync(input.filePath)
  return await parseDocumentFromBytes({
    fileName: input.filePath,
    bytes,
    mimeType: input.mimeType,
    onPdfPageProgress: input.onPdfPageProgress
  })
}
