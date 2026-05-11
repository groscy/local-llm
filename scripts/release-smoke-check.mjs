import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function fail(message) {
  console.error(`release-smoke-check: ${message}`)
  process.exit(1)
}

function walkFiles(rootDir) {
  const files = []
  if (!fs.existsSync(rootDir)) return files
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else {
        files.push(fullPath)
      }
    }
  }
  return files
}

function assertArtifacts(platform, files) {
  const rel = (p) => p.replaceAll('\\', '/')
  const normalized = files.map(rel)
  const hasAny = (matcher) => normalized.some(matcher)
  const requiredByPlatform = {
    linux: [
      { label: '.deb', matcher: (p) => p.endsWith('.deb') },
      { label: '.AppImage', matcher: (p) => p.endsWith('.AppImage') },
      { label: '.zip', matcher: (p) => p.endsWith('.zip') },
      { label: '.pkg.tar.*', matcher: (p) => p.includes('.pkg.tar.') }
    ],
    windows: [
      { label: '.exe', matcher: (p) => p.endsWith('.exe') },
      { label: '.zip', matcher: (p) => p.endsWith('.zip') }
    ],
    macos: [
      { label: '.dmg', matcher: (p) => p.endsWith('.dmg') },
      { label: '.zip', matcher: (p) => p.endsWith('.zip') }
    ]
  }

  const required = requiredByPlatform[platform]
  if (!required) fail(`unsupported platform '${platform}'`)

  for (const item of required) {
    if (!hasAny(item.matcher)) {
      fail(`missing required ${platform} artifact ${item.label} in release output`)
    }
  }
}

function findExecutable(platform, releaseDir) {
  if (platform === 'linux') {
    const linuxDir = path.join(releaseDir, 'linux-unpacked')
    if (!fs.existsSync(linuxDir)) fail('missing linux-unpacked directory')
    const entries = fs
      .readdirSync(linuxDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(linuxDir, entry.name))
    const preferred =
      entries.find((p) => /local.*llm.*desktop/i.test(path.basename(p))) ?? entries[0]
    if (!preferred) fail('no executable file found in linux-unpacked')
    return preferred
  }

  if (platform === 'windows') {
    const winDir = path.join(releaseDir, 'win-unpacked')
    if (!fs.existsSync(winDir)) fail('missing win-unpacked directory')
    const entries = fs
      .readdirSync(winDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe'))
      .map((entry) => path.join(winDir, entry.name))
    const preferred =
      entries.find((p) => /local.*llm.*desktop/i.test(path.basename(p))) ?? entries[0]
    if (!preferred) fail('no executable file found in win-unpacked')
    return preferred
  }

  if (platform === 'macos') {
    const files = walkFiles(releaseDir).filter((p) => p.includes('.app/Contents/MacOS/'))
    const preferred =
      files.find((p) => /local.*llm.*desktop/i.test(path.basename(p))) ?? files[0]
    if (!preferred) fail('no app executable found under .app/Contents/MacOS')
    return preferred
  }

  fail(`unsupported platform '${platform}'`)
}

function runExecutable(executablePath) {
  const result = spawnSync(executablePath, ['--version'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 20000
  })
  if (result.error) {
    fail(`failed to start executable '${executablePath}': ${result.error.message}`)
  }
  if (result.status !== 0) {
    fail(`executable '${executablePath}' exited with code ${result.status}`)
  }
}

const args = parseArgs(process.argv)
const platform = String(args.platform || '').toLowerCase()
const releaseDir = path.resolve(String(args.releaseDir || 'release'))

if (!platform) {
  fail('missing required argument --platform (linux|windows|macos)')
}

const files = walkFiles(releaseDir)
if (files.length === 0) {
  fail(`no files found in release directory '${releaseDir}'`)
}

assertArtifacts(platform, files)
const executablePath = findExecutable(platform, releaseDir)
runExecutable(executablePath)
console.log(`release-smoke-check: ${platform} package smoke test passed`)
