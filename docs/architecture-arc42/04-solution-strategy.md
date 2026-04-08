# 4. Solution Strategy

← [Index](./README.md) · Previous: [3. System Scope and Context](./03-context-and-scope.md)

1. **Classic Electron split:** **main** owns I/O, DB, child processes, secrets; **preload** exposes `window.api`; **renderer** is a SPA.
2. **Adapter pattern for inference:** `RuntimeAdapter` (`llamacpp` | `ollama`) implements start/stop/status/chat (+ optional metrics).
3. **Single database** for chat, KB, wiki linkage, HF cache metadata, downloads, metrics history, training job records.
4. **FTS5** for lexical KB search with triggers keeping `kb_chunks_fts` in sync with `kb_chunks`.
5. **Build pipeline:** `electron-vite build` → `out/` → `electron-builder` zip per platform.

→ Next: [5. Building Block View](./05-building-block-view.md)
