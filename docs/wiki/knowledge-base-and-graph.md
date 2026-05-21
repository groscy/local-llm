# Knowledge Base, Wiki, and Graph Semantics

Use this page to understand what the **Knowledge wiki** and **Knowledge graph** tabs represent in Local LLM Desktop.

## Conceptual Tables

- `kb_sources` - One row per ingested document or saved chat export (title, URI, optional `conversation_id` for linked cleanup).
- `kb_chunks` - Ordered text segments per source; full-text index is in `kb_chunks_fts`.
- `wiki_pages` - Browsable compiled article bodies; auto-generated pages use ids like `src:<kb_source_uuid>`.
- `wiki_page_chunks` - Many-to-many map of pages to chunks (used for graph `indexes` edges).
- `kb_documents` - Import diagnostics, confidence, extracted raw text, distilled wiki body, extraction version metadata.

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

## Document import pipeline (v2 local-first)

All ingestion channels now use one parser abstraction:

1. **Parse stage** (`DocumentParser`) with per-format adapters.
2. **Normalize stage** to canonical text and sections.
3. **Extract stage** for entities/relations/descriptors.
4. **Quality gate stage** before semantic graph writes.
5. **Projection refresh** for wiki and graph views.

### PDF behavior

- Primary extraction uses PDF text layer parsing.
- Fallback tries a local CLI text extractor (`pdftotext`) when text-layer output is low signal.
- Parser diagnostics are persisted (`parser warnings`, truncation, parse duration, OCR/fallback coverage).
- If no usable text is found, import fails fast with a user-visible error.

### File and DMS parity

- `+ Add document` and DMS sync both use the same parser service.
- DMS imports now store parser diagnostics and source type metadata instead of bypassing enrichment.

## Semantic graph mode (transparency first)

The graph view now supports a **semantic mode** focused on:

- **Nouns as nodes** (`semantic_entities`)
- **Verbs as relations** (`semantic_relations`)
- **Adjectives as metadata** (`semantic_descriptors`)
- **Context scopes** (`semantic_context_scopes`) and overlap intersections for shared terminology

### Provenance and explainability

Each extracted item can be traced to an evidence record in `semantic_evidence_traces`:

- extraction method (`deterministic_rule`, etc.)
- rule id (for deterministic pass diagnostics)
- source reference (document/chat/codebase)
- source span and confidence reasons

In semantic mode, selecting a node opens an evidence inspector showing why that node exists and which rule/source produced it.

## Extraction quality model

- Extraction is deterministic and local-first, with stronger lexical filtering and phrase-aware candidates.
- Canonicalization normalizes labels before graph writes.
- Pre-write quality gates reject low-confidence or noisy candidates.
- Rejected candidates are tracked in `semantic_rejection_events` for diagnostics and tuning.

### Ingestion channels

Semantic extraction runs through a unified path for:

- document upload (including PDF parsing and fallback extraction)
- plain text/wiki ingest
- codebase-analysis ingest outputs (language-agnostic summaries)

## Using this in chat

From **Chat**, search the knowledge base and pull snippets into your composer. The model sees that text in the user turn. The graph does not change retrieval rules - it is a map of how material is stored and linked.

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

When a subsection has nothing to show yet, the compiler inserts a short neutral sentence instead of internal control tokens. Older rows may still contain legacy `` `wiki:…` `` markers; the app strips those when rendering.

## Wiki + graph workspace layout

- The wiki area uses a single search surface (library search) to avoid duplicated controls.
- The graph tab uses a unified workspace: primary canvas + optional analysis side panel.
- Layout uses full-height flex/grid behavior so graph canvases fill available space without overlap.
- Comparison metrics are grouped into the side panel instead of stacked chrome bands.

## Ingesting this repository

To add these wiki files to your local app database, use **Knowledge wiki → + Add document** and choose `.md` files from the `docs/wiki/` folder in your clone.

For rollout thresholds and migration guidance, see `docs/wiki/document-import-quality-runbook.md`.