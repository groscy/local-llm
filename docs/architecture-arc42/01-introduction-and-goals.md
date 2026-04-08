# 1. Introduction and Goals

← [Index](./README.md)

## 1.1 Requirements Overview

Local LLM Desktop is a cross-platform **Electron** application that lets users:

- **Discover and download** Hugging Face model files into a local models directory.
- **Run inference** via a pluggable **runtime**: local **llama.cpp** server or **Ollama**.
- **Chat** with persisted conversations and optional **RAG** over a local knowledge base (chunking + SQLite FTS5 + wiki-style navigation).
- **Observe** coarse **metrics** (runtime throughput, process CPU/RSS, optional GPU memory).
- **Optionally train** small LoRA jobs via an external **Python** script shipped as an app resource.

Stakeholder goals:


| Goal              | Rationale                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Local-first       | Models and knowledge stay on disk under user control; network used mainly for HF and optional cloud APIs.            |
| Single desktop UX | One window, React UI, no separate server install required for core flows (except user-provided Ollama/llama binary). |
| Extensibility     | `RuntimeAdapter` isolates llama.cpp vs Ollama; IPC channel list is the integration surface for new features.         |


## 1.2 Quality Goals


| Priority | Quality                       | Motivation                                                                                    |
| -------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| 1        | **Security (process model)**  | Renderer has no Node integration; privileged work runs in main; preload exposes a narrow API. |
| 2        | **Reliability of local data** | SQLite WAL, migrations, resumable download registry.                                          |
| 3        | **Maintainability**           | Shared IPC contracts, Zod validation on main, TypeScript throughout.                          |
| 4        | **Observability**             | File logging in user data; metrics sampling for tuning and support.                           |


→ Next: [2. Architecture Constraints](./02-constraints.md)