import { listModels, modelInfo, listFiles, type ModelEntry } from '@huggingface/hub'
import type Database from 'better-sqlite3'
import type { HfModelDetail, HfModelSummary } from '@shared/types'
import { logLine } from '../logger'

const CACHE_TTL_MS = 1000 * 60 * 30

function entryToSummary(e: ModelEntry): HfModelSummary {
  return {
    id: e.name,
    author: 'author' in e ? (e as ModelEntry & { author?: string }).author : undefined,
    downloads: e.downloads,
    likes: e.likes,
    tags: 'tags' in e ? (e as ModelEntry & { tags?: string[] }).tags : undefined,
    pipeline_tag: e.task,
    private: e.private
  }
}

export async function hfSearch(query: string, limit: number, token?: string): Promise<HfModelSummary[]> {
  const cred = token ? { accessToken: token } : undefined
  const out: HfModelSummary[] = []
  const cursor = listModels({
    search: { query: query || undefined },
    limit,
    additionalFields: ['author', 'tags'],
    credentials: cred
  })
  for await (const m of cursor) {
    out.push(entryToSummary(m))
    if (out.length >= limit) break
  }
  return enrichSummariesForHubCards(out, cred)
}

const RECOMMENDED_SEED_IDS = [
  'microsoft/Phi-3-mini-4k-instruct-gguf',
  'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
  'Qwen/Qwen2.5-3B-Instruct-GGUF',
  'google/gemma-2-2b-it-GGUF',
  'meta-llama/Meta-Llama-3.1-8B-Instruct-GGUF',
  'bartowski/Llama-3.2-3B-Instruct-GGUF',
  'mlx-community/Meta-Llama-3.1-8B-Instruct-4bit',
  'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF'
]

/**
 * Models suited for local inference: Hub models tagged gguf (and fallbacks), merged with a small curated list, sorted by downloads.
 */
export async function hfRecommended(outLimit: number, token?: string): Promise<HfModelSummary[]> {
  const cred = token ? { accessToken: token } : undefined
  const seen = new Map<string, HfModelSummary>()

  async function consume(
    params: { search: { tags?: string[]; query?: string }; limit: number }
  ): Promise<void> {
    const cursor = listModels({
      ...params,
      additionalFields: ['author', 'tags'],
      credentials: cred
    })
    for await (const m of cursor) {
      const s = entryToSummary(m)
      if (!seen.has(s.id)) seen.set(s.id, s)
    }
  }

  try {
    await consume({ search: { tags: ['gguf'] }, limit: 100 })
  } catch (e) {
    logLine('warn', 'hf_recommended_tag_gguf_failed', { error: String(e) })
  }

  if (seen.size < 12) {
    try {
      await consume({ search: { query: 'gguf' }, limit: 80 })
    } catch (e) {
      logLine('warn', 'hf_recommended_query_gguf_failed', { error: String(e) })
    }
  }

  for (const id of RECOMMENDED_SEED_IDS) {
    if (seen.has(id)) continue
    try {
      const info = await modelInfo({
        name: id,
        additionalFields: ['tags', 'author'],
        credentials: cred
      })
      seen.set(id, entryToSummary(info))
    } catch {
      /* repo missing or gated */
    }
  }

  const list = [...seen.values()].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
  const sliced = list.slice(0, outLimit)
  return enrichSummariesForHubCards(sliced, cred)
}

function trimDescription(text: string, max = 420): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return one.slice(0, max - 1).trimEnd() + '…'
}

async function fetchRepoTotalSizeBytes(
  repoId: string,
  cred: { accessToken: string } | undefined
): Promise<number> {
  let total = 0
  try {
    const files = listFiles({
      repo: { type: 'model', name: repoId },
      recursive: true,
      credentials: cred
    })
    for await (const f of files) {
      if (f.type === 'file') {
        total += f.lfs?.size ?? f.size ?? 0
      }
    }
  } catch {
    return 0
  }
  return total
}

async function fetchSummaryDescription(
  repoId: string,
  cred: { accessToken: string } | undefined
): Promise<string | undefined> {
  try {
    const info = await modelInfo({
      name: repoId,
      additionalFields: ['cardData'],
      credentials: cred
    })
    const card = (info as { cardData?: { description?: string } }).cardData
    const d = card?.description
    if (typeof d !== 'string' || !d.trim()) return undefined
    return trimDescription(d)
  } catch {
    return undefined
  }
}

/** Batched model card fetches: card blurb + total file size for list views. */
async function enrichSummariesForHubCards(
  summaries: HfModelSummary[],
  cred: { accessToken: string } | undefined
): Promise<HfModelSummary[]> {
  const batchSize = 5
  const out: HfModelSummary[] = []
  for (let i = 0; i < summaries.length; i += batchSize) {
    const batch = summaries.slice(i, i + batchSize)
    const chunk = await Promise.all(
      batch.map(async (s) => {
        const [description, totalSizeBytes] = await Promise.all([
          fetchSummaryDescription(s.id, cred),
          fetchRepoTotalSizeBytes(s.id, cred)
        ])
        return {
          ...s,
          ...(description ? { description } : {}),
          ...(totalSizeBytes > 0 ? { totalSizeBytes } : {})
        }
      })
    )
    out.push(...chunk)
  }
  return out
}

export async function hfModelDetail(
  db: Database.Database,
  repoId: string,
  token?: string
): Promise<HfModelDetail> {
  const now = Date.now()
  const cached = db.prepare('SELECT payload, fetched_at FROM hf_model_cache WHERE repo_id = ?').get(repoId) as
    | { payload: string; fetched_at: number }
    | undefined
  if (cached && now - cached.fetched_at < CACHE_TTL_MS) {
    return JSON.parse(cached.payload) as HfModelDetail
  }

  const info = await modelInfo({
    name: repoId,
    additionalFields: ['tags', 'sha', 'cardData', 'author', 'safetensors'],
    credentials: token ? { accessToken: token } : undefined
  })

  const siblings: { path: string; size?: number }[] = []
  try {
    const files = listFiles({
      repo: { type: 'model', name: repoId },
      recursive: true,
      credentials: token ? { accessToken: token } : undefined
    })
    for await (const f of files) {
      if (f.type === 'file') {
        const sz = f.lfs?.size ?? f.size
        siblings.push({ path: f.path, size: sz })
      }
    }
  } catch (e) {
    logLine('warn', 'hf_list_files_failed', { repoId, error: String(e) })
  }

  const card = 'cardData' in info ? (info as { cardData?: { license?: string; description?: string } }).cardData : undefined
  const totalSizeBytes = siblings.reduce((a, s) => a + (s.size ?? 0), 0)

  const detail: HfModelDetail = {
    id: info.name,
    author: 'author' in info ? (info as { author?: string }).author : undefined,
    downloads: info.downloads,
    likes: info.likes,
    tags: 'tags' in info ? (info as { tags?: string[] }).tags : undefined,
    pipeline_tag: info.task,
    private: info.private,
    description: card?.description,
    readme: undefined,
    siblings,
    totalSizeBytes,
    license: card?.license,
    sha: 'sha' in info ? (info as { sha?: string }).sha : undefined
  }

  db.prepare(
    `INSERT INTO hf_model_cache (repo_id, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(repo_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
  ).run(repoId, JSON.stringify(detail), now)

  logLine('info', 'hf_model_detail_cached', { repoId })
  return detail
}
