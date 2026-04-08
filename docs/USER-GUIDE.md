# User Guide — Local LLM Desktop

This guide explains how to install, configure, and run **Local LLM Desktop**: browse Hugging Face models, download files locally, chat with a local inference runtime, and optionally use the knowledge base, metrics, and training tools.

---

## 1. What you need

### 1.1 Computer requirements

- **Windows** (x64), **macOS** (Intel or Apple Silicon), or **Linux** (x64), matching the zip you install.
- Enough **disk space** for models (often several gigabytes per model).
- An **inference backend** (see section 5): either **Ollama** or **llama.cpp**’s `llama-server`.

### 1.2 Optional but useful

- **Hugging Face account token** — improves API rate limits and access to gated models. Create one at [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
- **NVIDIA GPU** — not required; metrics can show GPU memory when `nvidia-smi` is available.
- **Python 3** — only if you use the optional training workflow (see section 8).

---

## 2. Install the application

### 2.1 From a release zip (recommended for end users)

1. Unzip `**Local LLM Desktop-<version>-<platform>.zip`** to a folder of your choice.
2. Run `**Local LLM Desktop.exe**` (Windows) or the app bundle inside the zip (macOS/Linux layout depends on electron-builder output).
3. On first launch, the app creates its **user data** folder (database, logs, default models directory). You do not need to run anything as administrator for normal use.

### 2.2 From source (developers)

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

Output appears under `release/` or, if that folder is locked on Windows, under `release-builds/<timestamp>/`.

---

## 3. First launch and navigation

- The main window is a **single desktop app** with a **sidebar** and slide-out panels for tools.
- Use the **navigation buttons** to open:
  - **Hugging Face** — search models, open details, download `.gguf` (or other) files.
  - **Runtime** — choose Ollama or llama.cpp, start/stop inference, see status.
  - **Training** — optional LoRA job launcher (requires Python).
  - **Metrics** — charts for throughput, CPU/RSS, optional GPU.
  - **Settings** — models folder, maintenance actions, Hugging Face token.

The header shows a **runtime pill** (“Runtime on” / “Runtime off”); click it to jump to the Runtime panel.

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

### 7.2 Knowledge (RAG) and wiki

- You can **ingest** text, files, or content from a conversation into the **knowledge base** (see Knowledge-related actions in the UI).
- The app **chunks** text, indexes it for **search**, and can surface **wiki-style** topics and pages for browsing.
- How strongly retrieval affects a reply depends on how the app composes context for the model; keep the runtime on while experimenting.

---

## 8. Training (optional)

The shipped `**train_lora.py`** script is a **minimal stub**: it writes a small manifest so the app can track a job. **Real LoRA/QLoRA training** requires you to install a Python stack (e.g. PyTorch, transformers, PEFT) and extend the script.

1. Install **Python 3** and any dependencies you add to the script.
2. Open **Training** in the app, choose **base model path** and **dataset path**, optionally set **Python executable** if `python` is not on `PATH`.
3. Start a job and monitor status. In development, the script runs from the `training/` folder; in packaged builds it runs from the app **resources** copy.

---

## 9. Metrics

Open **Metrics** to view **tokens/sec**, **context usage**, **process CPU/RSS**, and optional **GPU** memory (when `nvidia-smi` is available). You can pin a compact widget and adjust refresh interval in **Settings**.

---

## 10. Settings and maintenance


| Action                     | What it does                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Clear download cache**   | Clears app-side download registry/HF cache metadata as implemented; cancels active downloads as applicable.                                                                                                                            |
| **Clear all caches**       | Broader cache clearing (see on-screen description when you use it).                                                                                                                                                                    |
| **Delete all models**      | Deletes files under the **current** models directory after confirmation; stops runtime and cancels downloads first.                                                                                                                    |
| **Factory reset (config)** | Resets **settings** to defaults (models folder preference, llama binary path, Ollama URL, ports, widgets, **HF token**). Does **not** by itself delete chats, knowledge, wiki, or model files — read the confirmation text in the app. |


---

## 11. Troubleshooting


| Problem                                            | Things to try                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime won’t start (Ollama)**                   | Confirm Ollama is installed and listening (browser or `curl` to your base URL). Check **Settings → Ollama base URL**. Use a model tag you already pulled (`ollama list`).                               |
| **Runtime won’t start (llama.cpp)**                | Verify `llama-server` path, `.gguf` path, and port **8080** (or your configured port) not in use by another program.                                                                                    |
| **HF search/download errors**                      | Add or refresh **HF token**; check model is public or your account has access; check disk space and models folder permissions.                                                                          |
| **Packaging failed on Windows**                    | Close File Explorer windows pointing at `release\`, exit any running copy of the app, then run `npm run dist:zip` again. The script may write to `release-builds/<timestamp>/` if `release/` is locked. |
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
4. Download a `**.gguf`** (llama.cpp) or `**ollama pull**` a model (Ollama) and point the app at the right path or tag.
5. Open **Chat** and send a message.

For architecture and technical detail, see the [arc42 architecture index](./architecture-arc42/README.md).