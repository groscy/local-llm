#!/usr/bin/env node
/**
 * Typecheck → electron-vite build → IntelliJ plugin (Gradle) → Linux release artifacts (.deb, AppImage, .zip).
 * Packaging needs **JDK 17+** on `PATH` for `npm run build:intellij-plugin`.
 *
 * Must run on **Linux** (or Linux container): `better-sqlite3` is compiled for the host OS.
 * On Windows/macOS, use GitHub Actions (`.github/workflows/build-linux.yml`) or Podman:
 *
 *   npm run dist:linux:podman
 *   npm run dist:linux:rpi5:podman
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
const argv = process.argv.slice(2)

function resolveLinuxFlavor() {
  const explicitFlavorArg = argv.find((arg) => arg.startsWith('--flavor='))
  if (explicitFlavorArg) return explicitFlavorArg.slice('--flavor='.length).trim().toLowerCase()
  if (argv.includes('--cpu')) return 'cpu'
  if (argv.includes('--rpi5') || argv.includes('--arm64')) return 'rpi5'
  return (process.env.BUILD_FLAVOR || 'default').trim().toLowerCase()
}

function resolveLinuxArchFlag(flavor) {
  const explicitArchArg = argv.find((arg) => arg.startsWith('--arch='))
  const envArch = (process.env.LINUX_PACKAGE_ARCH || '').trim().toLowerCase()
  const argArch = explicitArchArg ? explicitArchArg.slice('--arch='.length).trim().toLowerCase() : ''
  const arch = argArch || envArch || (flavor === 'rpi5' ? 'arm64' : 'x64')
  if (arch === 'arm64' || arch === 'aarch64') return '--arm64'
  return '--x64'
}

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
  console.warn(`\n! Could not clear release/ — writing to ${alt.replace(/\\/g, '/')}/ instead.\n`)
  return alt.replace(/\\/g, '/')
}

async function main() {
  if (process.platform !== 'linux' && process.env.ALLOW_LINUX_PACKAGING_OUTSIDE_LINUX !== '1') {
    console.error(`
✖ Linux packaging must run on Linux (native Node add-ons).

  From Windows or macOS, use Podman (full Linux build inside a container image):

    npm run dist:linux:podman
    npm run dist:linux:rpi5:podman

  Other options:
    • CI: .github/workflows/build-linux.yml
    • Manual: see header in Dockerfile.linux (podman build / create / cp / rm)

  To force this script on a non-Linux host: ALLOW_LINUX_PACKAGING_OUTSIDE_LINUX=1 npm run dist:linux
`)
    process.exit(2)
  }

  run('Typecheck', npm, ['run', 'typecheck'])
  run('electron-vite build', npm, ['run', 'build'])
  run('IntelliJ plugin (Gradle)', npm, ['run', 'build:intellij-plugin'])

  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    console.error('Missing out/main/index.js after build — aborting.')
    process.exit(1)
  }

  const outDir = await pickOutputDirRelative()
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  const flavor = resolveLinuxFlavor()
  const builderConfig =
    flavor === 'cpu'
      ? 'electron-builder.linux-cpu.yml'
      : flavor === 'rpi5'
        ? 'electron-builder.linux-rpi5.yml'
        : 'electron-builder.yml'
  const archFlag = resolveLinuxArchFlag(flavor)

  const targetsDefault = flavor === 'rpi5' ? 'deb AppImage zip' : 'deb AppImage zip pacman'
  const targets = (process.env.LINUX_PACKAGE_TARGETS || targetsDefault)
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const ebArgs = [
    'electron-builder',
    '--publish',
    'never',
    '--config',
    builderConfig,
    `-c.directories.output=${outDir}`,
    archFlag,
    '--linux',
    ...targets
  ]

  run('electron-builder (Linux)', npx, ebArgs)

  console.log(`\n✓ Linux build finished. Output: ${outDir}/\n`)
  const flavorLabel = flavor === 'cpu' ? 'cpu' : flavor === 'rpi5' ? 'rpi5' : 'default'
  console.log(`  Flavor: ${flavorLabel}\n`)
  console.log(`  Architecture: ${archFlag === '--arm64' ? 'arm64' : 'x64'}\n`)
  console.log('  Typical files:\n')
  console.log('    *.deb          →  sudo apt install ./<file>.deb\n')
  console.log('    *.AppImage     →  chmod +x <file>.AppImage && ./<file>.AppImage\n')
  console.log('    *.pkg.tar.*    →  Arch: sudo pacman -U ./<file>\n')
  console.log('    *.zip          →  portable unpacked layout + archive\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
