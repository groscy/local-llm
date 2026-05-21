import { PDFParse } from 'pdf-parse'

export type PdfExtractDiagnostics = {
  parserWarnings: string[]
  truncated: boolean
  cleanupEdits: number
}

export type PdfExtractResult = {
  text: string
  diagnostics: PdfExtractDiagnostics
}

export type PdfPageProgress = {
  processedPages: number
  totalPages: number
  pagesLeft: number
}

function cleanupPdfText(input: string): { text: string; edits: number } {
  let text = input
  let edits = 0
  const apply = (next: string): void => {
    if (next !== text) edits++
    text = next
  }

  apply(text.replace(/\r\n/g, '\n'))
  // Repair words broken by hyphenated line wraps.
  apply(text.replace(/([A-Za-z])-\n([a-z])/g, '$1$2'))
  // Join hard line-wraps that split a sentence mid-flow.
  apply(text.replace(/([^\n.!?:;])\n([a-z0-9(])/g, '$1 $2'))
  // Collapse accidental spacing noise while preserving paragraph breaks.
  apply(text.replace(/[ \t]+\n/g, '\n'))
  apply(text.replace(/\n{3,}/g, '\n\n'))
  apply(text.replace(/[ \t]{2,}/g, ' '))

  return { text: text.trim(), edits }
}

/**
 * Extract plain text from a PDF buffer for knowledge-base ingestion (chunking + FTS + wiki).
 */
export async function extractPdfTextWithDiagnostics(
  buffer: Buffer,
  onPageProgress?: (progress: PdfPageProgress) => void
): Promise<PdfExtractResult> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const parser = new PDFParse({ data })
  const warnings: string[] = []
  let truncated = false
  try {
    const meta = await parser.getText({
      first: 1,
      last: 1,
      pageJoiner: '\n\n',
      lineEnforce: true
    })
    const totalDetected = typeof meta.total === 'number' && Number.isFinite(meta.total) ? Math.max(1, Math.floor(meta.total)) : 1
    const totalPages = totalDetected

    const pages: string[] = [meta.text ?? '']
    onPageProgress?.({ processedPages: 1, totalPages, pagesLeft: Math.max(0, totalPages - 1) })

    for (let page = 2; page <= totalPages; page++) {
      const one = await parser.getText({
        first: page,
        last: page,
        pageJoiner: '\n\n',
        lineEnforce: true
      })
      pages.push(one.text ?? '')
      onPageProgress?.({ processedPages: page, totalPages, pagesLeft: totalPages - page })
    }

    const text = pages.join('\n\n').trim()
    const cleaned = cleanupPdfText(text)
    return {
      text: cleaned.text,
      diagnostics: { parserWarnings: warnings, truncated, cleanupEdits: cleaned.edits }
    }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

export async function extractPdfPlainText(buffer: Buffer): Promise<string> {
  const result = await extractPdfTextWithDiagnostics(buffer)
  return result.text
}

/** True if path should be read as PDF binary and parsed. */
export function isPdfFilePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf')
}
