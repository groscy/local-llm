# IntelliJ / IDE integration

The desktop app can expose a **localhost-only** HTTP bridge so tools (including a JetBrains plugin) can send chat completions through the same runtime as the UI.

## Enable in the app

1. Open **More → Settings → IDE integration (localhost)**.
2. Turn on **Enable HTTP bridge for plugins**.
3. Optionally change **Port** (default `17373`) and set an **Optional bearer token** (then send `Authorization: Bearer <token>` on `/v1/*` routes).

The runtime (Ollama or llama.cpp) must already be **started** from **Run** in the desktop app; the bridge does not start models by itself.

## Security

- The server binds to **127.0.0.1** only (not reachable from other machines).
- If you set a token, unauthenticated requests to `/v1/chat` and `/v1/runtime/status` receive `401`.
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
  ]
}
```

`role` may be `system`, `user`, or `assistant`. The sample IntelliJ plugin sends a **system** message (instructions + optional codebase graph) and **user** messages; clarification rounds append **assistant** then **user** turns.

Response `200`:

```json
{
  "reply": "…assistant text…",
  "model": "llama3.2"
}
```

Uses the app’s **Max response tokens** setting. Errors return JSON `{ "error": "…" }` with 4xx/5xx.

## Sample plugin

See `integrations/intellij-plugin/` for an IntelliJ Platform plugin (Gradle) with:

- **Settings → Tools → Local LLM Desktop** — port and token (must match the app).
- **Local LLM** tool window — prompt the local model; optional **codebase knowledge graph** (Java via PSI, Kotlin via **text** so Kotlin **K2** mode is supported); **`[CLARIFY]`** follow-up dialogs when the model asks for clarification; optional **structured file apply** — if the model emits `<<<LOCAL_LLM_FILE path="relative/path">>>` … `<<<END_LOCAL_LLM_FILE>>>` blocks (full file contents), the plugin can write them under the project root after you confirm (see system prompt in the plugin); **Vocabulary…** builds a **domain vocabulary** from scanned sources (grouped by coarse package domain and full package) plus attached file context.
- **Tools → Local LLM Chat…** — opens the tool window and prefills from the editor selection when present.

Build from `integrations/intellij-plugin/` with **JDK 17+** and **Gradle 8.13+** (IntelliJ Platform Gradle Plugin 2.x). Prefer `./gradlew buildPlugin` / `gradlew.bat buildPlugin` (wrapper uses Gradle 9.4.1; bump the wrapper when Gradle 10 is released). Then **Settings → Plugins → ⚙ → Install Plugin from Disk…** and choose the ZIP under `build/distributions/` (for example `local-llm-intellij-0.2.4.zip`).
