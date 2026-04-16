import { createHash } from 'crypto'
import { createReadStream, existsSync } from 'fs'
import path from 'path'
import { CHAT_MAX_COMPLETION_TOKENS_FALLBACK } from '../chatMaxTokens'
import { mergeChatAssistantStopSequences, truncateSimulatedUserContinuation } from '@shared/chatAssistantGuards'
import { logLine } from '../../logger'
import {
  httpPostFileStream,
  httpPostJson,
  httpPostNdjsonStream,
  httpRequestRaw
} from '../httpLocal'
import type { ChatMessage, RuntimeAdapter, RuntimeLoadProgress } from './types'
import { DEFAULT_OLLAMA_MODEL_TAG } from '@shared/defaultRuntimeModel'
import type { RuntimeStatus } from '@shared/types'

const PULL_TIMEOUT_MS = 3_600_000
const GGUF_TIMEOUT_MS = 3_600_000

async function sha256HexFile(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const rs = createReadStream(absPath)
    rs.on('error', reject)
    rs.on('data', (chunk: Buffer | string) => hash.update(chunk))
    rs.on('end', () => resolve(hash.digest('hex')))
  })
}

function isGgufFilePath(absPath: string): boolean {
  if (!existsSync(absPath)) return false
  return /\.gguf$/i.test(absPath)
}

export function modelTagMatchesList(want: string, models: { name: string }[]): boolean {
  return models.some((m) => {
    const name = m.name
    const base = name.split(':')[0] ?? ''
    return name === want || name.startsWith(`${want}:`) || base === want
  })
}

/** Pulls a model into the Ollama library (`POST /api/pull` stream). Does not start the chat runtime. */
export async function pullOllamaModelStream(
  baseUrl: string,
  name: string,
  report?: (e: RuntimeLoadProgress) => void
): Promise<void> {
  const trimmed = name.trim()
  const url = `${baseUrl.replace(/\/$/, '')}/api/pull`
  let streamError: string | undefined
  const { statusCode, errorText } = await httpPostNdjsonStream({
    url,
    jsonBody: { model: trimmed, stream: true },
    timeoutMs: PULL_TIMEOUT_MS,
    onObject: (obj) => {
      if (typeof obj.error === 'string' && obj.error.trim()) streamError = obj.error
      const status = typeof obj.status === 'string' ? obj.status : ''
      const total = typeof obj.total === 'number' ? obj.total : 0
      const completed = typeof obj.completed === 'number' ? obj.completed : 0
      const pct =
        total > 0 && completed >= 0 ? Math.min(100, Math.round((100 * completed) / total)) : undefined
      const digest = typeof obj.digest === 'string' && obj.digest.trim() ? obj.digest.trim().slice(0, 96) : ''
      const detailParts: string[] = []
      if (digest) detailParts.push(digest)
      if (total > 0) detailParts.push(`progress ${completed}/${total}`)
      if (status || pct != null) {
        report?.({
          phase: 'pull',
          message: status || `Pulling “${trimmed}”…`,
          percent: pct,
          detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined
        })
      }
    }
  })
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `Ollama could not pull "${trimmed}" (HTTP ${statusCode}). ${errorText?.slice(0, 400) ?? ''}`
    )
  }
  if (streamError) throw new Error(`Ollama pull failed: ${streamError}`)
}

/** Ensures `modelName` exists in the daemon’s library (no-op if already present). */
export async function ensureOllamaModelInLibrary(
  baseUrl: string,
  modelName: string,
  report?: (e: RuntimeLoadProgress) => void
): Promise<void> {
  const trimmed = modelName.trim()
  if (!trimmed)
    throw new Error(`Ollama model name is required (for example: ${DEFAULT_OLLAMA_MODEL_TAG}).`)

  const first = await fetchOllamaModelTags(baseUrl)
  if (first.error) throw new Error(first.error)
  const models = first.names.map((n) => ({ name: n }))
  if (modelTagMatchesList(trimmed, models)) {
    report?.({
      phase: 'check',
      message: `Model “${trimmed}” is already in the Ollama library.`,
      percent: 100
    })
    return
  }

  logLine('info', 'ollama_pull_start', { model: trimmed, hadModels: models.length })
  await pullOllamaModelStream(baseUrl, trimmed, report)

  const afterProbe = await fetchOllamaModelTags(baseUrl)
  if (afterProbe.error) throw new Error(afterProbe.error)
  const after = afterProbe.names.map((n) => ({ name: n }))
  if (!modelTagMatchesList(trimmed, after)) {
    throw new Error(
      `Model "${trimmed}" is still not available after pull (Ollama reports ${after.length} model(s)). Check the model name and disk space, or run: ollama pull ${trimmed}`
    )
  }
  logLine('info', 'ollama_pull_ready', { model: trimmed })
}

