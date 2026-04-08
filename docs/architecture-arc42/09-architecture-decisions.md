# 9. Architecture Decisions

← [Index](./README.md) · Previous: [8. Cross-Cutting Concepts](./08-cross-cutting-concepts.md)

| ID | Decision | Alternatives | Rationale |
|----|------------|--------------|-----------|
| ADR-1 | SQLite + better-sqlite3 | LevelDB, JSON files | Relational model, FTS5, migrations, single file backup. |
| ADR-2 | RuntimeAdapter abstraction | Single llama-only integration | Users may prefer Ollama; keeps HTTP surface testable. |
| ADR-3 | Zod on main only | Shared runtime validation | Keeps renderer bundle smaller; trust boundary at IPC. |
| ADR-4 | electron-vite | Manual triple webpack | Fast HMR, aligned Vite config for three targets. |
| ADR-5 | Zip + no default code signing | Signed installers | Reduces Windows symlink/privilege issues in dev CI; reversible via builder config. |

→ Next: [10. Quality Requirements](./10-quality-requirements.md)
