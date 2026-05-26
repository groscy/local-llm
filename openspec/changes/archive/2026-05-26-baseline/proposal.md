## Why

The `feature/cross-cutting-bigbang` branch accumulated six distinct cross-cutting improvements without a stable, reviewable baseline — monolithic files grew unwieldy, polling paths were expensive, and there was no shared workflow model. This change stabilizes the branch as a coherent, testable baseline before further feature work begins.

## What Changes

- **IPC module split**: `registerIpc.ts` (828-line delta) decomposed into domain modules: `registerCodebaseIpc.ts`, `registerIntegrationIpc.ts`, `registerRuntimeMetricsIpc.ts`, `registerTrainingIpc.ts`
- **App-shell extraction**: `App.tsx` refactored to extract shell-level UI into `src/renderer/app-shell/` (NavRail, TopBarShell, WorkflowStageStrip, WelcomeChecklistModal, DeleteConversationModal, and helpers)
- **Workflow model**: New `src/shared/workflowModel.ts` introduces a canonical 4-stage workflow (`setup → operate_runtime → use_feature → validate_outcome`) shared across all UiRoles
- **Fast-polling IPC channels**: `RUNTIME_STATUS_FAST`, `RUNTIME_INSTALL_PATH_FAST`, `METRICS_SNAPSHOT_FAST` channels + `RuntimeProbeClass` type keep heavy probes off high-frequency polling paths
- **PDF OCR pipeline**: New `pdfOcr.ts` service; `KbImportDiagnostic.parserMode` extended with `pdftotext_fallback`, `true_ocr_fallback`, `hybrid_merged` variants
- **LLM entity refinement**: `ingestOrchestrator.ts` gains `refineUncertainCandidatesWithRuntime` — runtime-assisted refinement of low-confidence ontology candidates, falling back to heuristic when no runtime is available
- **Document import benchmarks**: `documentImportBenchmark.ts` + spec for measuring ingest throughput and quality
- New DB migrations for ontology and metrics schema additions

## Capabilities

### New Capabilities
- `app-shell-layout`: Extracted shell UI components (NavRail, TopBar, WorkflowStageStrip) and routing helpers; clears the path for independent shell evolution
- `workflow-model`: Canonical 4-stage workflow model shared across roles; drives WorkflowStageStrip and view-copy derivation
- `fast-polling-ipc`: Fast-path IPC channels and `RuntimeProbeClass` classification; decouples high-frequency UI polling from expensive runtime probes
- `pdf-ocr-pipeline`: Multi-mode PDF parsing with OCR fallback; `parserMode` now reflects actual strategy used
- `llm-entity-refinement`: Runtime-assisted refinement of uncertain ontology candidates in the ingest pipeline

### Modified Capabilities
- None — no existing spec-level contracts are changing; this change introduces specs where none existed.

## Impact

- **Code**: `src/main/ipc/` (new domain modules), `src/renderer/app-shell/` (new shell package), `src/shared/workflowModel.ts`, `src/main/services/ingestOrchestrator.ts`, `src/main/services/pdfIngest.ts`, `src/main/services/pdfOcr.ts`, `src/main/services/documentImportBenchmark.ts`
- **Shared contracts**: `src/shared/ipc.ts` (new channels + `RuntimeProbeClass`), `src/shared/types.ts` (`KbImportDiagnostic.parserMode` extended)
- **DB**: New migrations in `src/main/db/migrations.ts`
- **Tests**: `documentParser.spec.ts`, `pdfIngest.spec.ts`, `documentImportBenchmark.spec.ts` updated/added
- **Dependencies**: No new npm packages
