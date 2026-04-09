# 8. Cross-Cutting Concepts

← [Index](./README.md) · Previous: [7. Deployment View](./07-deployment-view.md)

## 8.1 Security

- **contextIsolation: true**, **nodeIntegration: false** in renderer.
- Preload-only **contextBridge** API (`window.api`).
- **safeStorage** for HF token when OS support exists.
- External links opened via **shell.openExternal** (not in-renderer navigation).

## 8.2 Error handling and logging

- Main logs via `logger.ts` to files under user data.
- IPC failures surface as promise rejections to the renderer (call sites should handle UX).

## 8.3 Configuration

- **electron-store** for paths, runtime kind, Ollama URL, llama port, **chatMaxTokens**, **integration** listen/port/token, pinned widget flags, dock side, bar dimensions, metrics refresh, color scheme, encrypted HF token reference.
- **Renderer localStorage** for slide-over panel **widths** and **edges** (chat list / knowledge panel) on narrow layouts — not synced to electron-store.
- Zod-validated partial updates on `SET_CONFIG`; changing integration keys **restarts** the localhost HTTP server.

## 8.4 IPC contract

- Channel names and semantics centralized in `src/shared/ipc.ts`.
- Preload maps to typed-ish `invoke` helpers; main is the single authority for validation and side effects.

## 8.5 UI presentation

- **Theming:** CSS variables for accent presets (`data-color-scheme` on `html`); custom **rounded scrollbars** (WebKit + Firefox `scrollbar-color`).
- **Responsive chat:** Three-column layout collapses to slide-overs; **pinned widgets** bar can dock left/right/top/bottom with user-resizable breadth persisted in the store.

→ Next: [9. Architecture Decisions](./09-architecture-decisions.md)