/** True if an Ollama daemon responds at `baseUrl` with HTTP 2xx and JSON including a `models` array. */
export async function probeOllamaReachable(baseUrl: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, '')
  try {
    const res = await httpRequestRaw({
      url: `${base}/api/tags`,
      method: 'GET',
      timeoutMs: 4000
    })
    if (res.statusCode < 200 || res.statusCode >= 300) return false
    const j = JSON.parse(res.body) as { models?: unknown }
    return j != null && typeof j === 'object' && Array.isArray(j.models)
  } catch {
    return false
  }
}

/** Lists installed Ollama model tags from `/api/tags` (same source as `ollama list`). */
export async function fetchOllamaModelTags(baseUrl: string): Promise<{ names: string[]; error?: string }> {
  const base = baseUrl.replace(/\/$/, '')
  try {
    const res = await httpRequestRaw({
      url: `${base}/api/tags`,
      method: 'GET',
      timeoutMs: 8000
    })
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { names: [], error: `Ollama returned HTTP ${res.statusCode}.` }
    }
    let j: { models?: { name: string }[] }
    try {
      j = JSON.parse(res.body) as { models?: { name: string }[] }
    } catch {
      return { names: [], error: 'Could not read the model list from Ollama.' }
    }
    const names = (j.models ?? [])
      .map((m) => m.name)
      .filter((n) => typeof n === 'string' && n.trim().length > 0)
    return { names }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { names: [], error: msg }
  }
}

