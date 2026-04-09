# Project plan — status

Living summary of major work completed and what remains optional. Last updated: 2026-04-09.

---

## Completed — product / UX


| Area                          | What shipped                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chat token usage**          | Sent / generated counts under bubbles; persisted on messages (SQLite columns + `chatService`); streaming usage via `RUNTIME_CHAT_PROGRESS` correlated with `requestId`.           |
| **Max response tokens**       | `chatMaxTokens` in electron-store, applied in main for UI chat and IDE bridge; Settings UI.                                                                                       |
| **Pinned activity / metrics** | Resizable bar (width/height in store), dock side, custom dock icons (SVG-style), refresh interval; compact throughput / context / CPU / **resident memory** / GPU when available. |
| **Metrics drawer**            | Charts in a **two-column** grid in the drawer only.                                                                                                                               |
| **Scrollbars**                | Global rounded scrollbars (WebKit + Firefox `scrollbar-color`) aligned with theme tokens.                                                                                         |
| **Slide-over panels**         | Chat list (≤720px) and knowledge panel (≤1100px): resizable widths and **which edge** they slide from; persisted in **renderer `localStorage`** (not electron-store).             |
| **Hugging Face library**      | Recommendations and search results in a **responsive grid**: 2 columns (small) → 3 (640px+) → 4 (1024px+).                                                                        |
| **Downloads → chat**          | Optional `chatDisplayName` / `chat_display_name` on HF download jobs for model labeling in chat.                                                                                  |
| **Copy / metrics**            | User-facing “resident memory” / working set wording instead of raw “RSS”.                                                                                                         |


---

## Completed — IDE / integration


| Area                      | What shipped                                                                                                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Localhost HTTP bridge** | `integrationServer.ts` on **127.0.0.1** only: `/health`, `/v1/runtime/status`, `/v1/chat`; optional bearer token; respects `chatMaxTokens`.                                                                                                                                                  |
| **Settings**              | Toggle listen, port, token; changing integration keys restarts the server.                                                                                                                                                                                                                   |
| **Docs**                  | `docs/intellij-integration.md` describes API and security.                                                                                                                                                                                                                                   |
| **Sample plugin**         | `integrations/intellij-plugin/` **v0.2.4** — **Local LLM** tool window, **live bridge/health strip**, Java PSI + Kotlin **text** graph (K2-safe), `**[CLARIFY]`** loop, optional **structured file apply**, **domain vocabulary** (package-grouped), Settings + **Tools → Local LLM Chat…**. |


### IntelliJ plugin build (Gradle)

- Migrated from deprecated **Gradle IntelliJ Plugin 1.x** to **IntelliJ Platform Gradle Plugin 2.13.1** (required for modern Gradle and the path to **Gradle 10**).
- **Kotlin JVM 2.1.10** (needed for very new JDKs used as Gradle JVM).
- Target **IntelliJ IDEA Community 2024.3.6**; `ideaVersion` patching via `intellijPlatform.pluginConfiguration`.
- **Gradle wrapper 9.4.1** (current stable; **Gradle 10 GA** was not available on services.gradle.org at last check — bump `gradle/wrapper/gradle-wrapper.properties` when released).
- Foojay **toolchain resolver** in `settings.gradle.kts`; `kotlin { jvmToolchain(17) }` for plugin bytecode.
- Bundled **Java** PSI only; Kotlin graph uses **file text** (no `org.jetbrains.kotlin` plugin dependency — compatible with Kotlin **K2**).
- `.gitignore` for `.gradle/`, `build/`, `out/`.
- `buildPlugin` verified with `gradlew.bat`.

Gradle may still print deprecations (“incompatible with Gradle 10”) from upstream **Usage** attributes until JetBrains releases a newer platform Gradle plugin — tracking `**org.jetbrains.intellij.platform`** updates is the mitigation.

---

## Completed — documentation


| Artifact                           | Updates                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `**docs/USER-GUIDE.md`**           | Slide panels, resident memory, token footers, max tokens, IDE integration, pinned widgets, settings areas, factory reset scope.                                                                                                                                                                        |
| `**docs/architecture-arc42*.md`**  | Introduction, context (IDE actor, localhost bridge), solution strategy, building blocks (`integrationServer`, message tokens), runtime sequence (streaming, `MESSAGE_APPEND`, IDE §6.4), deployment note, cross-cutting (store + `localStorage`), ADR-6 (localhost bridge), quality + risks, glossary. |
| `**docs/architecture-arc42.md**`   | Index links (User Guide, IntelliJ doc, plugin folder).                                                                                                                                                                                                                                                 |
| `**docs/intellij-integration.md**` | API + build instructions aligned with plugin README / wrapper.                                                                                                                                                                                                                                         |


---

## Completed — Git history

Work was committed in **separate feature commits** on `master`, for example:

1. DB migrations (download label + message token columns)
2. Shared types
3. Chat service token persistence
4. Download registry `chat_display_name`
5. Runtime adapter streaming / `maxTokens`
6. Store defaults (tokens, widget size, integration)
7. IPC + `integrationServer` + preload + types
8. Renderer UI (chat streaming, metrics grid, panels, widgets, scrollbars, token chart)
9. IntelliJ sample plugin
10. IntelliJ integration doc
11. arc42 refresh
12. User guide expansion

(Exact hashes: see `git log`.)

---

## Optional follow-ups

- When **Gradle 10** ships: update `**integrations/intellij-plugin/gradle/wrapper/gradle-wrapper.properties`** and re-run `buildPlugin`; bump **IntelliJ Platform Gradle Plugin** if release notes mention Gradle 10 / deprecation fixes.  
- If **arc42 §02** or **§10–11** should mention IDE bridge or HF grid explicitly, add small cross-links (currently covered mainly in §03–08).  
- Monitor **IPGP** / **Gradle** release notes for removal of legacy **Usage** deprecation warnings.

---

## References

- User guide: [USER-GUIDE.md](./USER-GUIDE.md)  
- Architecture index: [architecture-arc42/README.md](./architecture-arc42/README.md)  
- IDE bridge: [intellij-integration.md](./intellij-integration.md)  
- Sample plugin: `../integrations/intellij-plugin/README.md`