/**
 * Build the set of Hub file paths to download so llama.cpp can load the model:
 * - GGUF: primary weight + same-folder mmproj (vision) + split GGUF shards (-NN-of-MM).
 * - Safetensors: all weight shards / index JSON in the weight directory (or root), plus tokenizer/config sidecars.
 */

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SIDECAR_NAMES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer.model',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'preprocessor_config.json',
  'vocab.json',
  'added_tokens.json',
  'merges.txt',
  'chat_template.jinja',
  'spiece.model',
  'text_config.json',
  'video_preprocessor_config.json',
  'audio_preprocessor_config.json'
]

function isLikelyAuxiliarySafetensorsName(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (lower.includes('optimizer')) return true
  if (lower.includes('scheduler')) return true
  if (lower.includes('random_states')) return true
  return false
}

/** Direct children of `dir` in the repo (`dir` '' = repo root, file names only). */
function forEachDirectChildPath(
  siblings: { path: string }[],
  dir: string,
  cb: (fullPath: string, fileName: string) => void
): void {
  const seen = new Set<string>()
  for (const s of siblings) {
    const n = normPath(s.path)
    if (seen.has(n)) continue
    seen.add(n)
    if (dir === '') {
      if (n.includes('/')) continue
      cb(n, n)
    } else {
      const prefix = `${dir}/`
      if (!n.startsWith(prefix)) continue
      const rest = n.slice(prefix.length)
      if (rest.includes('/')) continue
      cb(n, rest)
    }
  }
}

function addGgufCompanionFiles(
  siblings: { path: string }[],
  primary: string,
  push: (p: string) => void
): void {
  const primaryDir = primary.includes('/') ? primary.slice(0, primary.lastIndexOf('/')) : ''
  const primaryFile = primary.split('/').pop() ?? ''

  // Vision: mmproj (and similar) in the same folder as the main GGUF
  forEachDirectChildPath(siblings, primaryDir, (full, base) => {
    if (!base.toLowerCase().endsWith('.gguf')) return
    const low = base.toLowerCase()
    if (low.includes('mmproj') || low.includes('vision') || low.includes('image_encoder')) {
      push(full)
    }
  })

  // Split GGUF: model-00001-of-00004.gguf …
  const gShard = /^(.+)-(\d+)-of-(\d+)\.gguf$/i.exec(primaryFile)
  if (gShard) {
    const prefix = gShard[1]!
    const total = gShard[3]!
    const re = new RegExp(`^${escapeRegex(prefix)}-(\\d+)-of-${escapeRegex(total)}\\.gguf$`, 'i')
    forEachDirectChildPath(siblings, primaryDir, (full, base) => {
      if (!re.test(base)) return
      push(full)
    })
  }
}

/**
 * Safetensors weights and index JSON at repo root (top-level files only).
 */
function addRootSafetensorsFiles(siblings: { path: string }[], push: (p: string) => void): void {
  forEachDirectChildPath(siblings, '', (full, base) => {
    if (/\.safetensors\.index\.json$/i.test(base)) {
      push(full)
      return
    }
    if (/\.safetensors?$/i.test(base) && !isLikelyAuxiliarySafetensorsName(base)) push(full)
  })
}

/**
 * Every `.safetensors` / index JSON anywhere under `folder/` (for nested VL / encoder shards).
 */
function addSafetensorsTreeUnderFolder(
  siblings: { path: string }[],
  folder: string,
  push: (p: string) => void
): void {
  const head = `${folder}/`
  for (const s of siblings) {
    const n = normPath(s.path)
    if (!n.startsWith(head)) continue
    const base = n.split('/').pop() ?? ''
    if (/\.safetensors\.index\.json$/i.test(base)) {
      push(n)
      continue
    }
    if (/\.safetensors?$/i.test(base) && !isLikelyAuxiliarySafetensorsName(base)) push(n)
  }
}

/**
 * All repo-relative paths to download for this install (primary weight first).
 */
export function hubWeightDownloadPathSet(
  siblings: { path: string }[],
  primaryWeightPath: string
): string[] {
  const primary = normPath(primaryWeightPath)
  const siblingSet = new Set(siblings.map((s) => normPath(s.path)))
  const out = new Set<string>()
  const ordered: string[] = []

  const push = (p: string): void => {
    if (!siblingSet.has(p) || out.has(p)) return
    out.add(p)
    ordered.push(p)
  }

  push(primary)

  const isGguf = /\.gguf$/i.test(primary)
  const isSafetensors = /\.safetensors?$/i.test(primary)

  if (isGguf) {
    addGgufCompanionFiles(siblings, primary, push)
    // If main weights live in a subfolder but mmproj sits at repo root (common layout)
    const primaryDir = primary.includes('/') ? primary.slice(0, primary.lastIndexOf('/')) : ''
    if (primaryDir) {
      let hasMmprojInFolder = false
      forEachDirectChildPath(siblings, primaryDir, (_full, base) => {
        if (base.toLowerCase().endsWith('.gguf') && base.toLowerCase().includes('mmproj')) hasMmprojInFolder = true
      })
      if (!hasMmprojInFolder) {
        forEachDirectChildPath(siblings, '', (full, base) => {
          if (!base.toLowerCase().endsWith('.gguf')) return
          const low = base.toLowerCase()
          if (low.includes('mmproj') || low.includes('vision') || low.includes('image_encoder')) push(full)
        })
      }
    }
    return ordered
  }

  if (!isSafetensors) {
    return ordered
  }

  const primaryDir = primary.includes('/') ? primary.slice(0, primary.lastIndexOf('/')) : ''

  if (primaryDir) {
    addSafetensorsTreeUnderFolder(siblings, primaryDir, push)
  } else {
    addRootSafetensorsFiles(siblings, push)
  }

  // Legacy: explicit -NN-of-MM group if naming matches (addGguf-style; addSafetensorsWeightGroup may already include them)
  const primaryFile = primary.split('/').pop() ?? ''
  const shardMatch = /^(.+)-(\d+)-of-(\d+)\.safetensors$/i.exec(primaryFile)
  if (shardMatch) {
    const prefix = shardMatch[1]!
    const totalShards = shardMatch[3]!
    const re = new RegExp(
      `^${escapeRegex(prefix)}-(\\d+)-of-${escapeRegex(totalShards)}\\.safetensors$`,
      'i'
    )
    forEachDirectChildPath(siblings, primaryDir, (full, base) => {
      if (!re.test(base)) return
      push(full)
    })
  }

  const dirsToScan = new Set<string>([''])
  if (primaryDir) dirsToScan.add(primaryDir)

  for (const dir of dirsToScan) {
    for (const name of SIDECAR_NAMES) {
      const cand = dir ? `${dir}/${name}` : name
      push(cand)
    }
  }

  // Tokenizer files sometimes live in a subfolder (e.g. tokenizer/tokenizer.model); pick any matching basename listed.
  const tokenizerBasenames = new Set([
    'tokenizer.model',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
    'merges.txt',
    'added_tokens.json',
    'special_tokens_map.json'
  ])
  for (const s of siblings) {
    const n = normPath(s.path)
    const b = n.split('/').pop()?.toLowerCase() ?? ''
    if (tokenizerBasenames.has(b)) push(n)
  }

  // Re-order: primary first
  const rest = ordered.filter((p) => p !== primary)
  return [primary, ...rest]
}
