## 1. App-Shell Layout

- [x] 1.1 Audit `src/renderer/app-shell/` imports — verify no file imports from view-level modules (KeywordGraphSigmaView, TrainMainView, OntologyView, etc.); fix any violations
- [x] 1.2 Verify views removed from eager imports in `App.tsx` (KeywordGraphSigmaView, OntologyView, TrainMainView, ArchitectureRepositoryView, CodebaseLandscapeView, ElectronDevDashboard) are wrapped in `React.lazy()` with `<Suspense>` boundaries
- [x] 1.3 Confirm WorkflowStageStrip click handler updates `activeView` to the canonical entry view for the clicked stage (wired in `App.tsx` via `workflowStageForView`)

## 2. Workflow Model

- [x] 2.1 Verify `ROLE_WORKFLOW_MAP` uses `Record<UiRole, RoleWorkflow>` type annotation so TypeScript fails on missing roles
- [x] 2.2 Add a compile-time test (type assertion) in `workflowModel.ts` that all `UiRole` values are present as keys in `ROLE_WORKFLOW_MAP`
- [x] 2.3 Validate `workflowStageForView` covers all `AppMainView` values — add a `default` branch returning `'use_feature'` if missing

## 3. Fast-Polling IPC

- [x] 3.1 Add `RuntimeProbeClass` annotation comments to each handler in `registerRuntimeMetricsIpc.ts` (`fast_status`, `normal_status`, or `heavy_probe`)
- [x] 3.2 Implement 10-second staleness detection in the renderer: track last successful `RUNTIME_STATUS_FAST` response timestamp; show a "checking…" indicator in TopBarRuntimeControls when > 10 s elapsed
- [x] 3.3 Wire the staleness indicator clear: on successful `RUNTIME_LIST` or `RUNTIME_INSTALL_PATH` response, reset the stale timestamp

## 4. PDF OCR Pipeline

- [x] 4.1 Add per-page confidence output to `pdfOcr.ts`: extend `PdfOcrResult` with a `pages: Array<{ text: string; confidence: number }>` field populated from Tesseract confidence scores
- [x] 4.2 Add timeout safety to `pdfOcr.ts`: define and export `PdfOcrTimeoutError`; apply a configurable per-page timeout (default 60 s) to the OCR subprocess; reject with `PdfOcrTimeoutError` on breach
- [x] 4.3 Verify `KbIngestFileProgress` events emitted during PDF import include a non-null `parserMode` — check `kbService.ts` progress event construction and add the field if missing
- [x] 4.4 Add `documentParser.spec.ts` test cases for `pdftotext_fallback`, `true_ocr_fallback`, and `hybrid_merged` modes (mock pdfOcr and pdftotext paths)

## 5. LLM Entity Refinement

- [x] 5.1 Verify candidate cap is enforced in `refineUncertainCandidatesWithRuntime`: assert slices of 24 / 18 / 18 are applied before the LLM call; add a unit test
- [x] 5.2 Add graceful handling for partial JSON response: if LLM returns an object missing `entities`, `relations`, or `descriptors` key, fill missing keys with heuristic results
- [x] 5.3 Add unit test for invalid (non-JSON) LLM response: expect heuristic fallback result with warning logged, no thrown error
- [x] 5.4 Verify all `ingestRecord` call sites in the codebase `await` the result — run `grep -rn "\.ingestRecord("` and confirm no unawaited call exists

## 6. Tests and Verification

- [x] 6.1 Run `npm test` (or equivalent) to confirm `documentParser.spec.ts` and `pdfIngest.spec.ts` pass on the branch
- [x] 6.2 Run TypeScript compilation (`tsc --noEmit`) and fix any new type errors introduced by the `ingestRecord` async change
- [x] 6.3 Mark `documentImportBenchmark.spec.ts` with `describe.skip` if not already skipped, and add a comment noting it's excluded from CI pending benchmark infrastructure decision
- [x] 6.4 Verify the new DB migrations in `migrations.ts` are additive (new columns with defaults only) — confirm no `ALTER COLUMN ... NOT NULL` or `DROP COLUMN` operations
