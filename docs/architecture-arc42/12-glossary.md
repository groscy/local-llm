# 12. Glossary

← [Index](./README.md) · Previous: [11. Risks and Technical Debt](./11-risks-and-technical-debt.md)

| Term | Meaning |
|------|---------|
| **Arc42** | Template for architecture documentation. |
| **FTS5** | SQLite full-text search extension used for KB chunk search. |
| **HF** | Hugging Face Hub (models and files API). |
| **IPC** | Inter-process communication between renderer and main in Electron. |
| **RAG** | Retrieval-augmented generation: inject retrieved KB text into model context. |
| **RuntimeAdapter** | TypeScript interface abstracting llama.cpp server vs Ollama. |
| **Resident memory** | Process working set (often from `VmRSS` / `memoryUsage().rss`); shown in metrics instead of the abbreviation RSS. |
| **Integration server** | Main-process `http.Server` on **127.0.0.1** exposing `/health` and `/v1/*` for IDEs and scripts. |
| **num_predict / max_tokens** | Ollama vs OpenAI-compatible completion caps; both driven by **chatMaxTokens** in settings. |
| **WAL** | Write-ahead logging SQLite journal mode for concurrency and crash safety. |

[← Back to index](./README.md)
