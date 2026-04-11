/**
 * Choose a single .gguf file for local llama.cpp use (largest plausible weight file).
 * Skips common auxiliary blobs (vision projector, vocab-only).
 */
export function pickPrimaryGgufPath(siblings: { path: string; size?: number }[]): string | null {
  const gguf = siblings.filter((s) => /\.gguf$/i.test(s.path.replace(/\\/g, '/')))
  if (gguf.length === 0) return null

  const isAuxiliary = (path: string): boolean => {
    const seg = path.split('/').pop()?.toLowerCase() ?? ''
    if (seg.includes('mmproj')) return true
    if (seg.includes('ggml-vocab')) return true
    return false
  }

  const primary = gguf.filter((s) => !isAuxiliary(s.path))
  const pool = primary.length > 0 ? primary : gguf

  pool.sort((a, b) => {
    const sa = a.size ?? 0
    const sb = b.size ?? 0
    if (sb !== sa) return sb - sa
    return a.path.localeCompare(b.path)
  })
  return pool[0]?.path ?? null
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Largest plausible `.safetensors` / `.safetensor` in the repo (skips tiny optimizer shards when possible).
 */
export function pickPrimarySafetensorsPath(siblings: { path: string; size?: number }[]): string | null {
  const st = siblings.filter((s) => /\.safetensors?$/i.test(normPath(s.path)))
  if (st.length === 0) return null

  const isLikelyAuxiliary = (p: string): boolean => {
    const lower = normPath(p).toLowerCase()
    const seg = lower.split('/').pop() ?? ''
    if (seg.includes('optimizer')) return true
    if (seg.includes('scheduler')) return true
    if (seg.includes('random_states')) return true
    return false
  }

  const primary = st.filter((s) => !isLikelyAuxiliary(s.path))
  const pool = primary.length > 0 ? primary : st

  pool.sort((a, b) => {
    const sa = a.size ?? 0
    const sb = b.size ?? 0
    if (sb !== sa) return sb - sa
    return a.path.localeCompare(b.path)
  })
  return pool[0]?.path ?? null
}

/**
 * Pick one file to download from a Hub model repo: **GGUF first** (works with Ollama import and most llama.cpp builds),
 * otherwise the main **Safetensors** weight.
 */
export function pickPrimaryHubWeightFile(siblings: { path: string; size?: number }[]): string | null {
  return pickPrimaryGgufPath(siblings) ?? pickPrimarySafetensorsPath(siblings)
}

/** Revision for HF /resolve/: prefer commit SHA from model info, else branch name. */
export function hfResolveRevision(detail: { sha?: string }, branchFallback = 'main'): string {
  const s = detail.sha?.trim()
  if (s && /^[0-9a-f]{7,40}$/i.test(s)) return s
  return branchFallback
}
