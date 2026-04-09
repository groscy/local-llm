#!/usr/bin/env node
/**
 * Typecheck → electron-vite build → platform installer (no zip).
 *
 * - Windows: NSIS Setup .exe (per-user or elevated install, Start Menu + desktop shortcuts)
 * - macOS:     DMG (drag to Applications)
 * - Linux:     .deb (apt/dpkg) + AppImage (portable); .rpm available via electron-builder --linux rpm on RPM hosts
 *
 * Output: ./release/ or ./release-builds/<timestamp>/ (same rules as package-zip.mjs).
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

function installerLabel() {
  if (process.platform === 'win32') return 'electron-builder (Windows NSIS installer)'
  if (process.platform === 'darwin') return 'electron-builder (macOS DMG)'
  return 'electron-builder (Linux .deb + AppImage)'
}

async function main() {
  run('Typecheck', npm, ['run', 'typecheck'])
  run('electron-vite build', npm, ['run', 'build'])

  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    console.error('Missing out/main/index.js after build — aborting package step.')
    process.exit(1)
  }

  const outDir = await pickOutputDirRelative()
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

  const ebArgs = ['electron-builder', '--publish', 'never', `-c.directories.output=${outDir}`]

  if (process.platform === 'win32') {
    ebArgs.push('--win', 'nsis')
  } else if (process.platform === 'darwin') {
    ebArgs.push('--mac', 'dmg')
  } else {
    ebArgs.push('--linux', 'deb', 'AppImage')
  }

  run(installerLabel(), npx, ebArgs)

  console.log(`\n✓ Installer build finished. Output directory: ${outDir}/\n`)
  if (process.platform === 'win32') {
    console.log('  Look for: Local LLM Desktop-Setup-<version>.exe\n')
  } else if (process.platform === 'darwin') {
    console.log('  Look for: Local LLM Desktop-<version>-<arch>.dmg\n')
  } else {
    console.log('  Look for:\n')
    console.log('    - Local LLM Desktop-<version>-linux-x64.deb  →  sudo apt install ./<file>.deb   (or: sudo dpkg -i <file>.deb)\n')
    console.log('    - Local LLM Desktop-<version>-linux-x64.AppImage  →  chmod +x <file>.AppImage && ./<file>.AppImage\n')
    console.log('  Optional RPM (Fedora/RHEL, after npm run build): npx electron-builder --publish never -c.directories.output=release --linux rpm\n')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
