/** In-app copy for the IntelliJ plugin journey (offline-friendly; keep in sync with docs when behavior changes). */

export const IDE_SETUP_OTHER_EDITORS = `Any tool on your machine can call the same loopback API as the IntelliJ sample plugin.

Endpoints (see intellij-integration.md on GitHub for full detail):
- GET /health — no auth; reachability and coarse runtime flag.
- GET /v1/runtime/status — requires Bearer token when the app has one configured.
- POST /v1/chat — JSON body { "messages": [...], "maxTokens?": n }; Bearer when configured.
- POST /v1/plugin/report — optional activity feed into this app.

There is no VS Code extension in this repository; use curl, your own script, or another HTTP client against 127.0.0.1 and your chosen port.`

export const IDE_SETUP_BRIDGE_RAG_NOTE = `The IDE bridge forwards the JSON you send to POST /v1/chat; it does not automatically inject knowledge-base RAG. Use Chat or Wiki in this app for RAG, then paste or attach distilled context in your editor, or extend the bridge in a dedicated product change.`
