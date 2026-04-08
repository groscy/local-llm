import { spawn, type ChildProcess } from 'child_process'
import { logLine } from '../../logger'
import { httpPostJson, httpPostStreamingResponse, httpRequestRaw } from '../httpLocal'
import { processRssMb } from '../processMemory'
import type { ChatMessage, RuntimeAdapter, RuntimeLoadProgress } from './types'
import type { RuntimeStatus } from '@shared/types'

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
  private modelPath = ''
  private lastError?: string

  async start(opts: {
    modelPath: string
    binaryPath?: string
    port?: number
    onLoadProgress?: (e: RuntimeLoadProgress) => void
  }): Promise<void> {
    await this.stop()
    this.modelPath = opts.modelPath
    this.port = opts.port ?? 8080
    const report = opts.onLoadProgress
    const bin = opts.binaryPath
    if (!bin) {
      this.lastError = 'llama-server binary path not configured'
      throw new Error(this.lastError)
    }
    report?.({ phase: 'spawn', message: 'Starting llama-server…', percent: 5 })
    const args = ['-m', opts.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '-c', '4096']
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = child
    child.stderr?.on('data', (d) => logLine('info', 'llama_stderr', { chunk: d.toString().slice(0, 200) }))
    child.on('error', (e) => {
      this.lastError = e.message
      logLine('error', 'llama_spawn_error', { error: e.message })
    })
    child.on('exit', (code) => {
      logLine('info', 'llama_exit', { code })
      this.proc = null
    })
    report?.({ phase: 'load', message: 'Loading weights into memory (this can take a while)…', percent: 25 })
    await new Promise((r) => setTimeout(r, 1500))
    report?.({ phase: 'wait', message: `Listening on 127.0.0.1:${this.port} — finishing startup…`, percent: 85 })
    await new Promise((r) => setTimeout(r, 500))
    report?.({ phase: 'ready', message: 'llama-server should be ready.', percent: 100 })
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
      modelPath: this.modelPath,
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
    const url = `http://127.0.0.1:${this.port}/v1/chat/completions`
    const stream = Boolean(opts?.onStreamChunk)
    try {
      if (!stream) {
        const { statusCode, json, raw } = await httpPostJson<{
          choices?: { message?: { content?: string } }[]
          error?: { message?: string }
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
