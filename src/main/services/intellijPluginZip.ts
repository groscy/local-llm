import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import type { SaveIntellijPluginZipResult } from '@shared/types'

/**
 * Expected Gradle `buildPlugin` artifact name. Keep in sync with
 * `integrations/intellij-plugin/build.gradle.kts` → `version`.
 */
export const INTELLIJ_PLUGIN_ZIP_BASENAME = 'local-llm-intellij-0.2.5.zip'

const GITHUB_LATEST_PLUGIN_URL = `https://github.com/localllm/local-llm-desktop/releases/latest/download/${INTELLIJ_PLUGIN_ZIP_BASENAME}`

const ZIP_NAME_RE = /^local-llm-intellij-.+\.zip$/i

function pickNewestZipInDir(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const names = fs.readdirSync(dir).filter((n) => ZIP_NAME_RE.test(n))
  if (names.length === 0) return null
  names.sort()
  return path.join(dir, names[names.length - 1]!)
}

/** Packaged app: optional `extraResources` copy under `resources/intellij-plugin/`. */
function resolveBundledZip(): string | null {
  if (!app.isPackaged) return null
  const dir = path.join(process.resourcesPath, 'intellij-plugin')
  const exact = path.join(dir, INTELLIJ_PLUGIN_ZIP_BASENAME)
  if (fs.existsSync(exact)) return exact
  return pickNewestZipInDir(dir)
}

/** Dev / repo: Gradle output under `integrations/intellij-plugin/build/distributions`. */
function resolveDevBuildZip(): string | null {
  const distRel = path.join('integrations', 'intellij-plugin', 'build', 'distributions')
  const roots = [path.join(app.getAppPath(), distRel), path.join(process.cwd(), distRel)]
  for (const dir of roots) {
    const exact = path.join(dir, INTELLIJ_PLUGIN_ZIP_BASENAME)
    if (fs.existsSync(exact)) return exact
    const picked = pickNewestZipInDir(dir)
    if (picked) return picked
  }
  return null
}

function resolveLocalSourceZip(): { path: string; source: 'bundled' | 'local-build' } | null {
  const bundled = resolveBundledZip()
  if (bundled) return { path: bundled, source: 'bundled' }
  const dev = resolveDevBuildZip()
  if (dev) return { path: dev, source: 'local-build' }
  return null
}

async function downloadFromGitHubLatest(dest: string): Promise<void> {
  const res = await fetch(GITHUB_LATEST_PLUGIN_URL, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(
      `Download failed (HTTP ${res.status}). Ensure "${INTELLIJ_PLUGIN_ZIP_BASENAME}" is attached to the latest GitHub release, or build the plugin locally (Gradle buildPlugin).`
    )
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 2048) {
    throw new Error(
      'Downloaded file is too small to be a valid plugin ZIP (release asset may be missing). Build from integrations/intellij-plugin or attach the ZIP to a GitHub release.'
    )
  }
  await fsPromises.writeFile(dest, buf)
}

export async function saveIntellijPluginZipWithDialog(win: BrowserWindow | null): Promise<SaveIntellijPluginZipResult> {
  const opts = {
    title: 'Save IntelliJ plugin',
    defaultPath: INTELLIJ_PLUGIN_ZIP_BASENAME,
    filters: [{ name: 'Plugin ZIP', extensions: ['zip'] }]
  }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return { ok: false, canceled: true }

  let dest = r.filePath
  if (!dest.toLowerCase().endsWith('.zip')) dest += '.zip'

  const local = resolveLocalSourceZip()
  try {
    if (local) {
      await fsPromises.copyFile(local.path, dest)
      return { ok: true, path: dest, source: local.source }
    }
    await downloadFromGitHubLatest(dest)
    return { ok: true, path: dest, source: 'download' }
  } catch (e) {
    try {
      await fsPromises.unlink(dest)
    } catch {
      /* ignore */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
