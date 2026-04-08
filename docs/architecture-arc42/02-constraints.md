# 2. Architecture Constraints

← [Index](./README.md) · Previous: [1. Introduction and Goals](./01-introduction-and-goals.md)

## 2.1 Technical Constraints

| Constraint | Details |
|------------|---------|
| **Runtime** | Electron 33.x; Node ESM (`"type": "module"`). |
| **UI** | React 18, Vite 5, **electron-vite** for main/preload/renderer bundles. |
| **Persistence** | **better-sqlite3** (native addon; rebuilt per Electron version). |
| **Packaging** | **electron-builder**; Windows zip without code signing in default config (`forceCodeSigning: false`). |
| **External processes** | llama.cpp HTTP server child process or Ollama HTTP client; optional `python` for training. |

## 2.2 Organizational / Conventions

- IPC payloads validated with **Zod** in the main process.
- Hugging Face token optionally stored encrypted via **safeStorage** when available.

→ Next: [3. System Scope and Context](./03-context-and-scope.md)
