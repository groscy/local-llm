import { basename, extname, join } from 'path'

const INVALID = /[/\\:*?"<>|]/g

/**
 * One directory per (repo, revision) under the models folder; keeps Hub-relative paths
 * so `config.json` and `.safetensors` layouts match what `convert_hf_to_gguf.py` expects.
 */
export function hfDownloadModelFolderSegment(repoId: string, revision: string): string {
  const repoFlat = repoId.replace(/\//g, '__').replace(INVALID, '-').slice(0, 96)
  const r = revision.trim().replace(INVALID, '-')
  const revShort = /^[0-9a-f]{7,40}$/i.test(r) ? r.slice(0, 12) : r.slice(0, 28)
  let key = `${repoFlat}__${revShort}`
  if (key.length > 160) key = key.slice(0, 160)
  return key
}

/** Final absolute path: `destBase / {repo}__{rev}/…/file` preserving repo-relative segments. */
export function hfDownloadAbsolutePath(
  destBase: string,
  repoId: string,
  revision: string,
  hfFilename: string
): string {
  const folder = hfDownloadModelFolderSegment(repoId, revision)
  const norm = hfFilename.replace(/\\/g, '/')
  const parts = norm.split('/').map((p) => p.replace(INVALID, '_')).filter(Boolean)
  return join(destBase, folder, ...parts)
}

/**
 * @deprecated Prefer {@link hfDownloadAbsolutePath} so tree layout is preserved.
 * Build a stable flat filename: `{repo}__{revision}__{optionalSubdir_}{stem}{ext}`.
 */
export function hfDownloadDestFileName(repoId: string, revision: string, hfFilename: string): string {
  const norm = hfFilename.replace(/\\/g, '/')
  const fileBase = basename(norm)
  const dirParts = norm.split('/').slice(0, -1).filter(Boolean)
  const subPrefix =
    dirParts.length > 0 ? `${dirParts.map((p) => p.replace(INVALID, '_')).join('_')}_` : ''

  const repoFlat = repoId.replace(/\//g, '__').replace(INVALID, '-')
  const revFlat = revision.replace(INVALID, '-')

  const ext = extname(fileBase)
  const stem = ext ? fileBase.slice(0, -ext.length) : fileBase
  const middle = `${subPrefix}${stem}`

  const MAX = 220
  let name = `${repoFlat}__${revFlat}__${middle}${ext}`
  if (name.length > MAX) {
    const overhead = repoFlat.length + revFlat.length + ext.length + 4
    const budget = Math.max(24, MAX - overhead)
    name = `${repoFlat}__${revFlat}__${middle.slice(0, budget)}${ext}`
  }
  return name
}
