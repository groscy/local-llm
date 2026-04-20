# Knowledge base, wiki, and graph semantics

Use this page to understand what the **Knowledge wiki** and **Knowledge graph** tabs represent inside Local LLM Desktop.

## Tables (conceptual)

- `**kb_sources`** — One row per ingested document or saved chat export: title, URI, optional `conversation_id` for linked cleanup.
- `**kb_chunks`** — Ordered text segments belonging to a source; full-text index lives in `**kb_chunks_fts**` (triggers keep FTS in sync).
- `**wiki_pages**` — Browsable compiled bodies; auto-generated pages use ids of the form `src:<kb_source_uuid>`.
- `**wiki_page_chunks**` — Many-to-many: which chunks appear in which wiki page (used for graph **indexes** edges).

## Graph node kinds


| Kind       | Meaning                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| **Source** | A `kb_sources` topic (your file, note, or saved chat).                                                         |
| **Chunk**  | A searchable segment under that source (shown up to a per-source and global cap in the graph for performance). |
| **Wiki**   | A `wiki_pages` row (title shown on the node).                                                                  |


## Graph edge kinds


| Edge              | Meaning                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| **contains**      | Source → chunk (ownership).                                                                               |
| **indexes**       | Wiki page → chunk (from `wiki_page_chunks`).                                                              |
| **compiled_from** | Wiki page → source when the page id is `src:<sourceId>`.                                                  |
| **related**       | Source ↔ source when both titles share at least one token of four or more letters (heuristic “see also”). |


## Using this in chat

From **Chat**, search the knowledge base and **pull** snippets into your composer; the model sees that text in the user turn. The graph does not change retrieval rules—it is a **map** of how material is stored and linked.

**Chat prompt domains** (keyword clusters with optional system suffix text) are edited under **Settings → Chat & knowledge**, next to **Domain-enhanced prompts**—not in the wiki sidebar.

## Auto notes from chat

When **Auto-extract wiki notes after each reply** is enabled (Settings → Chat generation), the app sends the last user message and assistant reply through a **brief follow-up** completion with a fixed “archivist” prompt. The model returns a `<wiki-title>…</wiki-title>` line (legacy `TITLE:` is still accepted) and Markdown body; that text is ingested as a new `kb_sources` row with `conversation_id` set, so it participates in the same **delete with chat** cleanup as manually saved chat exports.

## Reference-style wiki entries

Browsable wiki pages (`wiki_pages` compiled from each source) follow a **reference article** shape:

1. **`::: glossary` … `:::`** — The entry keyword (usually the source title) and a **short definition** (also rendered in the Glossary panel).
2. **`## Practice and context`** — How the topic shows up in practice; populated from indexed chunks whose **headings** suggest usage or context (e.g. “Usage”, “Application”, “Practice”), or from the first unassigned chunk when you have not used those headings.
3. **`## Related concepts`** — Your own passages from chunks whose headings mention relations, synonyms, “see also”, etc., plus optional **h3** blocks (“From indexed sources” / “Suggested related entries”) and a short bullet list of other library titles (same scoring signal as **See also** in the UI).
4. **`## Notes and caveats`** — Remaining indexed passages, or chunks explicitly tagged with headings like “In-depth”, “Notes”, or “Caveats”.

When authoring Markdown for **+ Add document**, use headings that match these sections (or the older “Usage” / “Linguistic relations” / “In-depth” labels) so chunk boundaries line up with the buckets you want. Auto-extracted chat notes are prompted to use the same structure in the model output.

When a subsection has nothing to show yet, the compiler inserts a **short neutral sentence** instead of internal control tokens. Older rows may still contain legacy `` `wiki:…` `` markers; the app strips those when rendering.

## Ingesting this repository

To add these wiki files to your **local** app database, use **Knowledge wiki → + Add document** and choose `.md` files from the `docs/wiki/` folder in your clone of the project.