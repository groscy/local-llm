## Context

`feature/cross-cutting-bigbang` accumulated six cross-cutting improvements simultaneously: IPC decomposition, renderer shell extraction, a shared workflow model, fast-polling IPC channels, multi-mode PDF OCR, and runtime-assisted ontology refinement. The branch is functional but lacks specs, a coherent narrative, and test coverage for the new surfaces. Before adding further feature work, this change establishes a validated baseline by capturing design decisions and acceptance criteria.

Current pain points driving this:
- `registerIpc.ts` was a 700+ line monolith; new domain modules split it but the boundary rationale wasn't documented.
- `App.tsx` grew to 1000+ lines; the `app-shell/` extraction helps but components need clear contracts.
- High-frequency UI polling hit the same IPC paths as heavy probes (model probes, file-system scans), causing visible UI jank on slower machines.
- PDF parse failures were logged with a single `ocr_fallback` label regardless of which fallback strategy ran.

## Goals / Non-Goals

**Goals:**
- Document the architectural decisions already made on the branch so reviewers and future contributors have context
- Define acceptance criteria (specs) for each capability so implementation gaps are visible
- Establish fast/slow polling boundary so future IPC additions land in the right tier
- Provide a reviewable baseline before iterating on any individual capability

**Non-Goals:**
- Introducing new features or UI surfaces not already on the branch
- Redesigning the IPC protocol or switching to a different inter-process mechanism
- Changing the LLM runtime interface beyond what `refineUncertainCandidatesWithRuntime` already uses
- Completing the document import benchmark suite (the benchmark harness is scaffolded; full results are future work)

## Decisions

### IPC domain split

**Decision**: Split `registerIpc.ts` into four domain modules (`registerCodebaseIpc.ts`, `registerIntegrationIpc.ts`, `registerRuntimeMetricsIpc.ts`, `registerTrainingIpc.ts`) plus a slimmed core file.

**Rationale**: Each domain has distinct dependencies (DB access, runtime adapter, integration bridge). A single file forced all imports to co-exist and made it impossible to test domains independently. Domain modules can be imported and mocked in isolation.

**Alternative considered**: Namespace objects within one file. Rejected — TypeScript type inference for IPC handler return types degrades with deeply nested objects, and file-level code-splitting is simpler to navigate.

### App-shell extraction

**Decision**: Extract `NavRail`, `TopBarShell`, `WorkflowStageStrip`, `WelcomeChecklistModal`, and `DeleteConversationModal` into `src/renderer/app-shell/`.

**Rationale**: These components are stable chrome — they do not depend on the active view's data. Co-locating them in one package makes it clear that they interact only through the workflow model and view-routing state, not view-specific services.

**Alternative considered**: Keep inline in `App.tsx`. Rejected — `App.tsx` was already 1000+ lines with no internal structure; merging in more components would make review impractical.

### Workflow model as shared contract

**Decision**: Define the 4-stage workflow (`setup → operate_runtime → use_feature → validate_outcome`) in `src/shared/workflowModel.ts` as a read-only const, imported by both main and renderer.

**Rationale**: WorkflowStageStrip and view-copy helpers both need stage metadata. Defining it in `shared/` avoids duplication and ensures the renderer and any future CLI tooling agree on stage IDs.

**Alternative considered**: Define per-role workflows with different stage sets. Rejected — all current roles map to the same 4 stages; diverging stage sets would require conditional rendering throughout the shell for no current benefit.

### Fast-polling IPC tier

**Decision**: Add `*_FAST` channel variants for runtime status and metrics; classify probe weight via `RuntimeProbeClass`.

**Rationale**: The renderer polls runtime status every ~1 s while a model is loading. Running GPU probes and file-system scans on each poll causes observable CPU spikes. `FAST` channels return cached/stale data, reserving heavy probes for explicit user actions or a low-frequency background refresh.

**Alternative considered**: Debounce on the renderer side only. Rejected — the main process still ran the expensive probes on every IPC call regardless of debounce; the fix must be at the handler boundary.

### Named PDF parser modes

**Decision**: Extend `KbImportDiagnostic.parserMode` with `pdftotext_fallback`, `true_ocr_fallback`, and `hybrid_merged` instead of inferring strategy from `ocrApplied` flag.

**Rationale**: Operators debugging import quality need to know which strategy ran (e.g., `hybrid_merged` means a text-layer extraction was merged with OCR corrections). A boolean `ocrApplied` cannot distinguish `pdftotext_fallback` (CLI tool, no pixel rendering) from `true_ocr_fallback` (full OCR, no text layer).

**Alternative considered**: Add a separate `ocrStrategy` field. Rejected — `parserMode` already semantically owns "what path was taken"; adding a second field creates a documentation burden to explain when they diverge.

### Runtime adapter for LLM refinement

**Decision**: `refineUncertainCandidatesWithRuntime` accepts a `RuntimeAdapter` parameter rather than calling any LLM SDK directly.

**Rationale**: The runtime may be Ollama, LlamaCpp, or absent. Injecting the adapter keeps the ingest pipeline testable without a real runtime and lets future runtimes participate without modifying orchestrator code.

**Alternative considered**: Feature-flag-gate the LLM call and use a singleton runtime service. Rejected — singletons make unit testing ingest logic require a running runtime process.

## Risks / Trade-offs

- **Large diff, regression surface** → Mitigation: existing `documentParser.spec.ts` and `pdfIngest.spec.ts` tests run unchanged; new benchmark spec covers the ingest path end-to-end.
- **`App.tsx` routing regressions** → Mitigation: `clampMainViewForLayout` and `isAdvancedMainView` helpers preserve existing routing guards; removed imports are lazy-loaded views that remain accessible via route.
- **Fast channels returning stale data** → Mitigation: fast channels document their maximum staleness (cache TTL) in the `RuntimeProbeClass` type docs; the renderer shows a "checking…" state when the last fast-channel response is older than 10 s.
- **Workflow model hard-coded to 4 stages** → Mitigation: `CANONICAL_WORKFLOW_STAGES` is a const array; adding role-specific overrides requires only a new `RoleWorkflow` entry, no structural change.

## Migration Plan

All changes are additive or refactors with identical runtime behavior:
1. Deploy as a normal PR merge — no DB migrations require downtime (migrations are additive: new columns with defaults).
2. Old IPC channel names remain registered in the slimmed `registerIpc.ts` for the release cycle; domain modules register new channels only.
3. No rollback step needed — feature is not gated; reverting the PR restores the previous state.

## Open Questions

- Should `documentImportBenchmark.spec.ts` run in CI or remain a manual benchmark? (Currently excluded from the default test run via `describe.skip`.)
- Is 10 s the right staleness threshold for fast-channel UI feedback? Needs validation against user perception testing.
