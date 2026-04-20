# User Guide — Local LLM Desktop

This guide explains how to install, configure, and run **Local LLM Desktop**: use the **Models** hub for Hugging Face search and installs (GGUF or Safetensors with sidecars into a per-repo folder), chat through **Ollama** or **llama.cpp** (`llama-server`) selected from the top bar as **Ollama** vs **Files on my PC**, and optionally use the knowledge base, wiki highlights, pinned metrics/downloads/activity widgets, and training tools.

---

## 1. What you need

### 1.1 Computer requirements

- **Windows** (x64), **macOS** (Intel or Apple Silicon), or **Linux** (x64), matching the **installer or zip** you use.
- Enough **disk space** for models (often several gigabytes per model).
- An **inference backend** (see section 5): either **Ollama** or **llama.cpp**’s `llama-server`.

### 1.2 Optional but useful

- **Hugging Face account token** — improves API rate limits and access to gated models. Create one at [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
- **NVIDIA GPU** — not required; metrics can show GPU memory when `nvidia-smi` is available.
- **Python 3** — only if you use the optional training workflow (see section 8).

---

## 2. Install the application

### 2.1 From an installer (recommended when available)


| Platform    | Artifact                                         | What to do                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | `Local LLM Desktop-Setup-<version>.exe`          | Run the installer, choose install location if prompted, use Start Menu or desktop shortcut.                                                                                                                                |
| **macOS**   | `Local LLM Desktop-<version>-<arch>.dmg`         | Open the DMG, drag **Local LLM Desktop** into **Applications**.                                                                                                                                                            |
| **Linux**   | `Local LLM Desktop-<version>-linux-x64.deb`      | **Debian / Ubuntu / Mint:** `sudo apt install ./Local\ LLM\ Desktop-<version>-linux-x64.deb` (or `sudo dpkg -i <file>.deb` then `sudo apt -f install` if dependencies are missing). Installs menu entry like a normal app. |
| **Linux**   | `Local LLM Desktop-<version>-linux-x64.AppImage` | Portable single file: `chmod +x` then run, or use an AppImage desktop integration tool.                                                                                                                                    |
| **Linux**   | `Local LLM Desktop-<version>-linux-x64.pkg.tar.*` | **Arch / pacman:** `sudo pacman -U ./Local\ LLM\ Desktop-<version>-linux-x64.pkg.tar.xz` (extension may be `.pkg.tar.zst` depending on build). Resolves dependencies like a normal package install.                        |


Installers are produced from source with `**npm run dist:installer`** on the **same** OS you are targeting (output under `release/` or `release-builds/<timestamp>/`). **Linux packages** need a Linux toolchain: use `**npm run dist:linux:podman`** from **Windows or macOS** ([Podman](https://podman.io/) / Podman Desktop), `**npm run dist:linux`** on **Linux** or **WSL2** (Ubuntu, on the Linux filesystem — avoid `/mnt/c/...` if native modules misbehave). **RPM** (Fedora/RHEL) is configured in `electron-builder.yml`; after `npm run build`, run `npx electron-builder --publish never --linux rpm` on an RPM-based system (or install the `rpm` toolchain on Debian if you need `.rpm` there). **zip** builds remain available if you prefer a portable folder.

### 2.2 From a release zip (portable folder)

1. Unzip `**Local LLM Desktop-<version>-<platform>.zip`** to a folder of your choice.
2. Run `**Local LLM Desktop.exe`** (Windows) or the app bundle inside the zip (macOS/Linux layout depends on electron-builder output).
3. On first launch, the app creates its **user data** folder (database, logs, default models directory). You do not need to run anything as administrator for normal use.

### 2.3 From source (developers)

1. Install **[Node.js](https://nodejs.org/)** (LTS 20 or 22 works well with this project).
2. Clone or copy the project folder, then in a terminal:
  ```bash
   npm install
   npm run dev
  ```
3. `**npm install**` runs a native rebuild for **SQLite** (`better-sqlite3`) against the bundled Electron version. If that step fails, ensure build tools for Node native addons are installed on your OS.

**Production-like run from source:**

```bash
npm run build
npm run preview
```

**Create a distributable zip:**

```bash
npm run dist:zip
```

**Create an installer** (NSIS on Windows, DMG on macOS, **.deb + AppImage + pacman (Arch)** on Linux):

```bash
npm run dist:installer
```

**Linux release bundle** (`.deb`, `.AppImage`, **`.pkg.tar.*` (Arch)**, and portable `.zip`):

- **From Windows or macOS** (Podman installed; start a Podman machine if required): native modules are built **inside Linux**:

```bash
npm run dist:linux:podman
```

  Artifacts land in `**release-linux/**` by default.

- **From a Linux machine** (or WSL Ubuntu on the Linux filesystem):

```bash
npm run dist:linux
```

You can also use **GitHub Actions**: workflow **Build Linux release** (`.github/workflows/build-linux.yml`) runs **manually** (workflow dispatch) for Linux artifacts. Pushing a version tag `v*` runs **Release desktop** (`.github/workflows/release-desktop.yml`), which publishes Windows, macOS, and Linux installers, **electron-updater** metadata (`latest*.yml`), and the **IntelliJ plugin ZIP** to **GitHub Releases**. The workflow sets **`permissions: contents: write`** so the default `GITHUB_TOKEN` can upload assets (forks may need the same permission or a personal access token). You can still build `**Dockerfile.linux**` manually (see the file header).

Output appears under `release/` or, if that folder is locked on Windows, under `release-builds/<timestamp>/`. On Linux (or Podman/CI) you should get a `**.deb**`, an `**.AppImage**`, a **`pacman` package** (`*.pkg.tar.*`), and a `**.zip**` in that directory.

### 2.4 Automatic updates (release installs)

When you install from a **GitHub Release** asset (for example the Windows Setup `.exe`, a macOS `.dmg`, or a Linux `.deb` / **AppImage** attached to the release), the app can **check for updates**, download a newer build, and prompt you to **restart** to finish installing. Open **Settings → General → Application** to see the **current version**, use **Check for updates**, or open **Release notes** on GitHub.

- **Windows:** the **NSIS installer** is the primary target for in-app updates; a portable **zip** folder is not updated in place by the updater.
- **Linux:** **AppImage** is the most straightforward target for the built-in updater flow; **`.deb`** / **RPM** users may reinstall from the release page depending on platform behavior.
- **Code signing:** Release packaging in this repository is configured so **local and CI builds succeed without** Apple **Developer ID** or Windows **Authenticode** certificates (`forceCodeSigning: false` in `electron-builder.yml`). Expect **macOS Gatekeeper** prompts until the app is explicitly allowed, and **Windows SmartScreen** may warn on first launch. For broader distribution, plan **Apple notarization** (Developer ID Application certificate plus `notarytool`) and **Windows code signing** so first run and updates align with typical expectations for signed desktop software.

---

## 3. First launch and navigation

- The main window is a **single desktop app** with a **sidebar** and **slide-over** drawers. You can **resize** panel widths and choose which **screen edge** the chat list and knowledge panel slide in from; those choices are remembered for that window.
- Use the **navigation buttons** to open:
  - **Models** (drawer title *Browse models*) — Hugging Face recommendations or search, sortable/filterable cards, expandable rows, hardware hints where available, **Download** (GGUF preferred, else Safetensors + config/tokenizer/shards into a per-repo subfolder), or mapped **Ollama pull** when the top bar is on Ollama.
  - **Your AI (Run)** — start/stop inference, install helpers, download registry, model path picker.
  - **Training** — optional LoRA job launcher (requires Python).
  - **Metrics** — time-series charts (RSS, CPU, GPU when `nvidia-smi` exists, tokens, context, latency, etc.) in a responsive grid; content can be **pinned** to a dock edge.
  - **Settings** — models folder, **Appearance** (accent presets: violet, teal, amber, rose, sky), pinned widgets, inference limits, llama binary and **Safetensors→GGUF** script paths, IDE bridge, maintenance, Hugging Face token.

The **top bar** (separate from the sidebar) sets the backend: **Ollama** or **Files on my PC** (llama.cpp `llama-server`). The header shows a **runtime** status; you can use it to jump to **Run**.

**Look and feel:** Dark **glass** UI with shared theme tokens, selectable **accent** schemes, and capsule scrollbars.

---

## 4. Hugging Face token (optional)

Many public models work **without** a token; some repos are **gated** or **rate-limited** without one.

1. Open **Settings**.
2. Paste your Hugging Face **access token** and save (the app stores it securely when the OS supports it).
3. Return to **Models** in the app to search, open model pages, and download.

If downloads fail with permission errors, verify the model’s page on the Hub and your token scope.

---

## 5. Inference runtime (required for chat)

The app does **not** replace Ollama or llama.cpp; it **talks to** whichever backend you choose from the **top bar**.

### 5.1 Option A — Ollama

1. Install Ollama from [https://ollama.com/](https://ollama.com/) and ensure it is running (default API: `http://127.0.0.1:11434`).
2. Set the top bar to **Ollama**.
3. In **Settings**, confirm **Ollama base URL** if you use a non-default host/port (default is `http://127.0.0.1:11434`).
4. **Pull models with Ollama** outside the app, e.g. `ollama pull llama3.2`, then enter that **model tag** (e.g. `llama3.2`) in the **Run** drawer **Model** field. You can also pull some models from the **Models** hub when the card maps to a known Ollama library name.
5. Click **Start**. Status should show **Running** and the endpoint.

Ollama keeps weights in **its own** store. **GGUF** files downloaded through the **Models** hub land under your **models directory**; to run those with `llama-server`, switch the top bar to **Files on my PC** (below).

### 5.2 Option B — Files on my PC (llama.cpp server)

1. Install a build that includes **`llama-server`** (see [llama.cpp releases](https://github.com/ggerganov/llama.cpp/releases) and [server documentation](https://github.com/ggerganov/llama.cpp/blob/master/tools/server/README.md)).
2. Either put `llama-server` on your **PATH**, or note the **full path** to the executable.
3. Set the top bar to **Files on my PC**. Open **Your AI (Run)**; if **llama-server** is not detected, set the **Binary** path in **Settings**, then **Start**.
4. For **Model**, use the **full path to a `.gguf` file**. Download **GGUF** (or Safetensors bundles) from **Models**; installs use a **per-repo subfolder** with Hub-relative paths so `config.json` sits next to weights when the Hub listing includes it. For **`.safetensors`** inference, configure **`convert_hf_to_gguf.py`** (and Python) in **Settings → AI engine** so the app can build a cached GGUF once.

Default HTTP port for the spawned server is **8080** unless you change **llama port** in Settings.

### 5.3 Stopping the runtime

Use **Stop** in the **Run** drawer. For llama.cpp, the app manages the child process; for Ollama, the app stops **its use** of the API (Ollama itself may keep running as a system service).

---

## 6. Models directory

- Hub installs go under your **models directory** inside a folder named from **repo + revision** (shortened), with **original relative paths** preserved inside it (e.g. `config.json` and weight files as on the Hub). Default models location is under app **user data** (shown in Settings).
- You can **change** the models folder in **Settings**. The app will create it if possible.
- **Deleting all models** is a destructive action in Settings: it removes files under the **current** models directory after a **system confirmation** dialog.
- **Download resume** after an app restart uses the stored Hub file path on each download row; stale or pre-layout migrations may need you to clear the download row and download again.

---

## 7. Chat, knowledge base, and wiki

### 7.1 Chat

1. Ensure the **runtime is running** (section 5).
2. Create or select a **conversation**, send messages. The app **stores** history in a local database.
3. Under each assistant bubble, **token usage** can show **Sent** and **Generated** counts when the runtime reports them; totals accumulate per conversation for reference.

**Max response length:** In **Settings**, set **Max response tokens** to cap how long each completion may run (applies to chat in the app and to the optional **IDE integration** HTTP bridge).

### 7.2 Knowledge (RAG) and wiki

- You can **ingest** text, files, or content from a conversation into the **knowledge base** (see Knowledge-related actions in the UI).
- The app **chunks** text, indexes it for **search**, and can surface **wiki-style** topics and pages for browsing.
- In **Knowledge wiki**, use the **Knowledge graph** tab for a visual map of **sources** (ingested topics), their **chunks**, and **wiki pages**, including how pages link to chunks and weak **related** links between sources with similar titles. Click a **source** or **chunk** to jump back to the **Read** tab for that topic. Large libraries are **sampled** in the graph so the view stays responsive; use **Refresh** after adding documents.
- **Wiki-linked terms** can appear as **inline highlights** in assistant messages (hover for a snippet, click to open the wiki article) when those terms are configured for the session.
- With the runtime running, **Settings → Chat generation → Auto-extract wiki notes after each reply** (on by default) runs a **second, short** local completion after every assistant message to distill **bullet notes** into the knowledge base. The model may answer **(skip)** when there is nothing worth saving. Extracted sources are tied to the **conversation** like “save chat to knowledge base” content, so they can be bulk-removed when you delete that chat (if you choose the option to remove linked knowledge). Disable the toggle to avoid the extra pass and token use.
- How strongly retrieval affects a reply depends on how the app **composes** the user turn (including retrieved snippets) before sending it to the model; keep the runtime on while experimenting.

**Repository wiki pages (optional):** If you develop from a git clone, Markdown under `[docs/wiki/](./wiki/)` describes the app architecture and knowledge semantics. Ingest those files with **+ Add document** if you want that material in your local wiki and RAG.

---

## 8. Training (optional)

The shipped `**train_lora.py`** script is a **minimal stub**: it writes a small manifest so the app can track a job. **Real LoRA/QLoRA training** requires you to install a Python stack (e.g. PyTorch, transformers, PEFT) and extend the script.

1. Install **Python 3** and any dependencies you add to the script.
2. Open **Training** in the app, choose **base model path** and **dataset path**, optionally set **Python executable** if `python` is not on `PATH`.
3. Start a job and monitor status. In development, the script runs from the `training/` folder; in packaged builds it runs from the app **resources** copy.

---

## 9. Metrics, downloads, and pinned widgets

Open **Metrics** for the full drawer: time-series charts (process **RSS**, **CPU**, optional **NVIDIA** GPU memory, runtime **tokens**, **context**, rolling **prompt→reply** latency, etc.) in a **responsive grid** (including a denser layout when the pinned surface is wide).

You can **pin** separate widgets to any **dock edge**:

- **Metrics** — compact stat grid and charts.
- **Downloads** — active Hub transfer progress.
- **Activity** — token send/receive bar chart for recent chat rounds.

Resize strip thickness/length, set **refresh interval**, and tune **flex weights** when multiple widgets stack. Preferences are stored in app settings.

---

## 10. Settings and maintenance

Beyond the table below, **Settings** includes:

- **Appearance** — accent preset (violet, teal, amber, rose, sky).
- **Chat generation** — **max response tokens** for completions.
- **AI engine** — `llama-server` path, **optional** `convert_hf_to_gguf.py` and Python executable for Safetensors→GGUF.
- **IDE integration (localhost)** — optional **HTTP bridge** on **127.0.0.1** for editor plugins (port, optional bearer token); see [IntelliJ / IDE integration](./intellij-integration.md).
- **Pinned widgets** — enable **metrics**, **downloads**, and/or **activity** pins; dock edge; refresh interval; strip size; relative weights when stacked.

### Developer journey: IntelliJ

Typical flow for coding in **IntelliJ IDEA** with **local** models and **client-specific** vocabulary:

In the desktop app, open **IDE setup** in the left navigation for the same journey with **live** runtime and bridge status, **Test bridge** (loopback `GET /health` and `GET /v1/runtime/status`, optional **smoke** `POST /v1/chat` with `maxTokens: 1`), curl snippets, recent plugin activity, doc links, and a **checklist** stored in your local settings. Under **Settings → Integrations** you can enable **auto-mark** “first IDE chat” when the plugin posts a successful `chat_completed` report.

1. **One-time setup** — Install the app and **Ollama** or **`llama-server`**, set **models directory** and (optional) **Hugging Face token**. Build or install the sample plugin from [`integrations/intellij-plugin/`](../integrations/intellij-plugin/README.md) (Gradle `buildPlugin`, then **Settings → Plugins → Install Plugin from Disk…**). Full HTTP details: [IntelliJ / IDE integration](./intellij-integration.md).

2. **Each session** — Start **Local LLM Desktop**, load a model, **Start** the runtime from **Your AI (Run)**, then enable **IDE integration (localhost)** and match **port** (default `17373`) and optional **bearer token** in IntelliJ under **Settings → Tools → Local LLM Desktop**. The bridge does **not** start the runtime by itself; the plugin’s connection strip uses **`GET /health`** to show bridge vs runtime status.

3. **In the IDE** — Use the **Local LLM** tool window for prompts; turn on **Include codebase knowledge graph** when you want Java/Kotlin structure in the **system** context; attach key files (for example OpenAPI or a glossary). **Tools → Local LLM Chat…** can prefill from the current selection. Optional **inline completion** and structured apply blocks (`LOCAL_LLM_PATCH` / `LOCAL_LLM_FILE`) are described in [IntelliJ / IDE integration](./intellij-integration.md). **`[CLARIFY]`** replies trigger follow-up dialogs in the plugin.

4. **Domain vocabulary** — For terms that live in **code**, use the plugin’s **Vocabulary…** report (package-oriented scan). For **specs, glossaries, or exports**, ingest them into the app’s **knowledge base** (section 7) and use **in-app chat or wiki** to distill definitions you **paste** into the IDE or attach as files. The **`POST /v1/chat`** bridge forwards **only** the messages the plugin sends; it does **not** automatically inject knowledge-base RAG—plan context explicitly in the IDE or pull answers from the desktop first.

5. **When answers are thin** — Add attachments, enable the graph for the relevant modules, narrow the task, or query knowledge in the desktop app before asking for code in IntelliJ.

6. **Optional** — Pin **Activity** in the desktop app to see summaries the plugin posts to **`/v1/plugin/report`**. For heavier adaptation, see **Training** (section 8); the shipped script is a minimal stub until you extend it.

Slide-over **panel widths and edges** for chat/knowledge are stored separately in the window (not in this reset table).

**Destructive confirmations** (delete models, clear caches, factory reset, etc.) use the **operating system’s** message box so they layer above drawers and other UI.

| Action                     | What it does                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Clear download cache**   | Clears app-side download registry/HF cache metadata as implemented; cancels active downloads as applicable.                                                                                                                                                                                            |
| **Clear all caches**       | Broader cache clearing (see on-screen description when you use it).                                                                                                                                                                                                                                    |
| **Delete all models**      | Deletes files under the **current** models directory after confirmation; stops runtime and cancels downloads first.                                                                                                                                                                                    |
| **Factory reset (config)** | Resets **settings** to defaults (models folder, llama binary path, Ollama URL, ports, **max response tokens**, integration bridge options, widgets, **HF token**, and related UI prefs). Does **not** by itself delete chats, knowledge, wiki, or model files — read the confirmation text in the app. |


---

## 11. Troubleshooting


| Problem                                            | Things to try                                                                                                                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime won’t start (Ollama)**                   | Confirm Ollama is installed and listening (browser or `curl` to your base URL). Check **Settings → Ollama base URL**. Use a model tag you already pulled (`ollama list`).                                                           |
| **Runtime won’t start (Files on my PC / llama.cpp)** | Verify top bar is **Files on my PC**, `llama-server` path, `.gguf` path, and port **8080** (or your configured port) not in use by another program.                                                                                    |
| **HF search/download errors**                      | Add or refresh **HF token**; check model is public or your account has access; check disk space and models folder permissions. For **404** on resolve, ensure the app refreshed model metadata (cached entries without a commit `sha` are refetched). For **Safetensors**, confirm `config.json` and tokenizer files were listed on the Hub and downloaded into the same per-repo folder.                                                                                                      |
| **Safetensors won’t run**                          | `llama-server` needs **GGUF**. Set **convert_hf_to_gguf.py** and Python in Settings, or download a **GGUF** repo when available.                                                                                                                |
| **Packaging failed on Windows**                    | Close File Explorer windows pointing at `release\`, exit any running copy of the app, then run `npm run dist:zip` or `npm run dist:installer` again. The script may write to `release-builds/<timestamp>/` if `release/` is locked. |
| **SQLite / native module errors after `git pull`** | Run `npm install` again so `better-sqlite3` rebuilds for the current Electron version.                                                                                                                                              |


### 11.1 Log files

The app writes logs under your **user data** directory, in a `**logs`** subfolder. If you report an issue, those files help diagnose IPC, download, and runtime errors.

---

## 12. Privacy, data location, and license

- **Chats, knowledge, wiki, metrics history, and download registry** live in a **local SQLite database** under user data.
- **Models** live in your chosen **models directory** (Hub installs use per-repo subfolders with preserved paths).
- **Hugging Face token** is stored locally; **factory reset** removes it from app storage as described in the UI.

**License:** The project is distributed under the **PolyForm Noncommercial License 1.0.0** with additional terms (copyright **Cyril Grossenbacher**, commercial licensing, modifications, and risk). See the **`LICENSE`** file in the repository and the website **License** page. Noncommercial use is covered by PolyForm; **commercial use requires a separate agreement**.

---

## 13. Quick start checklist

1. Install the app (zip or `npm run dev`).
2. (Optional) Add **Hugging Face token** in Settings.
3. Install **Ollama** *or* **`llama-server`**, set the top bar to **Ollama** or **Files on my PC**, open **Your AI (Run)**, and **Start** with a model tag or `.gguf` path.
4. From **Models**, **Download** a Hub model (GGUF preferred) or use **`ollama pull`** when on Ollama with a mapped card.
5. Open **Chat** and send a message.

For architecture and technical detail, see the [arc42 architecture index](./architecture-arc42/README.md).