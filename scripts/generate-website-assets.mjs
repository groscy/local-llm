/**
 * Rasterize marketing SVGs and build og-image.png for the static website.
 * Run: node scripts/generate-website-assets.mjs
 */
import sharp from 'sharp'
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const assets = join(root, 'website', 'assets')

const screenshots = ['screenshot-chat', 'screenshot-models', 'screenshot-wiki']

async function main() {
  for (const name of screenshots) {
    const svgPath = join(assets, `${name}.svg`)
    const buf = await sharp(svgPath).resize(1200, null, { withoutEnlargement: false }).png({ compressionLevel: 9 }).toBuffer()
    await sharp(buf).webp({ quality: 88 }).toFile(join(assets, `${name}-1200.webp`))
    await sharp(buf).png({ compressionLevel: 9 }).toFile(join(assets, `${name}-1200.png`))
    console.log(`Wrote ${name}-1200.webp / ${name}-1200.png`)
  }

  const ogSvgPath = join(assets, 'og-source.svg')
  await sharp(await readFile(ogSvgPath))
    .resize(1200, 630, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(join(assets, 'og-image.png'))
  console.log('Wrote og-image.png')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
