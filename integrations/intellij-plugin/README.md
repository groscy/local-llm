# Local LLM Desktop — IntelliJ plugin (sample)

Minimal [IntelliJ Platform](https://plugins.jetbrains.com/docs/intellij/welcome.html) plugin that calls the desktop app’s **localhost HTTP bridge**.

## Prerequisites

1. Run **local-llm-desktop**, enable **IDE integration** in Settings, and **start the model runtime** (Run drawer).
2. Match **port** and optional **token** in IntelliJ: **Settings → Tools → Local LLM Desktop**.

## Build

From this directory (JDK 17+ and Gradle 8+):

```bash
gradle buildPlugin
```

Install **Settings → Plugins → ⚙ → Install Plugin from Disk…** and pick:

`build/distributions/local-llm-intellij-0.1.0.zip`

Or open this folder in IntelliJ as a Gradle project and use the **Gradle** tool window → **buildPlugin**.

## Usage

- **Tools → Ask Local LLM…** — sends the **current editor selection**, or prompts for text if nothing is selected.
- Replies open in a dialog (no streaming).

## API reference

See `../../docs/intellij-integration.md` in the main repo.
