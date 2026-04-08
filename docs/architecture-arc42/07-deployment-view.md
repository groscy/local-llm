# 7. Deployment View

← [Index](./README.md) · Previous: [6. Runtime View](./06-runtime-view.md)

## 7.1 Deliverable

- **electron-builder** produces **zip** artifacts (win x64, mac x64/arm64, linux x64 per `electron-builder.yml`).
- Application files under `out/**/*` packaged; **native** `better-sqlite3` unpacked from asar (`asarUnpack: **/*.node`).
- **extraResources:** `training/` copied to `resources/training/` for packaged training script.

## 7.2 Runtime directories (conceptual)

| Location | Content |
|----------|---------|
| App install / `resources` | Bundled JS, renderer assets, `training/` |
| User data (`app.getPath('userData')`) | SQLite DB, `logs/`, default `models/`, config (electron-store) |

## 7.3 Build script

`npm run dist:zip` runs typecheck → `electron-vite build` → `electron-builder --publish never` (see `scripts/package-zip.mjs`); output directory may fall back to `release-builds/<timestamp>/` if `release/` is locked on Windows.

→ Next: [8. Cross-Cutting Concepts](./08-cross-cutting-concepts.md)
