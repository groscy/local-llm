import { spawn, type ChildProcess } from 'child_process'
import { logLine } from '../../logger'
import { httpPostJson, httpRequestRaw } from '../httpLocal'
import type { ChatMessage, RuntimeAdapter } from './types'
import type { RuntimeStatus } from '@shared/types'

export class LlamaCppAdapter implements RuntimeAdapter {
  readonly kind = 'llamacpp' as const
  private proc: ChildProcess | null = null
  private port = 8080
  private modelPath = ''
  private lastError?: string

  async start(opts: { modelPath: string; binaryPath?: string; port?: number }): Promise<void> {
    await this.stop()
    this.modelPath = opts.modelPath
    this.port = opts.port ?? 8080
    const bin = opts.binaryPath
    if (!bin) {
      this.lastError = 'llama-server binary path not configured'
      throw new Error(this.lastError)
    }
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
    await new Promise((r) => setTimeout(r, 1500))
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

  async chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string> {
    const url = `http://127.0.0.1:${this.port}/v1/chat/completions`
    try {
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

  async fetchMetrics(): Promise<{ tokensPerSec?: number; ctxUsed?: number }> {
    try {
      const { statusCode, body } = await httpRequestRaw({
        url: `http://127.0.0.1:${this.port}/health`,
        method: 'GET',
        timeoutMs: 5000
      })
      if (statusCode < 200 || statusCode >= 300) return {}
      const j = JSON.parse(body) as Record<string, unknown>
      return {
        tokensPerSec: typeof j.tokens_per_second === 'number' ? j.tokens_per_second : undefined,
        ctxUsed: typeof j.ctx_used === 'number' ? j.ctx_used : undefined
      }
    } catch {
      return {}
    }
  }
}
