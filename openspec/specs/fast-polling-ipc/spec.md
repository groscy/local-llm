## ADDED Requirements

### Requirement: Fast-path IPC channels skip heavy probes
`RUNTIME_STATUS_FAST`, `RUNTIME_INSTALL_PATH_FAST`, and `METRICS_SNAPSHOT_FAST` channels SHALL return cached or lightweight data without running GPU probes, file-system scans, or model validation that take longer than 50 ms.

#### Scenario: Fast status returns within budget
- **WHEN** the renderer calls `RUNTIME_STATUS_FAST` while a model is loading
- **THEN** the main process responds within 50 ms by returning the most recently cached status object without re-probing hardware

#### Scenario: Fast metrics returns within budget
- **WHEN** the renderer calls `METRICS_SNAPSHOT_FAST` at 1 Hz polling rate
- **THEN** the main process responds with the last cached snapshot and does not trigger a new metrics collection cycle

### Requirement: RuntimeProbeClass classifies IPC handler weight
Every IPC handler that performs hardware or file-system probes SHALL be annotated with a `RuntimeProbeClass` value (`fast_status`, `normal_status`, or `heavy_probe`) in its registration comment or type, so the weight of each channel is auditable.

#### Scenario: Fast channel annotation
- **WHEN** a developer reads the handler registered for `RUNTIME_STATUS_FAST`
- **THEN** they can identify from the registration site that this channel is classified `fast_status` and understand it MUST NOT call GPU or disk probes

### Requirement: Stale fast-channel data is surfaced to the user
The renderer SHALL display a "checking…" or equivalent staleness indicator when the most recent fast-channel response is older than 10 seconds, prompting a normal-status refresh.

#### Scenario: Stale fast-channel indicator
- **WHEN** 10 seconds elapse without a successful `RUNTIME_STATUS_FAST` response
- **THEN** the runtime status area in TopBarShell shows a staleness indicator until a fresh response arrives

#### Scenario: Normal refresh clears staleness
- **WHEN** a normal-status request (`RUNTIME_LIST` or `RUNTIME_INSTALL_PATH`) completes successfully after a stale period
- **THEN** the staleness indicator clears and the fresh data is displayed
