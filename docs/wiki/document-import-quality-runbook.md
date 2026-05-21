# Document Import Quality Runbook

## Benchmark corpus

Use a fixed local corpus grouped by failure mode:

- `pdf/native-text/` - digitally generated PDFs with selectable text.
- `pdf/scanned/` - image-based scans and photocopies.
- `pdf/layout/` - multi-column and table-heavy documents.
- `pdf/noisy/` - malformed, encrypted, or truncated PDFs.
- `html-and-markdown/` - mixed markup quality and heading structures.

Each file should include a small golden annotation JSON:

- `expectedEntities` (canonical labels)
- `expectedRelations` (`from`, `predicate`, `to`)
- `mustReject` (known noisy labels)

## Acceptance thresholds

- Entity precision: `>= 0.82`
- Entity recall: `>= 0.72`
- Relation precision: `>= 0.76`
- Relation recall: `>= 0.62`
- Noisy keyword rate (`mustReject` false positives): `<= 0.08`
- Parser hard-failure rate on supported formats: `<= 0.03`

## Regression checks

Run these before enabling new extraction defaults:

1. Parser tests (`documentParser.spec.ts`, PDF ingest specs).
2. DMS parity checks (`dmsSyncOrchestrator.spec.ts`) for source-type and diagnostics.
3. Graph quality-gate tests (`graphWriteService.spec.ts`) for reject-path coverage.
4. Wiki layout snapshot/manual checks at `1280px`, `900px`, `640px`.

## Rollout strategy

1. **Shadow mode**
   - Run extraction v2 and quality gates.
   - Keep current graph writes active.
   - Compare deltas in node/edge count and rejection reasons.
2. **PDF-first enablement**
   - Enable v2 for file upload PDFs.
   - Monitor confidence reasons and `semantic_rejection_events`.
3. **DMS PDF enablement**
   - Enable shared parser+quality path for DMS imported PDFs.
4. **Global enablement**
   - Turn on v2 for all text/html imports once thresholds hold.

## Backfill strategy

- Reprocess existing `kb_sources` in descending recency batches.
- Skip sources that already have matching `extraction_version`.
- Persist run metadata in `kb_documents.extraction_version`.
- If quality degrades for a source, keep prior distilled body and annotate rejection reasons.

## Operational triage

When quality drops:

1. Inspect `semantic_rejection_events` for clustered rejection reasons.
2. Review `kb_documents.diagnostics_json` for parser warnings and OCR fallback usage.
3. Validate whether noise came from parser output or extraction rules.
4. Adjust blocklist/thresholds, rerun corpus, and compare precision/recall before release.
