# 10. Quality Requirements — Scenarios

← [Index](./README.md) · Previous: [9. Architecture Decisions](./09-architecture-decisions.md)

| Scenario | Expectation | Implementation hint |
|----------|---------------|----------------------|
| App restart after crash | No DB corruption beyond last transaction | WAL mode, atomic migrations |
| Large model download | Resumable / cancellable | Download registry + HF client |
| Token leak | Not in renderer disk | Memory + safeStorage; not in logs intentionally |
| KB search | Sub-second for typical corpora | FTS5 + indexes on `kb_chunks` |

→ Next: [11. Risks and Technical Debt](./11-risks-and-technical-debt.md)
