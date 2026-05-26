## ADDED Requirements

### Requirement: Uncertain candidates are refined via runtime when available
`ingestOrchestrator.ingestRecord` SHALL call `refineUncertainCandidatesWithRuntime` when a `RuntimeAdapter` is provided and its status is `running`; it SHALL fall back to `refineUncertainCandidatesHeuristic` when no runtime is supplied or the runtime is not running.

#### Scenario: Runtime refinement used when runtime is running
- **WHEN** `ingestRecord` is called with a `RuntimeAdapter` whose `getStatus().running === true`
- **THEN** `refineUncertainCandidatesWithRuntime` is called and its result replaces the heuristic output for the uncertain candidates

#### Scenario: Heuristic fallback when runtime is absent
- **WHEN** `ingestRecord` is called with `options.runtime === null` or `options.runtime === undefined`
- **THEN** `refineUncertainCandidatesHeuristic` is used and no LLM call is made

#### Scenario: Heuristic fallback when runtime is not running
- **WHEN** `ingestRecord` is called with a `RuntimeAdapter` whose `getStatus().running === false`
- **THEN** `refineUncertainCandidatesWithRuntime` returns `null` and the orchestrator uses the heuristic result without error

### Requirement: LLM refinement is bounded to a candidate cap
`refineUncertainCandidatesWithRuntime` SHALL process at most 24 uncertain entities, 18 uncertain relations, and 18 uncertain descriptors per call; excess candidates SHALL be passed through unchanged using heuristic refinement.

#### Scenario: Cap enforced on large document
- **WHEN** a document produces more than 24 uncertain entities
- **THEN** only the first 24 are sent to the LLM; entities beyond the cap are refined by heuristic and merged into the final result

### Requirement: Invalid LLM JSON is handled gracefully
If the runtime returns a response that cannot be parsed as valid JSON matching the expected shape, the orchestrator SHALL log a warning and fall back to the heuristic result; it SHALL NOT throw or fail the ingest operation.

#### Scenario: Malformed LLM response
- **WHEN** the runtime returns a non-JSON string for the refinement prompt
- **THEN** the ingest record is still written using heuristic-refined candidates, and a warning is emitted with the raw response excerpt

#### Scenario: Partial JSON response
- **WHEN** the runtime returns JSON missing one of the expected keys (`entities`, `relations`, `descriptors`)
- **THEN** the missing key's candidates are refined by heuristic; present keys use the LLM result

### Requirement: ingestRecord is async
`IngestOrchestrator.ingestRecord` SHALL return `Promise<IngestBatchResult>` to accommodate the async LLM refinement path; callers that previously called it synchronously MUST await the result.

#### Scenario: Async contract at call sites
- **WHEN** `ingestRecord` is called at all registered call sites in the codebase
- **THEN** every call site uses `await` or chains `.then()`; TypeScript compilation fails if a call site drops the Promise
