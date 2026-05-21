/**
 * Before `npm run dev`, ensure the compiled preload exposes `ollamaListTags`.
 * Stale `out/preload/index.cjs` (e.g. after pulling) causes "is not a function" in the renderer.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const preloadCjs = join(root, 'out', 'preload', 'index.cjs')

function needsRebuild() {
  if (!existsSync(preloadCjs)) return true
  try {
    const s = readFileSync(preloadCjs, 'utf8')
    return (
      !s.includes('ollamaListTags') ||
      !s.includes('runtime:ollamaTags') ||
      !s.includes('ollamaPullModel') ||
      !s.includes('runtime:ollamaPull') ||
      !s.includes('claudeBridgeStart') ||
      !s.includes('integration:claudeBridgeStart') ||
      !s.includes('kbKeywordGraph') ||
      !s.includes('kbKeywordGraphNeighbors') ||
      !s.includes('kbKeywordGraphSearch') ||
      !s.includes('kb:keywordGraph') ||
      !s.includes('kb:keywordGraphNeighbors') ||
      !s.includes('kb:keywordGraphSearch')
    )
  } catch {
    return true
  }
}

if (needsRebuild()) {
  console.warn('[ensure-preload-api] Preload is missing expected runtime/HF APIs; running electron-vite build…')
  execSync('npx electron-vite build', { cwd: root, stdio: 'inherit', shell: true })
}
