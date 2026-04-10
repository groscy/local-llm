#!/usr/bin/env node
/**
 * Normalize app icon: transparent background (edge flood-fill), trim, then
 * "contain" into square PNGs at standard sizes. Writes:
 * - build/icon.ico, build/icon.icns, build/icon.png (512, Linux)
 * - build/icons/icon-{16..1024}.png
 * - src/renderer/public/app-icon.png (256, window icon)
 * - website/assets/app-icon.png (copy for static site favicon / brand)
 *
 * Source: src/renderer/public/app-icon.source.png if present, else app-icon.png.
 * On first run from app-icon.png only, copies original to app-icon.source.png.
 */
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const png2icons = require('png2icons')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'src', 'renderer', 'public')
const sourcePreferred = join(publicDir, 'app-icon.source.png')
const sourceFallback = join(publicDir, 'app-icon.png')
const buildDir = join(root, 'build')
const iconsDir = join(buildDir, 'icons')

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

/** Luminance threshold for "background" when flood-filling from image edges (white + soft shadow). */
const BG_LUMA = 218

function lumaAt(data, i) {
  return (data[i] + data[i + 1] + data[i + 2]) / 3
}

function floodTransparentFromEdges(width, height, data) {
  const w = width
  const h = height
  const n = w * h
  const visited = new Uint8Array(n)
  const queue = []
  const push = (x, y) => {
    const p = y * w + x
    if (visited[p]) return
    const i = p * 4
    if (lumaAt(data, i) < BG_LUMA) return
    visited[p] = 1
    queue.push(p)
  }
  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }
  let qi = 0
  while (qi < queue.length) {
    const p = queue[qi++]
    const i = p * 4
    data[i + 3] = 0
    const x = p % w
    const y = (p / w) | 0
    const tryN = (nx, ny) => {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
      const np = ny * w + nx
      if (visited[np]) return
      const ni = np * 4
      if (lumaAt(data, ni) < BG_LUMA) return
      visited[np] = 1
      queue.push(np)
    }
    tryN(x + 1, y)
    tryN(x - 1, y)
    tryN(x, y + 1)
    tryN(x, y - 1)
    tryN(x + 1, y + 1)
    tryN(x + 1, y - 1)
    tryN(x - 1, y + 1)
    tryN(x - 1, y - 1)
  }
}

async function rasterFromSharp(inputBuf) {
  const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: Buffer.from(data), width: info.width, height: info.height }
}

async function toSquarePng(trimmedPngBuffer, side) {
  return sharp(trimmedPngBuffer)
    .resize(side, side, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer()
}

async function main() {
  const useSource = existsSync(sourcePreferred)
  const inputPath = useSource ? sourcePreferred : sourceFallback
  if (!existsSync(inputPath)) {
    console.error('Missing icon source:', inputPath)
    process.exit(1)
  }

  const original = readFileSync(inputPath)
  if (!useSource) {
    writeFileSync(sourcePreferred, original)
    console.log('Saved original raster to app-icon.source.png (edit that file to change artwork; re-run npm run icons).')
  }

  const { data, width, height } = await rasterFromSharp(original)
  floodTransparentFromEdges(width, height, data)

  const trimmedPng = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .trim({ threshold: 2 })
    .toBuffer({ resolveWithObject: true })

  const tBuf = trimmedPng.data
  const tMeta = trimmedPng.info
  console.log(`Trimmed canvas: ${tMeta.width}x${tMeta.height}`)

  mkdirSync(buildDir, { recursive: true })
  mkdirSync(iconsDir, { recursive: true })

  const bySize = {}
  for (const s of SIZES) {
    const png = await toSquarePng(tBuf, s)
    bySize[s] = png
    writeFileSync(join(iconsDir, `icon-${s}.png`), png)
  }

  writeFileSync(join(buildDir, 'icon.png'), bySize[512])
  writeFileSync(sourceFallback, bySize[256])

  const websiteIconPath = join(root, 'website', 'assets', 'app-icon.png')
  mkdirSync(dirname(websiteIconPath), { recursive: true })
  copyFileSync(sourceFallback, websiteIconPath)

  png2icons.clearCache()
  const icns = png2icons.createICNS(bySize[1024], png2icons.BICUBIC, 0)
  if (!icns) {
    console.error('png2icons.createICNS failed')
    process.exit(1)
  }
  writeFileSync(join(buildDir, 'icon.icns'), icns)

  const ico = png2icons.createICO(bySize[1024], png2icons.BICUBIC, 0, false, true)
  if (!ico) {
    console.error('png2icons.createICO failed')
    process.exit(1)
  }
  writeFileSync(join(buildDir, 'icon.ico'), ico)

  console.log('Wrote build/icon.ico, build/icon.icns, build/icon.png (512)')
  console.log(`Wrote build/icons/icon-<size>.png for sizes: ${SIZES.join(', ')}`)
  console.log('Wrote src/renderer/public/app-icon.png (256, transparent, contained)')
  console.log('Wrote website/assets/app-icon.png (favicon / nav brand)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
