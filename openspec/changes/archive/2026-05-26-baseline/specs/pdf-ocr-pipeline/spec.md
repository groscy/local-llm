## ADDED Requirements

### Requirement: parserMode reflects actual parse strategy
`KbImportDiagnostic.parserMode` SHALL be set to one of the named strategy values that reflects the actual path taken during parsing: `text_layer`, `pdftotext_fallback`, `true_ocr_fallback`, `hybrid_merged`, `plain_text`, or `html_text`. The field MUST NOT be omitted when a PDF is processed.

#### Scenario: Text layer extraction
- **WHEN** a PDF has an extractable text layer and no OCR is needed
- **THEN** `parserMode` is set to `text_layer` and `ocrApplied` is `false`

#### Scenario: pdftotext fallback
- **WHEN** native text extraction fails and the `pdftotext` CLI tool is used
- **THEN** `parserMode` is set to `pdftotext_fallback` and `ocrApplied` is `false`

#### Scenario: True OCR fallback
- **WHEN** no text layer exists and pixel-level OCR is applied
- **THEN** `parserMode` is set to `true_ocr_fallback` and `ocrApplied` is `true`

#### Scenario: Hybrid merged
- **WHEN** text layer extraction is merged with OCR corrections for low-confidence regions
- **THEN** `parserMode` is set to `hybrid_merged`, `ocrApplied` is `true`, and `ocrCoverage` reflects the fraction of pages where OCR contributed

### Requirement: pdfOcr service encapsulates pixel-level OCR
The `pdfOcr.ts` service SHALL provide a function that accepts a PDF path and returns page-level text with per-page confidence scores; it SHALL NOT depend on `pdfIngest.ts` to avoid circular dependencies.

#### Scenario: OCR returns confidence per page
- **WHEN** `pdfOcr` processes a scanned PDF with 3 pages
- **THEN** the result contains 3 entries, each with `text` and `confidence` (0.0–1.0)

#### Scenario: OCR timeout safety
- **WHEN** OCR processing exceeds a configurable timeout (default 60 s per page)
- **THEN** the service rejects with a `PdfOcrTimeoutError` and the caller records `true_ocr_fallback` with partial coverage

### Requirement: Import diagnostics expose parser mode via IPC
The `KbIngestFileProgress` event emitted during import SHALL include `parserMode` so the renderer can display the active parse strategy in import progress UI.

#### Scenario: Progress event includes parserMode
- **WHEN** the renderer listens to KB ingest progress events for a PDF import
- **THEN** each progress event where parsing is complete includes a non-null `parserMode` field matching one of the allowed values
