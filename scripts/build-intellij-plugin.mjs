#!/usr/bin/env node
/**
 * Build the JetBrains plugin ZIP (`integrations/intellij-plugin` → `build/distributions/local-llm-intellij-*.zip`).
 * Run before `electron-builder` so `extraResources` can bundle it with the desktop app.
 *
 * Requires JDK 17+ on PATH (`java -version`). Uses the Gradle wrapper in the plugin directory.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(root, 'integrations', 'intellij-plugin')
const distDir = join(pluginDir, 'build', 'distributions')
const isWin = process.platform === 'win32'

if (!existsSync(pluginDir)) {
  console.error(`\n✖ Missing plugin directory: ${pluginDir}\n`)
  process.exit(1)
}

const gradlewBat = join(pluginDir, 'gradlew.bat')
const gradlew = join(pluginDir, 'gradlew')
if (isWin && !existsSync(gradlewBat)) {
  console.error(`\n✖ Missing ${gradlewBat}\n`)
  process.exit(1)
}
if (!isWin && !existsSync(gradlew)) {
  console.error(`\n✖ Missing ${gradlew}\n`)
  process.exit(1)
}

const gradleArgs = ['clean', 'buildPlugin', '--no-daemon']

console.log('\n▶ IntelliJ plugin (Gradle clean buildPlugin)\n')

let status
if (isWin) {
  const r = spawnSync(gradlewBat, gradleArgs, {
    cwd: pluginDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' }
  })
  status = r.status
} else {
  const r = spawnSync('sh', ['./gradlew', ...gradleArgs], {
    cwd: pluginDir,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
  })
  status = r.status
}

if (status !== 0 && status !== null) {
  console.error(`\n✖ Gradle buildPlugin failed (exit ${status}). Install JDK 17+ and retry.\n`)
  process.exit(status)
}

const zips = existsSync(distDir) ? readdirSync(distDir).filter((f) => /^local-llm-intellij-.+\.zip$/i.test(f)) : []
if (zips.length === 0) {
  console.error(`\n✖ No local-llm-intellij-*.zip under ${distDir}\n`)
  process.exit(1)
}

console.log(`\n✓ Plugin ZIP ready: ${zips.map((z) => join('integrations', 'intellij-plugin', 'build', 'distributions', z)).join(', ')}\n`)
