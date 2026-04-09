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
    { "role": "user", "content": "Hello" }
  ]
}
```

Response `200`:

```json
{
  "reply": "…assistant text…",
  "model": "llama3.2"
}
```

Uses the app’s **Max response tokens** setting. Errors return JSON `{ "error": "…" }` with 4xx/5xx.

## Sample plugin

See `integrations/intellij-plugin/` for a minimal IntelliJ Platform plugin (Gradle) with:

- **Settings → Tools → Local LLM Desktop** — port and token (must match the app).
- **Tools → Ask Local LLM…** — uses selected editor text as the prompt, or asks for input.

Build from `integrations/intellij-plugin/` with **Gradle** (JDK 17+, Gradle 8+), e.g. `gradle buildPlugin` or `./gradlew buildPlugin`. Then **Settings → Plugins → ⚙ → Install Plugin from Disk…** and choose the ZIP under `build/distributions/` (for example `local-llm-intellij-0.1.0.zip`).
