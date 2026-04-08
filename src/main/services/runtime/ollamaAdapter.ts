import { logLine } from '../../logger'
import { httpPostJson, httpRequestRaw } from '../httpLocal'
import type { ChatMessage, RuntimeAdapter } from './types'
import type { RuntimeStatus } from '@shared/types'

/** Talks to an existing Ollama daemon (no spawn). */
export class OllamaAdapter implements RuntimeAdapter {
  readonly kind = 'ollama' as const
  private baseUrl: string
  private modelName: string

  constructor(baseUrl = 'http://127.0.0.1:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.modelName = ''
  }

  async start(opts: { modelPath: string }): Promise<void> {
    /** For Ollama, modelPath is the model tag e.g. llama3.1 */
    this.modelName = opts.modelPath
    logLine('info', 'ollama_use_model', { model: this.modelName })
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

  async chat(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string> {
    const url = `${this.baseUrl}/api/chat`
    try {
      const { statusCode, json, raw } = await httpPostJson<{
        message?: { content?: string }
        error?: string
      }>(
        url,
        {
          model: this.modelName,
          messages,
          stream: false,
          options: { num_predict: opts?.maxTokens ?? 512 }
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
      return content
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Nothing is listening')) {
        throw new Error(
          `${msg} Model tag: "${this.modelName}". Pull with: ollama pull ${this.modelName}`
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
