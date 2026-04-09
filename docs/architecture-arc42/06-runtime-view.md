# 6. Runtime View

← [Index](./README.md) · Previous: [5. Building Block View](./05-building-block-view.md)

## 6.1 Typical chat with optional RAG (simplified)

```mermaid
sequenceDiagram
  participant UI as Renderer
  participant PRE as Preload
  participant IPC as Main / registerIpc
  participant RT as RuntimeAdapter

  Note over UI: Compose user message + optional KB snippets in UI
  UI->>PRE: runtimeChat(messages, requestId)
  PRE->>IPC: IPC.RUNTIME_CHAT
  IPC->>RT: chat(messages, stream + maxTokens from store)
  loop Streaming
    RT-->>IPC: token deltas
    IPC-->>PRE: RUNTIME_CHAT_PROGRESS (requestId)
    PRE-->>UI: streamed text + usage when available
  end
  RT-->>IPC: final assistant text
  IPC-->>PRE: Promise resolves (full reply)
  PRE-->>UI: full reply
  UI->>PRE: MESSAGE_APPEND (user + assistant, optional usage)
  PRE->>IPC: IPC.MESSAGE_APPEND → chatService / SQLite
```

*Notes:*

- **RAG context** is composed in the **renderer** (snippets appended to the outgoing user turn) before `runtimeChat`; main does not call `kbService` inside `RUNTIME_CHAT` today.
- **Max completion tokens** (`chatMaxTokens` in electron-store) are applied in **main** for both the UI path and the **integration server** path.
- **All model I/O** still goes through **main** (`RuntimeAdapter`), not the renderer.

## 6.2 Download flow (HF)

User triggers download → main validates paths → download manager streams from HF (using token from memory/store) → progress via `HF_DOWNLOAD_STATUS` → registry row updated in `downloads`.

## 6.3 Training flow

User starts job → main resolves `train_lora.py` (dev: `training/`; prod: `process.resourcesPath/training/`) → spawns Python with arguments → job row in `train_jobs` updated; status polled via IPC.

## 6.4 IDE / tool integration (optional)

When **integrationListenEnabled** is true, **`integrationServer`** serves **127.0.0.1** only. External clients `POST /v1/chat` with the same `ChatMessage[]` shape; main forwards to `RuntimeAdapter.chat` (non-streaming response). See [intellij-integration.md](../intellij-integration.md).

→ Next: [7. Deployment View](./07-deployment-view.md)
