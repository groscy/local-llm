# 11. Risks and Technical Debt

← [Index](./README.md) · Previous: [10. Quality Requirements](./10-quality-requirements.md)

| Risk / debt | Impact | Mitigation |
|-------------|--------|------------|
| Native module + Electron upgrades | Build break until `electron-rebuild` | `postinstall` rebuild; CI typecheck + dist |
| Windows file locks on `release/` | Packaging fails | Timestamped `release-builds/` fallback in `package-zip.mjs` |
| Ollama / llama not installed | User confusion | Status/health checks and clear UI copy |
| Training depends on user Python env | Job failures | Document Python deps; optional strict path in IPC |
| `sandbox: false` | Larger attack surface vs sandboxed preload | Accept for Node-native addons/process spawning; keep context isolation |

→ Next: [12. Glossary](./12-glossary.md)
