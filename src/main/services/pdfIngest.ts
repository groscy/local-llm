import { PDFParse } from 'pdf-parse'

/** Cap CPU/time for very long PDFs; remaining pages are skipped. */
const PDF_MAX_PAGES = 250
/** Hard cap on stored text length after extraction. */
const PDF_MAX_CHARS = 900_000

export type PdfExtractDiagnostics = {
  parserWarnings: string[]
  truncated: boolean
  cleanupEdits: number
}

export type PdfExtractResult = {
  text: string
  diagnostics: PdfExtractDiagnostics
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
export async function extractPdfTextWithDiagnostics(buffer: Buffer): Promise<PdfExtractResult> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const parser = new PDFParse({ data })
  const warnings: string[] = []
  let truncated = false
  try {
    const result = await parser.getText({
      first: PDF_MAX_PAGES,
      pageJoiner: '\n\n',
      lineEnforce: true
    })
    if (typeof result.total === 'number' && result.total > PDF_MAX_PAGES) {
      warnings.push(`Only the first ${PDF_MAX_PAGES} pages were parsed.`)
    }
    let text = result.text ?? ''
    if (text.length > PDF_MAX_CHARS) {
      truncated = true
      warnings.push(`Text was truncated at ${PDF_MAX_CHARS} characters.`)
      text = `${text.slice(0, PDF_MAX_CHARS)}\n\n[… PDF text truncated for size …]`
    }
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
