# Local LLM Desktop — application architecture

This page summarizes how the **Local LLM Desktop** Electron app is structured so you can ingest it into the in-app wiki and use it with RAG in chat.

## Processes

- **Main process** (`src/main/`): Node/Electron. Owns the SQLite database, Hugging Face downloads, inference runtime adapters (llama.cpp server and Ollama), metrics sampling, optional training job launcher, and the localhost integration HTTP bridge for editor plugins.
- **Preload** (`src/preload/`): Exposes a narrow `window.api` to the renderer via `contextBridge` (see `src/shared/ipc.ts` for channel names).
- **Renderer** (`src/renderer/`): React UI (Vite + `electron-vite`). Chat, wiki, model library drawer, runtime controls, settings, and pinned widgets live here.

## Persistence

- **SQLite** (`app.sqlite` under user data): conversations, messages, knowledge sources and chunks (with FTS5 for search), wiki page rows and chunk links, Hugging Face cache metadata, download registry, metrics samples, training job records.
- **electron-store**: user settings (models directory, runtime kind, Ollama URL, ports, HF token encryption blob, widget layout, color scheme, chat max tokens, integration bridge options).
- **localStorage** (renderer): slide-over panel widths and edges for chat list and knowledge panel.

## Knowledge pipeline

1. **Ingest** — Text, files (via picker), or a full chat thread become rows in `kb_sources` and `kb_chunks`. Long text is split into overlapping chunks (`kbService.ts`).
2. **Search** — `kb_chunks_fts` (FTS5) backs `kb:search`; snippets can be pulled into the next chat message.
3. **Wiki pages** — `ensureWikiPageForSource` builds or updates a `wiki_pages` row (id `src:<sourceId>`) and links chunks in `wiki_page_chunks`.
4. **Knowledge graph** — The app can render a structural graph: sources → chunks, wiki pages → chunks, wiki → source when the page is compiled from that source, and weak **related** edges between sources that share a long token in their titles.

## Notable services (main)


| Area             | Module (under `src/main/services/`)             |
| ---------------- | ----------------------------------------------- |
| Chat CRUD        | `chatService.ts`                                |
| Knowledge / wiki | `kbService.ts`                                  |
| HF API           | `hfService.ts`                                  |
| Downloads        | `downloadManager.ts`                            |
| Runtime          | `runtime/` (`llamaCppAdapter`, `ollamaAdapter`) |
| Integration HTTP | `integrationServer.ts`                          |
| Metrics          | `metricsService.ts`                             |


## Shared types

TypeScript interfaces shared between main and renderer live in `src/shared/types.ts`. IPC payloads are validated with Zod in `registerIpc.ts` where applicable.