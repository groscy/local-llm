## ADDED Requirements

### Requirement: Canonical 4-stage workflow is defined in shared
The system SHALL define a single canonical 4-stage workflow (`setup`, `operate_runtime`, `use_feature`, `validate_outcome`) in `src/shared/workflowModel.ts` as a read-only const accessible to both main and renderer processes.

#### Scenario: Shared import resolves in main and renderer
- **WHEN** `workflowModel.ts` is imported in a main-process service and in a renderer component
- **THEN** both resolve to the identical `CANONICAL_WORKFLOW_STAGES` array with the same stage IDs, labels, and icons

### Requirement: All UiRoles map to canonical stages
The `ROLE_WORKFLOW_MAP` SHALL assign `CANONICAL_WORKFLOW_STAGES` to every UiRole defined in the application; no role SHALL have a different stage count or order.

#### Scenario: Role workflow lookup returns canonical stages
- **WHEN** `ROLE_WORKFLOW_MAP['software_developer']` is accessed
- **THEN** the returned `stages` array equals `CANONICAL_WORKFLOW_STAGES` by reference or deep equality

#### Scenario: Unrecognized role handling
- **WHEN** code attempts to look up a role that does not exist in `ROLE_WORKFLOW_MAP`
- **THEN** TypeScript compilation fails with a type error (exhaustive key check via the `Record<UiRole, RoleWorkflow>` type annotation)

### Requirement: WorkflowStageStrip reflects active stage
The WorkflowStageStrip component SHALL read the current stage from `workflowStageForView(activeView)` and highlight the matching stage; clicking a navigable stage SHALL update `activeView` to the stage's canonical entry view.

#### Scenario: Active stage highlighted
- **WHEN** the user is on a view mapped to `use_feature` stage
- **THEN** the `use_feature` chip in WorkflowStageStrip has the active visual state and `setup` / `operate_runtime` chips show completed state

#### Scenario: Stage navigation
- **WHEN** the user clicks the `validate_outcome` stage chip
- **THEN** the active view transitions to the canonical entry view for `validate_outcome` (e.g., ReleaseReadinessView)
