import { basename, extname } from 'path'

const INVALID = /[/\\:*?"<>|]/g

/**
 * Build a stable local filename for an HF file so many models can share one folder
 * without basename collisions. Shape: `{repo}__{revision}__{optionalSubdir_}{stem}{ext}`.
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
