import { PDFParse } from 'pdf-parse'

/** Cap CPU/time for very long PDFs; remaining pages are skipped. */
const PDF_MAX_PAGES = 250
/** Hard cap on stored text length after extraction. */
const PDF_MAX_CHARS = 900_000

/**
 * Extract plain text from a PDF buffer for knowledge-base ingestion (chunking + FTS + wiki).
 */
export async function extractPdfPlainText(buffer: Buffer): Promise<string> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const parser = new PDFParse({ data })
  try {
    const result = await parser.getText({
      first: PDF_MAX_PAGES,
      pageJoiner: '\n\n',
      lineEnforce: true
    })
    let text = (result.text ?? '').replace(/\r\n/g, '\n').trim()
    if (text.length > PDF_MAX_CHARS) {
      text = `${text.slice(0, PDF_MAX_CHARS)}\n\n[… PDF text truncated for size …]`
    }
    return text
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/** True if path should be read as PDF binary and parsed. */
export function isPdfFilePath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.pdf')
}
