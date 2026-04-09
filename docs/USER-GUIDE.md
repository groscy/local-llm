# User Guide — Local LLM Desktop

This guide explains how to install, configure, and run **Local LLM Desktop**: browse Hugging Face models, download files locally, chat with a local inference runtime, and optionally use the knowledge base, metrics, and training tools.

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

| Platform | Artifact | What to do |
|----------|-----------|------------|
| **Windows** | `Local LLM Desktop-Setup-<version>.exe` | Run the installer, choose install location if prompted, use Start Menu or desktop shortcut. |
| **macOS** | `Local LLM Desktop-<version>-<arch>.dmg` | Open the DMG, drag **Local LLM Desktop** into **Applications**. |
| **Linux** | `Local LLM Desktop-<version>-linux-x64.deb` | **Debian / Ubuntu / Mint:** `sudo apt install ./Local\ LLM\ Desktop-<version>-linux-x64.deb` (or `sudo dpkg -i <file>.deb` then `sudo apt -f install` if dependencies are missing). Installs menu entry like a normal app. |
| **Linux** | `Local LLM Desktop-<version>-linux-x64.AppImage` | Portable single file: `chmod +x` then run, or use an AppImage desktop integration tool. |

Installers are produced from source with `**npm run dist:installer**` on the **same** OS you are targeting (output under `release/` or `release-builds/<timestamp>/`). **Linux packages must be built on Linux** (or **WSL2** with Ubuntu, from the Linux filesystem — not `/mnt/c/...` if native modules misbehave). **RPM** (Fedora/RHEL) is configured in `electron-builder.yml`; after `npm run build`, run `npx electron-builder --publish never --linux rpm` on an RPM-based system (or install the `rpm` toolchain on Debian if you need `.rpm` there). **zip** builds remain available if you prefer a portable folder.

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

**Create an installer** (NSIS on Windows, DMG on macOS, **.deb + AppImage** on Linux):

```bash
npm run dist:installer
```

Output appears under `release/` or, if that folder is locked on Windows, under `release-builds/<timestamp>/`. On Linux you should get both a **`.deb`** and an **`.AppImage`** in that directory.

---

## 3. First launch and navigation

- The main window is a **single desktop app** with a **sidebar** and **slide-over** panels for tools on narrower layouts. You can **resize** panel widths and choose which **screen edge** the chat list and knowledge panel slide in from; those choices are remembered in the browser storage for that window.
- Use the **navigation buttons** to open:
  - **Hugging Face** — search models, open details, download `.gguf` (or other) files.
  - **Runtime** — choose Ollama or llama.cpp, start/stop inference, see status.
  - **Training** — optional LoRA job launcher (requires Python).
  - **Metrics** — charts in a **two-column** layout for throughput, context usage, **process CPU and resident memory** (working set), and optional **GPU** memory when `nvidia-smi` is available.
  - **Settings** — models folder, appearance, widgets, inference limits, IDE bridge, maintenance, Hugging Face token.

The header shows a **runtime pill** (“Runtime on” / “Runtime off”); click it to jump to the Runtime panel.

**Look and feel:** Accent presets and **rounded scrollbars** use the app’s theme tokens so the UI stays consistent in light and dark modes.

---

## 4. Hugging Face token (optional)

Many public models work **without** a token; some repos are **gated** or **rate-limited** without one.

1. Open **Settings**.
2. Paste your Hugging Face **access token** and save (the app stores it securely when the OS supports it).
3. Return to **Hugging Face** in the app to search, open model pages, and download.

If downloads fail with permission errors, verify the model’s page on the Hub and your token scope.

---

## 5. Inference runtime (required for chat)

The app does **not** replace Ollama or llama.cpp; it **talks to** whichever backend you choose.

### 5.1 Option A — Ollama

