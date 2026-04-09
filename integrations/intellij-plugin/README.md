# Local LLM Desktop — IntelliJ plugin (sample)

Minimal [IntelliJ Platform](https://plugins.jetbrains.com/docs/intellij/welcome.html) plugin that calls the desktop app’s **localhost HTTP bridge**.

## Prerequisites

1. Run **local-llm-desktop**, enable **IDE integration** in Settings, and **start the model runtime** (Run drawer).
2. Match **port** and optional **token** in IntelliJ: **Settings → Tools → Local LLM Desktop**.

## Build

From this directory you need **JDK 17+** and **Gradle 8.13+** (the [IntelliJ Platform Gradle Plugin 2.x](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html) requirement).

Prefer the included wrapper (Gradle **9.4.1**), which matches current JetBrains plugin templates and stays aligned with Gradle 9.x / upcoming **Gradle 10** (update `gradle/wrapper/gradle-wrapper.properties` when Gradle 10 GA is published):

```bash
./gradlew buildPlugin
```

On Windows: `gradlew.bat buildPlugin`. If you use a system Gradle install instead, use **8.13 or newer**.

Install **Settings → Plugins → ⚙ → Install Plugin from Disk…** and pick:

`build/distributions/local-llm-intellij-0.2.4.zip`

Or open this folder in IntelliJ as a Gradle project and use the **Gradle** tool window → **buildPlugin**.

## Usage

- Open the **Local LLM** tool window (**View → Tool Windows → Local LLM** or **Tools → Local LLM Chat…**). Enter a prompt and **Send to local model**.
- Optional **Include codebase knowledge graph** (default on) walks Java/Kotlin sources under module roots and sends a structural graph as **system** context. **Java** uses PSI; **Kotlin** uses **source-text heuristics** (no dependency on Kotlin K1 PSI), so the plugin stays compatible with the Kotlin plugin in **K2** mode. Large projects are truncated with a note in the graph.
- If the model needs more detail, it should start the reply with a line `[CLARIFY]` and numbered questions; the plugin then opens input dialogs so you can answer, and continues the chat (up to a few rounds).
- Optional **Apply file replacement blocks from replies**: when enabled, the plugin looks for `<<<LOCAL_LLM_FILE path="…">>>` … `<<<END_LOCAL_LLM_FILE>>>` in the model’s answer (full-file UTF-8 replacement, paths relative to project root). You confirm in a dialog before anything is written.
- **Vocabulary…** — scans the same Java/Kotlin sources as the structural graph (plus attached file names/paths) and opens a **domain vocabulary** report: terms grouped by **domain** (first two package segments, e.g. `com.example`), then by **package**, with types, methods, properties, and CamelCase-derived word hints.
- **Connection strip** at the top polls **GET /health** on the configured port (same as the desktop bridge): shows disconnected / bridge OK / runtime running vs stopped, with **Refresh connection**. Chat **ConnectException**-style failures refresh this strip and avoid a noisy modal when it is clearly a network reachability issue.
- **Tools → Local LLM Chat…** (or editor context menu) opens the tool window and **prefills the prompt** from the current selection when there is one.

**Dependencies:** the plugin declares `**com.intellij.java`** for Java PSI. It does **not** depend on the Kotlin plugin — Kotlin sources use **text parsing** so the plugin works with Kotlin **K2** analysis in the IDE.

## API reference

See `../../docs/intellij-integration.md` in the main repo.