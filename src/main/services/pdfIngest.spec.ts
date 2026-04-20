import { describe, expect, it } from 'vitest'
import { isPdfFilePath } from './pdfIngest'

describe('isPdfFilePath', () => {
  it('detects .pdf case-insensitively', () => {
    expect(isPdfFilePath('C:\\docs\\X.PDF')).toBe(true)
    expect(isPdfFilePath('/home/a.pdf')).toBe(true)
    expect(isPdfFilePath('note.md')).toBe(false)
  })
})
