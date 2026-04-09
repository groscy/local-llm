# Knowledge base, wiki, and graph semantics

Use this page to understand what the **Knowledge wiki** and **Knowledge graph** tabs represent inside Local LLM Desktop.

## Tables (conceptual)

- **`kb_sources`** — One row per ingested document or saved chat export: title, URI, optional `conversation_id` for linked cleanup.
- **`kb_chunks`** — Ordered text segments belonging to a source; full-text index lives in **`kb_chunks_fts`** (triggers keep FTS in sync).
- **`wiki_pages`** — Browsable compiled bodies; auto-generated pages use ids of the form `src:<kb_source_uuid>`.
- **`wiki_page_chunks`** — Many-to-many: which chunks appear in which wiki page (used for graph **indexes** edges).

## Graph node kinds

| Kind | Meaning |
|------|---------|
| **Source** | A `kb_sources` topic (your file, note, or saved chat). |
| **Chunk** | A searchable segment under that source (shown up to a per-source and global cap in the graph for performance). |
| **Wiki** | A `wiki_pages` row (title shown on the node). |

## Graph edge kinds

| Edge | Meaning |
|------|---------|
| **contains** | Source → chunk (ownership). |
| **indexes** | Wiki page → chunk (from `wiki_page_chunks`). |
| **compiled_from** | Wiki page → source when the page id is `src:<sourceId>`. |
| **related** | Source ↔ source when both titles share at least one token of four or more letters (heuristic “see also”). |

## Using this in chat

From **Chat**, search the knowledge base and **pull** snippets into your composer; the model sees that text in the user turn. The graph does not change retrieval rules—it is a **map** of how material is stored and linked.

## Auto notes from chat

When **Auto-extract wiki notes after each reply** is enabled (Settings → Chat generation), the app sends the last user message and assistant reply through a **brief follow-up** completion with a fixed “archivist” prompt. The model returns a `TITLE:` line and markdown bullets; that text is ingested as a new `kb_sources` row with `conversation_id` set, so it participates in the same **delete with chat** cleanup as manually saved chat exports.

## Ingesting this repository

To add these wiki files to your **local** app database, use **Knowledge wiki → + Add document** and choose `.md` files from the `docs/wiki/` folder in your clone of the project.