1. Install Ollama from [https://ollama.com/](https://ollama.com/) and ensure it is running (default API: `http://127.0.0.1:11434`).
2. In the app, open **Runtime**, select **Ollama**.
3. In **Settings**, confirm **Ollama base URL** if you use a non-default host/port (default is `http://127.0.0.1:11434`).
4. **Pull models with Ollama** outside the app, e.g. `ollama pull llama3.2`, then enter that **model tag** (e.g. `llama3.2`) in the Runtime **Model** field.
5. Click **Start**. Status should show **Running** and the endpoint.

Hub downloads in this app are **files on disk**; Ollama uses its **own** model store unless you integrate via custom workflows. For `.gguf` files downloaded through the app, prefer **llama.cpp** (below).

### 5.2 Option B — llama.cpp server

1. Install a build that includes `**llama-server`** (see [llama.cpp releases](https://github.com/ggerganov/llama.cpp/releases) and [server documentation](https://github.com/ggerganov/llama.cpp/blob/master/tools/server/README.md)).
2. Either put `llama-server` on your **PATH**, or note the **full path** to the executable.
3. In **Runtime**, select **llama.cpp server**. If the app says **llama-server not detected**, use the **Binary** field to paste the full path, then **Start**.
4. For **Model**, use the **full path to a `.gguf` file**. You can download `.gguf` files from the **Hugging Face** panel; completed downloads are listed in Runtime for quick reference.

Default HTTP port for the spawned server is **8080** unless you change **llama port** in Settings.

### 5.3 Stopping the runtime

Use **Stop** in the Runtime panel. For llama.cpp, the app manages the child process; for Ollama, the app stops **its use** of the API (Ollama itself may keep running as a system service).

---

## 6. Models directory

- Downloaded files go under your **models directory**. Default location is inside app **user data** (shown in Settings as the default path).
- You can **change** the models folder in **Settings** (pick another directory on disk). The app will create it if possible.
- **Deleting all models** is a destructive action in Settings: it removes files under the **current** models directory after confirmation.

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
- With the runtime running, **Settings → Chat generation → Auto-extract wiki notes after each reply** (on by default) runs a **second, short** local completion after every assistant message to distill **bullet notes** into the knowledge base. The model may answer **(skip)** when there is nothing worth saving. Extracted sources are tied to the **conversation** like “save chat to knowledge base” content, so they can be bulk-removed when you delete that chat (if you choose the option to remove linked knowledge). Disable the toggle to avoid the extra pass and token use.
- How strongly retrieval affects a reply depends on how the app **composes** the user turn (including retrieved snippets) before sending it to the model; keep the runtime on while experimenting.

**Repository wiki pages (optional):** If you develop from a git clone, Markdown under [`docs/wiki/`](./wiki/) describes the app architecture and knowledge semantics. Ingest those files with **+ Add document** if you want that material in your local wiki and RAG.

---

## 8. Training (optional)

The shipped `**train_lora.py`** script is a **minimal stub**: it writes a small manifest so the app can track a job. **Real LoRA/QLoRA training** requires you to install a Python stack (e.g. PyTorch, transformers, PEFT) and extend the script.

1. Install **Python 3** and any dependencies you add to the script.
2. Open **Training** in the app, choose **base model path** and **dataset path**, optionally set **Python executable** if `python` is not on `PATH`.
3. Start a job and monitor status. In development, the script runs from the `training/` folder; in packaged builds it runs from the app **resources** copy.

---

## 9. Metrics and pinned activity

Open **Metrics** for the full drawer with **charts in a grid**. You can **pin** a compact **activity** strip (throughput, context, CPU, **resident memory**, GPU when available) to any **dock edge** and **resize** its thickness or length; dock side and dimensions are saved in app settings. Adjust the **metrics refresh interval** in **Settings** if you want calmer updates or quicker feedback.

---

## 10. Settings and maintenance

Beyond the table below, **Settings** includes:

- **Appearance** — accent / color scheme.
- **Chat generation** — **max response tokens** for completions.
- **IDE integration (localhost)** — optional **HTTP bridge** on **127.0.0.1** for editor plugins (port, optional bearer token); see [IntelliJ / IDE integration](./intellij-integration.md).
- **Pinned widgets** — which metrics appear on the pinned strip, dock edge, refresh interval, and bar size.

Slide-over **panel widths and edges** for chat/knowledge are stored separately in the window (not in this reset table).


| Action                     | What it does                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Clear download cache**   | Clears app-side download registry/HF cache metadata as implemented; cancels active downloads as applicable.                                                                                                                                                                                            |
| **Clear all caches**       | Broader cache clearing (see on-screen description when you use it).                                                                                                                                                                                                                                    |
| **Delete all models**      | Deletes files under the **current** models directory after confirmation; stops runtime and cancels downloads first.                                                                                                                                                                                    |
| **Factory reset (config)** | Resets **settings** to defaults (models folder, llama binary path, Ollama URL, ports, **max response tokens**, integration bridge options, widgets, **HF token**, and related UI prefs). Does **not** by itself delete chats, knowledge, wiki, or model files — read the confirmation text in the app. |


---

## 11. Troubleshooting


| Problem                                            | Things to try                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime won’t start (Ollama)**                   | Confirm Ollama is installed and listening (browser or `curl` to your base URL). Check **Settings → Ollama base URL**. Use a model tag you already pulled (`ollama list`).                               |
| **Runtime won’t start (llama.cpp)**                | Verify `llama-server` path, `.gguf` path, and port **8080** (or your configured port) not in use by another program.                                                                                    |
| **HF search/download errors**                      | Add or refresh **HF token**; check model is public or your account has access; check disk space and models folder permissions.                                                                          |
| **Packaging failed on Windows**                    | Close File Explorer windows pointing at `release\`, exit any running copy of the app, then run `npm run dist:zip` or `npm run dist:installer` again. The script may write to `release-builds/<timestamp>/` if `release/` is locked. |
| **SQLite / native module errors after `git pull`** | Run `npm install` again so `better-sqlite3` rebuilds for the current Electron version.                                                                                                                  |


### 11.1 Log files

The app writes logs under your **user data** directory, in a `**logs`** subfolder. If you report an issue, those files help diagnose IPC, download, and runtime errors.

---

## 12. Privacy and data location

- **Chats, knowledge, wiki, metrics history, and download registry** live in a **local SQLite database** under user data.
- **Models** live in your chosen **models directory**.
- **Hugging Face token** is stored locally; **factory reset** removes it from app storage as described in the UI.

---

## 13. Quick start checklist

1. Install the app (zip or `npm run dev`).
2. (Optional) Add **Hugging Face token** in Settings.
3. Install **Ollama** *or* `**llama-server`**, then configure **Runtime** and **Start**.
4. Download a `**.gguf`** (llama.cpp) or `**ollama pull`** a model (Ollama) and point the app at the right path or tag.
5. Open **Chat** and send a message.

For architecture and technical detail, see the [arc42 architecture index](./architecture-arc42/README.md).