# IntelliJ / IDE integration

The desktop app can expose a **localhost-only** HTTP bridge so tools (including a JetBrains plugin) can send chat completions through the same runtime as the UI.

## Enable in the app

1. Open **More → Settings → IDE integration (localhost)**.
2. Turn on **Enable HTTP bridge for plugins**.
3. Optionally change **Port** (default `17373`) and set an **Optional bearer token** (then send `Authorization: Bearer <token>` on `/v1/`* routes).

The runtime (Ollama or llama.cpp) must already be **started** from **Run** in the desktop app; the bridge does not start models by itself.

## Security

- The server binds to **127.0.0.1** only (not reachable from other machines).
- If you set a token, unauthenticated requests to `/v1/chat`, `/v1/runtime/status`, and `/v1/plugin/report` receive `401`.
- `GET /health` stays open for simple reachability checks.

## HTTP API

### `GET /health` or `GET /`

JSON:

```json
{
  "ok": true,
  "name": "local-llm-desktop",
  "runtimeRunning": true,
  "runtimeKind": "ollama"
}
```

### `GET /v1/runtime/status`

Same auth rules as `/v1/chat`. Returns `running`, `kind`, `modelPath`, `endpoint`.

### `POST /v1/chat`

`Content-Type: application/json`

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "maxTokens": 160
}
```

`role` may be `system`, `user`, or `assistant`. The sample IntelliJ plugin sends a **system** message (instructions + optional codebase graph) and **user** messages; clarification rounds append **assistant** then **user** turns.

Optional **`maxTokens`** (integer, 1–262144): caps **this** request only. Omitted means the desktop app uses **Settings → Max response tokens**. The plugin uses a small `maxTokens` for **inline (gray) completion** so suggestions stay short without changing your global chat limit.

Response `200`:

```json
{
  "reply": "…assistant text…",
  "model": "llama3.2"
}
```

Uses the app’s **Max response tokens** setting. Errors return JSON `{ "error": "…" }` with 4xx/5xx.

Optional usage fields when the runtime reports them: `promptTokens`, `completionTokens` (integers).

### `POST /v1/plugin/report`

Same auth as `/v1/chat`. Lets an IDE plugin **push short activity events** to the desktop app (shown in the pinned **Activity** sidebar and kept in a small in-memory history).

`Content-Type: application/json`

```json
{
  "source": "intellij",
  "kind": "chat_completed",
  "message": "MyProject",
  "meta": {
    "project": "MyProject",
    "attachments": 2,
    "includeGraph": true,
    "promptTokens": 1200,
    "completionTokens": 400
  }
}
```

`kind` must be one of: `chat_completed`, `chat_failed`, `apply_completed`, `apply_failed`, `apply_cancelled`, `send_cancelled`.

`source` defaults to `intellij` when omitted. `message` and `meta` are optional. `meta` values must be strings, numbers, booleans, or `null`.

Response `200`: `{ "ok": true }`.

## Sample plugin

See `integrations/intellij-plugin/` for an IntelliJ Platform plugin (Gradle) with:

- **Settings → Tools → Local LLM Desktop** — port and token (must match the app).
- **Local LLM** tool window — prompt the local model; optional **codebase knowledge graph** (Java via PSI, Kotlin via **text** so Kotlin **K2** mode is supported); `**[CLARIFY]`** follow-up dialogs when the model asks for clarification; optional **structured apply** — the model can emit `**LOCAL_LLM_PATCH`** blocks (search/replace hunks, preferred for edits to existing files) and/or `**LOCAL_LLM_FILE`** blocks (full file replace / new files). Attached files are labeled with **project-relative paths** and a path list footer so the model can target the right `path=` values. After you confirm, the plugin applies in order, reloads documents, and opens the first successfully touched file. **Vocabulary…** builds a **domain vocabulary** from scanned sources (grouped by coarse package domain and full package) plus attached file context. After chat / apply / cancel outcomes, the plugin **POSTs** summaries to `/v1/plugin/report` so the desktop app can surface them (pin **Activity** to see the **IDE plugin** feed).

Patch shape (must match plugin parser / system prompt):

```
<<<LOCAL_LLM_PATCH path="src/main/kotlin/Example.kt">>>
<<<< SEARCH
exact excerpt from file
====
replacement
>>>>
<<<END_LOCAL_LLM_PATCH>>>
```

- **Tools → Local LLM Chat…** — opens the tool window and prefills from the editor selection when present.
- **Inline completion** — when enabled under **Settings → Tools → Local LLM Desktop**, the IDE’s gray **inline** suggestions (typing debounce + **Insert Inline Completion** / platform shortcut) call `POST /v1/chat` with local prefix/suffix context and a short `maxTokens` budget. Requires the desktop **runtime** to be started and **IDE integration** enabled.

Build from `integrations/intellij-plugin/` with **JDK 17+** and **Gradle 8.13+** (IntelliJ Platform Gradle Plugin 2.x). Prefer `./gradlew buildPlugin` / `gradlew.bat buildPlugin` (wrapper uses Gradle 9.4.1; bump the wrapper when Gradle 10 is released). Then **Settings → Plugins → ⚙ → Install Plugin from Disk…** and choose the ZIP under `build/distributions/` (for example `local-llm-intellij-0.2.5.zip`).