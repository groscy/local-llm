# 3. System Scope and Context

← [Index](./README.md) · Previous: [2. Architecture Constraints](./02-constraints.md)

## 3.1 Business Context

The system is a **desktop client** for local LLM workflows: acquisition (HF), execution (runtime), and augmentation (RAG, training artifacts). It does not host a multi-tenant service; each installation is independent.

## 3.2 Technical Context

```mermaid
C4Context
title Local LLM Desktop — context (C4-style)

Person(user, "User", "Runs chat, downloads models, manages knowledge")
System(app, "Local LLM Desktop", "Electron app: UI + main + SQLite")

System_Ext(hf, "Hugging Face Hub", "Model metadata & file downloads")
System_Ext(ollama, "Ollama", "Optional local inference API")
System_Ext(llama, "llama.cpp server", "Optional local HTTP inference (child process)")
System_Ext(py, "Python + training script", "Optional LoRA training (train_lora.py)")
System_Ext(ide, "IDE / automation", "Optional HTTP client to 127.0.0.1 (JetBrains plugin, scripts)")

Rel(user, app, "uses")
Rel(app, hf, "search, download, API token")
Rel(app, ollama, "HTTP, if selected runtime")
Rel(app, llama, "spawn, HTTP, if selected runtime")
Rel(app, py, "spawn for training jobs")
Rel(app, ide, "HTTP on loopback when integration server enabled")
```

## 3.3 System Boundaries

**In scope:** Electron main/preload/renderer, SQLite schema and services, HF client usage, runtime adapters, packaging.

**Out of scope:** Hosting Ollama or llama.cpp binaries inside the repo (detection/paths are configurable); full ML training stack (only orchestration + script path); shipping a production-ready JetBrains Marketplace plugin (a **sample** plugin lives under `integrations/intellij-plugin/`).

→ Next: [4. Solution Strategy](./04-solution-strategy.md)
