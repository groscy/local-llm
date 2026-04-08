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

- **electron-store** for paths, runtime kind, Ollama URL, UI preferences, encrypted token reference.
- Zod-validated partial updates on `SET_CONFIG`.

## 8.4 IPC contract

- Channel names and semantics centralized in `src/shared/ipc.ts`.
- Preload maps to typed-ish `invoke` helpers; main is the single authority for validation and side effects.

→ Next: [9. Architecture Decisions](./09-architecture-decisions.md)
