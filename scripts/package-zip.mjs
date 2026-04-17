#!/usr/bin/env node
/**
 * Typecheck → electron-vite build → IntelliJ plugin (Gradle) → electron-builder **zip only** for the current OS (see `dist:installer` for NSIS/DMG/AppImage).
 * Packaging needs **JDK 17+** on `PATH` for `npm run build:intellij-plugin`.
 *
 * Output: ./release/ when that folder can be cleared, otherwise ./release-builds/<timestamp>/
 * (Windows often locks release/win-unpacked — close Explorer / the app if you want a stable path).
 *
 * Code signing is disabled (CSC_IDENTITY_AUTO_DISCOVERY=false) so packaging works without
 * Developer Mode symlinks for winCodeSign.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const shell = isWin
const npm = isWin ? 'npm.cmd' : 'npm'
const npx = isWin ? 'npx.cmd' : 'npx'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function run(label, command, args) {
  console.log(`\n▶ ${label}\n`)
  const r = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell,
    env: { ...process.env, FORCE_COLOR: '1' }
  })
  if (r.status !== 0 && r.status !== null) {
    console.error(`\n✖ ${label} failed (exit ${r.status})\n`)
    process.exit(r.status)
  }
  if (r.error) {
    console.error(r.error)
    process.exit(1)
  }
}

/** Prefer release/; fall back to release-builds/<iso>/ if release is locked. */
async function pickOutputDirRelative() {
  const releaseDir = join(root, 'release')
  for (let i = 0; i < 5; i++) {
    try {
      if (existsSync(releaseDir)) rmSync(releaseDir, { recursive: true, force: true })
      return 'release'
    } catch {
      await sleep(500)
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const alt = join('release-builds', stamp)
  mkdirSync(join(root, alt), { recursive: true })
  console.warn(
    `\n! Could not clear release/ — writing to ${alt.replace(/\\/g, '/')} instead.\n` +
      '  Close File Explorer / running app using release/, delete release/ manually, then the next run can use release/ again.\n'
  )
  return alt.replace(/\\/g, '/')
}

async function main() {
  run('Typecheck', npm, ['run', 'typecheck'])
  run('electron-vite build', npm, ['run', 'build'])
  run('IntelliJ plugin (Gradle)', npm, ['run', 'build:intellij-plugin'])

  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    console.error('Missing out/main/index.js after build — aborting package step.')
    process.exit(1)
  }

  const outDir = await pickOutputDirRelative()
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

  const ebArgs = ['electron-builder', '--publish', 'never', `-c.directories.output=${outDir}`]
  if (process.platform === 'win32') {
    ebArgs.push('--win', 'zip')
  } else if (process.platform === 'darwin') {
    ebArgs.push('--mac', 'zip')
  } else {
    ebArgs.push('--linux', 'zip')
  }

  run('electron-builder (zip only)', npx, ebArgs)

  console.log(`\n✓ Done. Output directory: ${outDir}/ (zip + unpacked app)\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
