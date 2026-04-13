import { spawn, type ChildProcess } from 'child_process'
import path from 'node:path'
import { logLine } from '../../logger'
import { httpPostJson, httpPostStreamingResponse, httpRequestRaw } from '../httpLocal'
import { processRssMb } from '../processMemory'
import type { ChatMessage, RuntimeAdapter, RuntimeLoadProgress } from './types'
import type { RuntimeStatus } from '@shared/types'

/** llama-server often does not bind until weights are loaded; large GGUF / first load can exceed 10+ minutes. */
const LLAMA_READY_TIMEOUT_MS = 3_600_000
const LLAMA_READY_POLL_MS = 900

/** Buffer OpenAI-style SSE (`data: {...}\\n\\n`) and extract `delta.content` chunks. */
class SseChatBuffer {
  private buf = ''
  private out = ''

  constructor(
    private readonly onUsage?: (u: { promptTokens?: number; completionTokens?: number }) => void
  ) {}

  feed(chunk: string, onDelta: (s: string) => void): void {
    this.buf += chunk
    this.drainBlocks(onDelta)
  }

  finalize(onDelta: (s: string) => void): void {
    if (this.buf.trim()) {
      const tail = this.buf
      this.buf = ''
      for (const block of tail.split(/\n\n+/)) {
        if (block.trim()) this.parseBlock(block, onDelta)
      }
    }
  }

  getAccumulated(): string {
    return this.out
  }

