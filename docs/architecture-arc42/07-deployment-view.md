# 7. Deployment View

← [Index](./README.md) · Previous: [6. Runtime View](./06-runtime-view.md)

## 7.1 Deliverable

- **electron-builder** produces **zip** (`npm run dist:zip`) and **installers** (`npm run dist:installer`): **NSIS** `.exe` (Windows x64), **DMG** (mac x64/arm64), **`.deb` + AppImage** (Linux x64; **RPM** target also defined for `electron-builder --linux rpm` on RPM hosts), per `electron-builder.yml`.
- Application files under `out/**/*` packaged; **native** `better-sqlite3` unpacked from asar (`asarUnpack: **/*.node`).
- **extraResources:** `training/` copied to `resources/training/` for packaged training script.

## 7.2 Runtime directories (conceptual)

| Location | Content |
|----------|---------|
| App install / `resources` | Bundled JS, renderer assets, `training/` |
| User data (`app.getPath('userData')`) | SQLite DB, `logs/`, default `models/`, config (electron-store); **integration server** has no separate install — it is main-process code enabled at runtime when configured |

## 7.3 Build scripts

- `npm run dist:zip` — typecheck → `electron-vite build` → `electron-builder` **zip only** for the host OS (`scripts/package-zip.mjs`).
- `npm run dist:installer` — same build, then **NSIS / DMG / Linux `.deb` + AppImage** for the host OS (`scripts/package-installer.mjs`).

Output directory may fall back to `release-builds/<timestamp>/` if `release/` is locked on Windows.

→ Next: [8. Cross-Cutting Concepts](./08-cross-cutting-concepts.md)
