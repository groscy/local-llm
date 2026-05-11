#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx < 0) return ''
  return String(process.argv[idx + 1] ?? '')
}

function main() {
  const baseModel = argValue('--base_model').trim()
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const manifestPath = path.resolve(scriptDir, '..', 'manifest.json')
  let runtimeVersion = 'unknown'
  let families = ['llama', 'mistral', 'qwen', 'phi', 'gemma']
  try {
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw)
    if (typeof manifest.version === 'string' && manifest.version.trim()) {
      runtimeVersion = manifest.version.trim()
    }
    if (Array.isArray(manifest.supportedFamilies)) {
      const parsed = manifest.supportedFamilies
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
      if (parsed.length > 0) families = parsed
    }
  } catch {
    // Keep default probe metadata even if manifest parsing fails.
  }

  if (!baseModel) {
    console.log(
      JSON.stringify({
        supported: false,
        reason: 'Base model path is required.',
        details: 'Pass --base_model <path-or-id>.',
        runtimeVersion
      })
    )
    process.exit(0)
  }

  const norm = baseModel.replace(/\\/g, '/').toLowerCase()
  const hasKnownFamily = families.some((f) => norm.includes(f))
  const hasSupportedExt = /\.(gguf|safetensors|safetensor|bin)$/i.test(baseModel)
  const supported = hasKnownFamily && hasSupportedExt
  const reason = supported
    ? `Model appears compatible with bundled Axolotl (${runtimeVersion}).`
    : `Unsupported model for bundled Axolotl (${runtimeVersion}).`
  const details = supported
    ? `Matched family in [${families.join(', ')}] and supported extension.`
    : `Expected one of families [${families.join(', ')}] and extension .gguf/.safetensors/.bin.`

  console.log(
    JSON.stringify({
      supported,
      reason,
      details,
      runtimeVersion
    })
  )
}

main()
