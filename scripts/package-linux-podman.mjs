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
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PODMAN = 'podman'

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

  const imageTag = (process.env.LINUX_CONTAINER_IMAGE || 'localllm-linux-build').trim()
  const outRel = (process.env.LINUX_RELEASE_OUT || 'release-linux').replace(/\\/g, '/').replace(/^\/+/, '')
  const destDir = join(root, outRel)

  const buildArgs = ['build', '-f', 'Dockerfile.linux', '-t', imageTag, '.']
  if (process.env.CONTAINER_NO_CACHE === '1') {
    buildArgs.splice(1, 0, '--no-cache')
  }

  run(`${PODMAN} build (Linux toolchain inside container)`, PODMAN, buildArgs)

  const containerName = `localllm-linux-out-${Date.now()}`
  run(`${PODMAN} create (extract artifacts)`, PODMAN, ['create', '--name', containerName, imageTag])

  try {
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true })
    }
    mkdirSync(destDir, { recursive: true })

    run(
      `${PODMAN} cp release/ → host`,
      PODMAN,
      ['cp', `${containerName}:/app/release/.`, destDir]
    )
  } finally {
    const rm = spawnSync(PODMAN, ['rm', containerName], { cwd: root, stdio: 'inherit', shell: false })
    if (rm.status !== 0) {
      console.warn(
        `\n! Could not remove container ${containerName}; remove manually: ${PODMAN} rm ${containerName}\n`
      )
    }
  }

  console.log(`\n✓ Linux artifacts copied to ${outRel}/\n`)
  console.log('  Look for .deb, .AppImage, .pkg.tar.* (Arch), and .zip (and linux-unpacked/) in that folder.\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
