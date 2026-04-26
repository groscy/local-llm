#!/usr/bin/env node
/**
 * Linux release (.deb, AppImage, pacman for Arch, .zip) using **Podman** — works from **Windows**, macOS, or Linux.
 *
 * Runs the full pipeline inside `Dockerfile.linux` (OCI image; Podman builds it rootless-friendly)
 * so `better-sqlite3` and electron-builder target Linux x64, not the host OS.
 *
 * Prerequisites: [Podman](https://podman.io/) installed and working (`podman version`).
 * Windows: Podman Desktop or WSL2 + podman; start the Podman machine if your setup requires it.
 *
 *   npm run dist:linux:podman
 *
 * Output directory (default `./release-linux/`): LINUX_RELEASE_OUT=my-dir
 * Image name: LINUX_CONTAINER_IMAGE=localllm-linux-build
 * Fresh build (no cache): CONTAINER_NO_CACHE=1
 * Container platform override: LINUX_CONTAINER_PLATFORM=linux/arm64
 * Flavor override: BUILD_FLAVOR=cpu|rpi5 (or pass `--cpu` / `--rpi5` / `--flavor=...`)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PODMAN = 'podman'
const argv = process.argv.slice(2)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveLinuxFlavor() {
  const explicitFlavorArg = argv.find((arg) => arg.startsWith('--flavor='))
  if (explicitFlavorArg) return explicitFlavorArg.slice('--flavor='.length).trim().toLowerCase()
  if (argv.includes('--cpu')) return 'cpu'
  if (argv.includes('--rpi5') || argv.includes('--arm64')) return 'rpi5'
  return (process.env.BUILD_FLAVOR || process.env.LINUX_BUILD_FLAVOR || 'default').trim().toLowerCase()
}

function preferredHostLinuxPlatform() {
  if (process.arch === 'arm64') return 'linux/arm64'
  if (process.arch === 'x64') return 'linux/amd64'
  return 'linux/amd64'
}

function shouldUseContainerPlatformOverride(flavor) {
  const platform = (process.env.LINUX_CONTAINER_PLATFORM || '').trim()
  if (!platform) {
    if (flavor === 'rpi5') {
      // Build inside a host-compatible container and let electron-builder emit ARM64 artifacts.
      return { use: true, platform: preferredHostLinuxPlatform() }
    }
    return { use: false, platform: '' }
  }
  const forceEmulation = process.env.FORCE_CONTAINER_EMULATION === '1'
  if (flavor === 'rpi5' && /linux\/arm64/i.test(platform) && !forceEmulation) {
    console.warn(
      '\n! Ignoring LINUX_CONTAINER_PLATFORM=linux/arm64 for rpi5 build (can cause Exec format error without emulation).\n' +
        `  Using ${preferredHostLinuxPlatform()} container + ARM64 packaging flags instead.\n` +
        '  Set FORCE_CONTAINER_EMULATION=1 to force linux/arm64 container emulation.\n'
    )
    return { use: true, platform: preferredHostLinuxPlatform() }
  }
  return { use: true, platform }
}

function run(label, command, args, extra = {}) {
  console.log(`\n▶ ${label}\n`)
  const r = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, FORCE_COLOR: '1' },
    ...extra
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

function podmanWorks() {
  const r = spawnSync(PODMAN, ['version'], {
    cwd: root,
    stdio: 'pipe',
    shell: false
  })
  return r.status === 0
}

async function main() {
  if (!podmanWorks()) {
    console.error(`
✖ Podman is not available or the backend (e.g. Podman machine) is not running.

  Install Podman, then retry:
    npm run dist:linux:podman

  Windows: https://podman-desktop.io/  or Podman in WSL2
`)
    process.exit(1)
  }

  const flavor = resolveLinuxFlavor()
  const normalizedFlavor = flavor === 'cpu' ? 'cpu' : flavor === 'rpi5' ? 'rpi5' : 'default'
  const imageTag = (process.env.LINUX_CONTAINER_IMAGE || `localllm-linux-build${normalizedFlavor === 'default' ? '' : `-${normalizedFlavor}`}`).trim()
  const defaultOutDir =
    normalizedFlavor === 'cpu' ? 'release-linux-cpu' : normalizedFlavor === 'rpi5' ? 'release-linux-rpi5' : 'release-linux'
  const baseOutRel = (process.env.LINUX_RELEASE_OUT || defaultOutDir)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')

  const buildArgs = [
    'build',
    '-f',
    'Dockerfile.linux',
    '--build-arg',
    `BUILD_FLAVOR=${normalizedFlavor}`,
    '-t',
    imageTag,
    '.'
  ]
  const platformOverride = shouldUseContainerPlatformOverride(normalizedFlavor)
  if (platformOverride.use) {
    buildArgs.splice(1, 0, '--platform', platformOverride.platform)
  }
  if (process.env.CONTAINER_NO_CACHE === '1') {
    buildArgs.splice(1, 0, '--no-cache')
  }

  run(`${PODMAN} build (Linux toolchain inside container, flavor=${normalizedFlavor})`, PODMAN, buildArgs)

  const containerName = `localllm-linux-out-${Date.now()}`
  run(`${PODMAN} create (extract artifacts)`, PODMAN, ['create', '--name', containerName, imageTag])

  try {
    let outRel = baseOutRel
    let destDir = join(root, outRel)
    let prepared = false
    for (let i = 0; i < 5; i++) {
      try {
        if (existsSync(destDir)) {
          rmSync(destDir, { recursive: true, force: true })
        }
        mkdirSync(destDir, { recursive: true })
        prepared = true
        break
      } catch {
        await sleep(500)
      }
    }

    if (!prepared) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      outRel = `${baseOutRel}-builds/${stamp}`
      destDir = join(root, outRel)
      mkdirSync(destDir, { recursive: true })
      console.warn(`\n! Could not clear ${baseOutRel}/ (likely file lock). Writing to ${outRel}/ instead.\n`)
    }

    run(
      `${PODMAN} cp release/ → host`,
      PODMAN,
      ['cp', `${containerName}:/app/release/.`, destDir]
    )

    console.log(`\n✓ Linux artifacts copied to ${outRel}/\n`)
    console.log('  Look for .deb, .AppImage, .pkg.tar.* (Arch), and .zip (and linux-unpacked/) in that folder.\n')
  } finally {
    const rm = spawnSync(PODMAN, ['rm', containerName], { cwd: root, stdio: 'inherit', shell: false })
    if (rm.status !== 0) {
      console.warn(
        `\n! Could not remove container ${containerName}; remove manually: ${PODMAN} rm ${containerName}\n`
      )
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