  private drainBlocks(onDelta: (s: string) => void): void {
    for (;;) {
      const idx = this.buf.indexOf('\n\n')
      if (idx < 0) break
      const block = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 2)
      if (block.trim()) this.parseBlock(block, onDelta)
    }
  }

  private parseBlock(block: string, onDelta: (s: string) => void): void {
    for (const line of block.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as {
          choices?: { delta?: { content?: string }; message?: { content?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const u = j.usage
        if (u && typeof u === 'object') {
          const pt = u.prompt_tokens
          const ct = u.completion_tokens
          if (typeof pt === 'number' || typeof ct === 'number') {
            this.onUsage?.({
              promptTokens: typeof pt === 'number' ? pt : undefined,
              completionTokens: typeof ct === 'number' ? ct : undefined
            })
          }
        }
        const c = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content
        if (typeof c === 'string' && c) {
          this.out += c
          onDelta(c)
        }
      } catch {
        /* ignore */
      }
    }
  }
}

export class LlamaCppAdapter implements RuntimeAdapter {
  readonly kind = 'llamacpp' as const
  private proc: ChildProcess | null = null
  private port = 8080
  /** Path passed to llama-server `-m` (may be a cached GGUF when user picked `.safetensors`). */
  private modelPath = ''
  /** Shown in UI / status (user’s selected file when it differs from `modelPath`). */
  private displayModelPath = ''
  private lastError?: string
  private stderrTail = ''
  private lastExitCode: number | null = null

  private appendStderr(chunk: string): void {
    this.stderrTail = (this.stderrTail + chunk).slice(-12000)
  }

  private stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, '')
  }

  /** Last few stderr lines for the load UI (llama-server logs tensor / layer progress here). */
  private stderrDetailLines(maxLen = 640): string {
    const raw = this.stripAnsi(this.stderrTail).trim()
    if (!raw) return ''
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
    const pick = lines.slice(-8)
    const tail = pick.join('\n')
    return tail.length > maxLen ? tail.slice(-maxLen) : tail
  }

  /**
   * Whether the OpenAI-compatible API is ready, plus a short caption from `/health` JSON when present
   * (`status`, slot counts, errors).
   */
  private async pollHealth(): Promise<{ ready: boolean; info: string }> {
    const base = `http://127.0.0.1:${this.port}`
    const interpretHealthBody = (
      body: string,
      httpOk: boolean
    ): { ready: boolean; caption: string } | null => {
      try {
        const j = JSON.parse(body) as Record<string, unknown>
        const bits: string[] = []
        if (typeof j.status === 'string') bits.push(`status=${j.status}`)
        for (const k of ['slots_idle', 'slots_processing', 'slots_deferred'] as const) {
          if (typeof j[k] === 'number') bits.push(`${k}=${j[k]}`)
        }
        const err = j.error
        if (typeof err === 'string' && err.trim()) bits.push(err.trim().slice(0, 180))
        const caption = bits.join(' · ')
        const st = j.status
        if (st === 'loading' || st === 'error') return { ready: false, caption }
        if (st === 'ok' || st == null) return { ready: true, caption }
        return { ready: false, caption }
      } catch {
        return httpOk ? { ready: true, caption: '' } : null
      }
    }

    try {
      const { statusCode, body } = await httpRequestRaw({
        url: `${base}/health`,
        method: 'GET',
        timeoutMs: 4000
      })
      if (statusCode === 503) {
        const s = interpretHealthBody(body, false)
        return { ready: false, info: s?.caption || 'HTTP 503 (server busy or still loading)' }
      }
      if (statusCode >= 200 && statusCode < 300) {
        const s = interpretHealthBody(body, true)
        if (s) return { ready: s.ready, info: s.caption }
        return { ready: true, info: '' }
      }
    } catch {
      /* still starting or connection refused */
    }
    try {
      const { statusCode } = await httpRequestRaw({
        url: `${base}/v1/models`,
        method: 'GET',
        timeoutMs: 4000
      })
      if (statusCode >= 200 && statusCode < 300) return { ready: true, info: 'Chat API reachable' }
      if (statusCode === 503) return { ready: false, info: '/v1/models: HTTP 503' }
    } catch {
      /* */
    }
    return { ready: false, info: '' }
  }

  /** True when HTTP is accepting requests (model loaded enough for /v1/chat/completions). */
  private async probeLlamaReady(): Promise<boolean> {
    const { ready } = await this.pollHealth()
    return ready
  }

  private async waitUntilLlamaReady(
    deadline: number,
    report?: (e: RuntimeLoadProgress) => void
  ): Promise<void> {
    const start = Date.now()
    let lastEmitAt = 0
    /** Force first poll to publish so the UI updates immediately after spawn. */
    let lastDetailKey = '\x00'
    for (;;) {
      if (!this.proc) {
        const tail = this.stderrTail.trim().slice(-1200)
        const code = this.lastExitCode
        throw new Error(
          `llama-server exited before the HTTP port was ready${code != null ? ` (exit ${code})` : ''}.` +
            (tail ? ` Last output:\n${tail}` : ' Check the model path and llama-server build.')
        )
      }
      const { ready, info } = await this.pollHealth()
      if (ready) return
      if (Date.now() >= deadline) {
        throw new Error(
          `llama-server did not become ready within ${Math.round(LLAMA_READY_TIMEOUT_MS / 1000)}s.` +
            (this.stderrTail.trim() ? `\nRecent stderr:\n${this.stderrTail.trim().slice(-1200)}` : '')
        )
      }
      const elapsed = Date.now() - start
      const pct = Math.min(92, 28 + Math.round((elapsed / LLAMA_READY_TIMEOUT_MS) * 64))
      const stderrBit = this.stderrDetailLines()
      const detailParts = [
        info ? `Server: ${info}` : '',
        stderrBit ? `llama-server:\n${stderrBit}` : ''
      ].filter(Boolean)
      const detail = detailParts.join('\n\n').slice(0, 1400)
      const detailKey = `${info}|${stderrBit}`
      const now = Date.now()
      if (detailKey !== lastDetailKey || now - lastEmitAt >= 2800) {
        lastDetailKey = detailKey
        lastEmitAt = now
        const hint = info || `waiting for 127.0.0.1:${this.port}`
        report?.({
          phase: 'load',
          message: `Loading weights — ${hint} · ${Math.round(elapsed / 1000)}s elapsed`,
          percent: pct,
          detail: detail || undefined
        })
      }
      await new Promise((r) => setTimeout(r, LLAMA_READY_POLL_MS))
    }
  }

  async start(opts: {
    modelPath: string
    /** When set, `getStatus().modelPath` reports this (e.g. original `.safetensors` path). */
    displayModelPath?: string
    binaryPath?: string
    port?: number
    onLoadProgress?: (e: RuntimeLoadProgress) => void
  }): Promise<void> {
    await this.stop()
    this.modelPath = opts.modelPath
    this.displayModelPath = (opts.displayModelPath?.trim() || opts.modelPath).trim()
    this.port = opts.port ?? 8080
    const report = opts.onLoadProgress
    const bin = opts.binaryPath
    if (!bin) {
      this.lastError = 'llama-server binary path not configured'
      throw new Error(this.lastError)
    }
    this.stderrTail = ''
    this.lastExitCode = null
    report?.({ phase: 'spawn', message: 'Starting llama-server…', percent: 5 })
    const args = ['-m', opts.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '-c', '4096']
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.proc = child
    child.stderr?.on('data', (d) => {
      const s = d.toString()
      this.appendStderr(s)
      logLine('info', 'llama_stderr', { chunk: s.slice(0, 200) })
    })
    child.on('error', (e) => {
      this.lastError = e.message
      logLine('error', 'llama_spawn_error', { error: e.message })
    })
    child.on('exit', (code) => {
      this.lastExitCode = code
      logLine('info', 'llama_exit', { code })
      this.proc = null
    })
    const ext = path.extname(opts.modelPath).toLowerCase()
    const weightKind =
      ext === '.gguf' ? 'GGUF' : ext === '.safetensors' || ext === '.safetensor' ? 'Safetensors' : 'model'
    report?.({
      phase: 'load',
      message: `Loading ${weightKind} weights into memory — server will accept chat when ready (may take several minutes for large files)…`,
      percent: 22,
      detail: `Model file:\n${this.displayModelPath || opts.modelPath}`
    })
    const deadline = Date.now() + LLAMA_READY_TIMEOUT_MS
    await this.waitUntilLlamaReady(deadline, report)
    report?.({ phase: 'ready', message: 'llama-server is ready.', percent: 100 })
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }
  }

  getStatus(): RuntimeStatus {
    return {
      running: !!this.proc,
      kind: 'llamacpp',
      endpoint: `http://127.0.0.1:${this.port}`,
      modelPath: this.displayModelPath || this.modelPath,
      pid: this.proc?.pid,
      lastError: this.lastError
    }
  }

  async chat(
    messages: ChatMessage[],
    opts?: {
      maxTokens?: number
      onStreamChunk?: (text: string) => void
      onStreamUsage?: (u: { promptTokens?: number; completionTokens?: number }) => void
    }
  ): Promise<string> {
    if (!this.proc) {
      throw new Error(
        'llama-server is not running (the process exited or was stopped). Open Run, then Start the llama.cpp runtime again.'
      )
    }
    const url = `http://127.0.0.1:${this.port}/v1/chat/completions`
    const stream = Boolean(opts?.onStreamChunk)
    try {
      if (!stream) {
        const { statusCode, json, raw } = await httpPostJson<{
          choices?: { message?: { content?: string } }[]
          error?: { message?: string }
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }>(
          url,
          {
            model: 'gpt-3.5-turbo',
            messages,
            max_tokens: opts?.maxTokens ?? 512,
            stream: false
          },
          600_000
        )
        if (statusCode < 200 || statusCode >= 300) {
          const errBody =
            typeof json === 'object' && json?.error && typeof json.error.message === 'string'
              ? json.error.message
              : raw.slice(0, 400)
          throw new Error(`llama.cpp server returned ${statusCode}: ${errBody}`)
        }
        const text = json.choices?.[0]?.message?.content
        if (typeof text !== 'string') {
          throw new Error(`Unexpected llama.cpp response: ${raw.slice(0, 300)}`)
        }
        const u = json.usage
        if (u && typeof u === 'object') {
          const pt = u.prompt_tokens
          const ct = u.completion_tokens
          if (typeof pt === 'number' || typeof ct === 'number') {
            opts?.onStreamUsage?.({
              promptTokens: typeof pt === 'number' ? pt : undefined,
              completionTokens: typeof ct === 'number' ? ct : undefined
            })
          }
        }
        return text
      }

      const streamOpts = opts!
      const body = JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: streamOpts.maxTokens ?? 512,
        stream: true
      })
      const sse = new SseChatBuffer(streamOpts.onStreamUsage)
      const onDelta = streamOpts.onStreamChunk!
      const { statusCode, tail } = await httpPostStreamingResponse({
        url,
        body,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        timeoutMs: 600_000,
        onChunk: (c) => sse.feed(c, onDelta)
      })
      sse.finalize(onDelta)
      if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`llama.cpp server returned ${statusCode}: ${tail.slice(0, 400)}`)
      }
      const acc = sse.getAccumulated()
      if (!acc.trim()) {
        throw new Error(`Unexpected llama.cpp stream response: ${tail.slice(0, 300)}`)
      }
      return acc
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Nothing is listening')) {
        throw new Error(
          `${msg} Start the server from Run (port ${this.port}) or check that llama-server exposes /v1/chat/completions.`
        )
      }
      throw e instanceof Error ? e : new Error(msg)
    }
  }

  async fetchMetrics(): Promise<{
    tokensPerSec?: number
    ctxUsed?: number
    modelMemoryMb?: number
  }> {
    let tokensPerSec: number | undefined
    let ctxUsed: number | undefined
    try {
      const { statusCode, body } = await httpRequestRaw({
        url: `http://127.0.0.1:${this.port}/health`,
        method: 'GET',
        timeoutMs: 5000
      })
      if (statusCode >= 200 && statusCode < 300) {
        const j = JSON.parse(body) as Record<string, unknown>
        tokensPerSec = typeof j.tokens_per_second === 'number' ? j.tokens_per_second : undefined
        ctxUsed = typeof j.ctx_used === 'number' ? j.ctx_used : undefined
      }
    } catch {
      /* ignore */
    }
    const pid = this.proc?.pid
    const modelMemoryMb = processRssMb(pid)
    return { tokensPerSec, ctxUsed, modelMemoryMb }
  }
}