/** Remove a model from the Ollama library (`DELETE /api/delete`). */
export async function deleteOllamaModel(
  baseUrl: string,
  model: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = baseUrl.replace(/\/$/, '')
  const trimmed = model.trim()
  if (!trimmed) return { ok: false, error: 'Model name is required.' }
  const body = JSON.stringify({ model: trimmed })
  try {
    const res = await httpRequestRaw({
      url: `${base}/api/delete`,
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      timeoutMs: 300_000
    })
    if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true }
    try {
      const j = JSON.parse(res.body) as { error?: string }
      return { ok: false, error: j.error ?? `Ollama returned HTTP ${res.statusCode}.` }
    } catch {
      return { ok: false, error: res.body?.trim()?.slice(0, 400) || `HTTP ${res.statusCode}` }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/** Talks to an existing Ollama daemon (no spawn). */
export class OllamaAdapter implements RuntimeAdapter {
  readonly kind = 'ollama' as const
  private baseUrl: string
  private modelName: string

  constructor(baseUrl = 'http://127.0.0.1:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.modelName = ''
  }

  async start(opts: {
    modelPath: string
    displayModelPath?: string
    binaryPath?: string
    port?: number
    defaultPredictTokens?: number
    contextTokens?: number
    onLoadProgress?: (e: RuntimeLoadProgress) => void
  }): Promise<void> {
    const trimmed = opts.modelPath.trim()
    if (!trimmed)
      throw new Error(`Ollama model name is required (for example: ${DEFAULT_OLLAMA_MODEL_TAG})`)
    const asPath = path.resolve(trimmed.replace(/^file:\/\//i, ''))
    const report = opts.onLoadProgress
    try {
      if (isGgufFilePath(asPath)) {
        logLine('info', 'ollama_use_local_gguf', { path: asPath })
        report?.({ phase: 'prepare', message: 'Importing local GGUF into Ollama…' })
        await this.ensureLocalGgufModel(asPath, report)
      } else if (existsSync(asPath) && /\.safetensors?$/i.test(asPath)) {
        throw new Error(
          'Ollama cannot import raw .safetensors files from disk (only .gguf). Switch to llama.cpp in the top bar to auto-convert a full HF folder to GGUF, convert offline, or type an Ollama model name to pull instead.'
        )
      } else {
        this.modelName = trimmed
        logLine('info', 'ollama_use_model', { model: this.modelName })
        report?.({ phase: 'check', message: `Checking Ollama for “${trimmed}”…` })
        await this.ensureOllamaReady(report)
      }
      report?.({ phase: 'ready', message: 'Model ready.', percent: 100 })
    } catch (e) {
      this.modelName = ''
      throw e
    }
  }

  /** Register a `.gguf` on disk with Ollama (blob + `/api/create`) and set `this.modelName`. */
  private async ensureLocalGgufModel(
    absPath: string,
    report?: (e: RuntimeLoadProgress) => void
  ): Promise<void> {
    await this.assertTagsEndpointOk()
    report?.({ phase: 'hash', message: 'Computing file checksum…' })
    const hex = await sha256HexFile(absPath)
    const digest = `sha256:${hex}`
    const ollamaModel = `local-${hex.slice(0, 16)}`
    const ggufKey = path.basename(absPath) || 'model.gguf'

    let models = await this.getModelList()
    if (modelTagMatchesList(ollamaModel, models)) {
      this.modelName = ollamaModel
      logLine('info', 'ollama_gguf_already_registered', { model: ollamaModel })
      report?.({ phase: 'ready', message: 'GGUF already registered in Ollama.', percent: 100 })
      return
    }

    const blobUrl = `${this.baseUrl}/api/blobs/${digest}`
    const head = await httpRequestRaw({ url: blobUrl, method: 'HEAD', timeoutMs: 30_000 })
    if (head.statusCode === 404) {
      logLine('info', 'ollama_blob_upload_start', { digest, path: absPath })
      report?.({ phase: 'upload', message: 'Uploading GGUF to Ollama…', percent: 0 })
      const up = await httpPostFileStream({
        url: blobUrl,
        filePath: absPath,
        timeoutMs: GGUF_TIMEOUT_MS,
        onUploadProgress: (sent, total) => {
          const pct = total > 0 ? Math.min(99, Math.round((100 * sent) / total)) : undefined
          report?.({ phase: 'upload', message: `Uploading GGUF… ${sent} / ${total} bytes`, percent: pct })
        }
      })
      if (up.statusCode !== 200 && up.statusCode !== 201) {
        throw new Error(
          `Ollama could not store the GGUF blob (HTTP ${up.statusCode}). ${up.body.slice(0, 400)}`
        )
      }
      report?.({ phase: 'upload', message: 'Upload complete.', percent: 100 })
    } else if (head.statusCode < 200 || head.statusCode >= 300) {
      throw new Error(`Ollama blob check failed (HTTP ${head.statusCode}).`)
    }

    logLine('info', 'ollama_create_from_gguf', { model: ollamaModel, file: ggufKey })
    report?.({ phase: 'create', message: 'Creating Ollama model from GGUF…' })
    let createErr: string | undefined
    const cr = await httpPostNdjsonStream({
      url: `${this.baseUrl}/api/create`,
      jsonBody: {
        model: ollamaModel,
        files: { [ggufKey]: digest },
        stream: true
      },
      timeoutMs: GGUF_TIMEOUT_MS,
      onObject: (obj) => {
        if (typeof obj.error === 'string' && obj.error.trim()) createErr = obj.error
        const st = typeof obj.status === 'string' ? obj.status : ''
        if (st) report?.({ phase: 'create', message: st })
      }
    })
    if (cr.statusCode < 200 || cr.statusCode >= 300) {
      throw new Error(
        `Ollama could not create a model from the GGUF (HTTP ${cr.statusCode}): ${cr.errorText?.slice(0, 400) ?? ''}`
      )
    }
    if (createErr) throw new Error(`Ollama create failed: ${createErr}`)

    models = await this.getModelList()
    if (!modelTagMatchesList(ollamaModel, models)) {
      throw new Error(
        `Model "${ollamaModel}" did not appear after importing the GGUF (Ollama reports ${models.length} model(s)).`
      )
    }
    this.modelName = ollamaModel
    logLine('info', 'ollama_gguf_ready', { model: ollamaModel })
  }

  private async assertTagsEndpointOk(): Promise<void> {
    try {
      const res = await httpRequestRaw({
        url: `${this.baseUrl}/api/tags`,
        method: 'GET',
        timeoutMs: 8000
      })
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Ollama at ${this.baseUrl} returned HTTP ${res.statusCode}.`)
      }
      JSON.parse(res.body) as { models?: unknown }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Nothing is listening')) {
        throw new Error(
          `${msg} Launch the Ollama application (Windows/macOS) or run "ollama serve" in a terminal, then click Start in Run again.`
        )
      }
      if (e instanceof SyntaxError) {
        throw new Error(
          `Could not read the model list from ${this.baseUrl}/api/tags. Check that this URL points to an Ollama server.`
        )
      }
      throw e instanceof Error ? e : new Error(msg)
    }
  }

  private async getModelList(): Promise<{ name: string }[]> {
    const res = await httpRequestRaw({
      url: `${this.baseUrl}/api/tags`,
      method: 'GET',
      timeoutMs: 8000
    })
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Ollama at ${this.baseUrl} returned HTTP ${res.statusCode}.`)
    }
    let j: { models?: { name: string }[] }
    try {
      j = JSON.parse(res.body) as { models?: { name: string }[] }
    } catch {
      throw new Error(
        `Could not read the model list from ${this.baseUrl}/api/tags. Check that this URL points to an Ollama server.`
      )
    }
    return j.models ?? []
  }

  /** Confirms the daemon is up and the requested model exists locally (same check as `ollama list`). */
  private async ensureOllamaReady(report?: (e: RuntimeLoadProgress) => void): Promise<void> {
    await ensureOllamaModelInLibrary(this.baseUrl, this.modelName, report)
  }

  async stop(): Promise<void> {
    this.modelName = ''
  }

  getStatus(): RuntimeStatus {
    return {
      running: !!this.modelName,
      kind: 'ollama',
      endpoint: this.baseUrl,
      modelPath: this.modelName
    }
  }

  async chat(
    messages: ChatMessage[],
    opts?: {
      maxTokens?: number
      onStreamChunk?: (text: string) => void
      onStreamUsage?: (u: { promptTokens?: number; completionTokens?: number }) => void
      ollamaModel?: string
      ollamaBaseUrl?: string
      skipDefaultAntiSelfPromptStops?: boolean
      extraStopSequences?: string[]
      temperature?: number
      topP?: number
      frequencyPenalty?: number
      presencePenalty?: number
    }
  ): Promise<string> {
    const model = (opts?.ollamaModel?.trim() || this.modelName).trim()
    if (!model) throw new Error('Ollama model name is missing for this chat request.')
    const base = (opts?.ollamaBaseUrl?.trim() || this.baseUrl).replace(/\/$/, '')
    const url = `${base}/api/chat`
    const stream = Boolean(opts?.onStreamChunk)
    const stop = mergeChatAssistantStopSequences({
      skipDefaultAntiSelfPromptStops: opts?.skipDefaultAntiSelfPromptStops,
      extraStopSequences: opts?.extraStopSequences
    })
    const predict = opts?.maxTokens ?? CHAT_MAX_COMPLETION_TOKENS_FALLBACK
    const ollamaOptions: Record<string, unknown> =
      stop && stop.length > 0 ? { num_predict: predict, stop } : { num_predict: predict }
    if (typeof opts?.temperature === 'number' && Number.isFinite(opts.temperature)) {
      ollamaOptions.temperature = opts.temperature
    }
    if (typeof opts?.topP === 'number' && Number.isFinite(opts.topP)) {
      ollamaOptions.top_p = opts.topP
    }
    if (typeof opts?.frequencyPenalty === 'number' && Number.isFinite(opts.frequencyPenalty)) {
      ollamaOptions.frequency_penalty = opts.frequencyPenalty
    }
    if (typeof opts?.presencePenalty === 'number' && Number.isFinite(opts.presencePenalty)) {
      ollamaOptions.presence_penalty = opts.presencePenalty
    }
    try {
      if (!stream) {
        const { statusCode, json, raw } = await httpPostJson<{
          message?: { content?: string }
          error?: string
          prompt_eval_count?: number
          eval_count?: number
        }>(
          url,
          {
            model,
            messages,
            stream: false,
            options: ollamaOptions
          },
          600_000
        )
        if (statusCode < 200 || statusCode >= 300) {
          const errMsg =
            typeof json === 'object' && json && 'error' in json && typeof json.error === 'string'
              ? json.error
              : raw.slice(0, 400)
          throw new Error(`Ollama returned ${statusCode}: ${errMsg}`)
        }
        const content = json.message?.content
        if (typeof content !== 'string') {
          throw new Error(`Unexpected Ollama response (no message.content): ${raw.slice(0, 300)}`)
        }
        const pt = json.prompt_eval_count
        const ct = json.eval_count
        if (typeof pt === 'number' || typeof ct === 'number') {
          opts?.onStreamUsage?.({
            promptTokens: typeof pt === 'number' ? pt : undefined,
            completionTokens: typeof ct === 'number' ? ct : undefined
          })
        }
        return truncateSimulatedUserContinuation(content)
      }

      let full = ''
      let streamErr: string | undefined
      const { statusCode, errorText } = await httpPostNdjsonStream({
        url,
        jsonBody: {
          model,
          messages,
          stream: true,
          options: ollamaOptions
        },
        timeoutMs: 600_000,
        onObject: (obj) => {
          if (typeof obj.error === 'string' && obj.error.trim()) streamErr = obj.error
          if (obj.done === true) {
            const o = obj as Record<string, unknown>
            const pt = o.prompt_eval_count
            const ct = o.eval_count
            if (typeof pt === 'number' || typeof ct === 'number') {
              opts?.onStreamUsage?.({
                promptTokens: typeof pt === 'number' ? pt : undefined,
                completionTokens: typeof ct === 'number' ? ct : undefined
              })
            }
          }
          const msg = obj.message as { content?: string } | undefined
          const piece = typeof msg?.content === 'string' ? msg.content : ''
          if (piece) {
            full += piece
            opts?.onStreamChunk?.(piece)
          }
        }
      })
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`Ollama returned ${statusCode}: ${errorText?.slice(0, 400) ?? ''}`)
      }
      if (streamErr) throw new Error(streamErr)
      if (!full.trim()) {
        throw new Error('Ollama returned an empty streamed reply')
      }
      return truncateSimulatedUserContinuation(full)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Nothing is listening')) {
        throw new Error(
          `${msg} Ollama may have stopped — launch the Ollama app or run "ollama serve", then send your message again.`
        )
      }
      throw e instanceof Error ? e : new Error(msg)
    }
  }

  async fetchMetrics(): Promise<{ modelMemoryMb?: number }> {
    if (!this.modelName) return {}
    try {
      const { statusCode, body } = await httpRequestRaw({
        url: `${this.baseUrl}/api/ps`,
        method: 'GET',
        timeoutMs: 5000
      })
      if (statusCode < 200 || statusCode >= 300) return {}
      const j = JSON.parse(body) as {
        models?: { name: string; size?: number; size_vram?: number }[]
      }
      const want = this.modelName.trim()
      const list = j.models ?? []
      const row =
        list.find((m) => m.name === want) ??
        list.find((m) => m.name.startsWith(`${want}:`)) ??
        list.find((m) => want.startsWith(m.name)) ??
        list[0]
      if (!row) return {}
      const vram = typeof row.size_vram === 'number' ? row.size_vram : 0
      const ram = typeof row.size === 'number' ? row.size : 0
      const bytes = vram > 0 ? vram : ram
      if (bytes <= 0) return {}
      return { modelMemoryMb: bytes / (1024 * 1024) }
    } catch {
      return {}
    }
  }
}
