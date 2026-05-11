#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function argValue(flag) {
  const idx = process.argv.indexOf(flag)
  if (idx < 0) return ''
  return String(process.argv[idx + 1] ?? '')
}

function countDatasetLines(datasetPath) {
  try {
    const content = fs.readFileSync(datasetPath, 'utf8')
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length
  } catch {
    return 0
  }
}

function main() {
  const baseModel = argValue('--base_model').trim()
  const datasetPath = argValue('--dataset').trim()
  const outputDir = argValue('--output').trim()
  const displayName = argValue('--display_name').trim()
  if (!baseModel || !datasetPath || !outputDir) {
    console.error('Missing required arguments. Need --base_model, --dataset, --output.')
    process.exit(2)
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const datasetLines = countDatasetLines(datasetPath)
  const trainReport = {
    backend: 'axolotl-bundled',
    status: 'stub',
    baseModel,
    datasetPath,
    datasetLines,
    displayName: displayName || null,
    note:
      'Bundled Axolotl backend placeholder executed successfully. Replace runtime payload with full Axolotl stack for production training.'
  }
  const reportPath = path.join(outputDir, 'axolotl_train_report.json')
  fs.writeFileSync(reportPath, JSON.stringify(trainReport, null, 2), 'utf8')
  console.log(`Wrote ${reportPath}`)
  console.log('No GGUF artifact emitted by bundled placeholder runtime.')
}

main()
