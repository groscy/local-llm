import { spawn, type ChildProcess, type SpawnOptions } from 'child_process'
import { existsSync } from 'fs'
import path from 'node:path'
import { logLine } from '../../logger'
import { clampLlamaContextTokens, LLAMA_CONTEXT_TOKENS_DEFAULT } from '@shared/llamaContext'
import { CHAT_MAX_COMPLETION_TOKENS_FALLBACK, clampChatMaxCompletionTokens } from '../chatMaxTokens'
import { mergeChatAssistantStopSequences, truncateSimulatedUserContinuation } from '@shared/chatAssistantGuards'
import { httpPostJson, httpPostStreamingResponse, httpRequestRaw } from '../httpLocal'
import { processRssMb } from '../processMemory'
import type { ChatMessage, RuntimeAdapter, RuntimeLoadProgress } from './types'
import type { RuntimeStatus } from '@shared/types'

/** llama-server often does not bind until weights are loaded; large GGUF / first load can exceed 10+ minutes. */
const LLAMA_READY_TIMEOUT_MS = 3_600_000
const LLAMA_READY_POLL_MS = 900
const GPU_INIT_FAILURE_RE =
  /vk_error_incompatible_driver|ggml_vulkan|vulkan.*(error|failed)|failed to initialize vulkan|cuda.*(error|failed)/i

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
  /** Combined stdout+stderr tail (many llama-server builds log load progress on stdout). */
  private serverLogTail = ''
  private lastExitCode: number | null = null
  /** Forward debounced process output to `onLoadProgress` while the model is loading (not after ready). */
  private forwardStderrToUi = false
  private stderrUiBatch = ''
  private stderrUiFlushTimer: ReturnType<typeof setTimeout> | null = null

  private appendServerLog(chunk: string): void {
    this.serverLogTail = (this.serverLogTail + chunk).slice(-24000)
  }

  private stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, '')
  }

  /** Turn progress lines that use `\r` into newlines so chunks are visible in the UI. */
  private normalizeServerChunk(s: string): string {
    return this.stripAnsi(s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
  }

  private shouldRetryCpuSafe(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    const hay = `${msg}\n${this.serverLogTail}`.toLowerCase()
    return GPU_INIT_FAILURE_RE.test(hay)
  }

  private flushStderrUiBatch(report?: (e: RuntimeLoadProgress) => void, force = false): void {
    if (this.stderrUiFlushTimer != null) {
      clearTimeout(this.stderrUiFlushTimer)
      this.stderrUiFlushTimer = null
    }
    const chunk = this.stderrUiBatch
    this.stderrUiBatch = ''
    if (chunk && report && (force || this.forwardStderrToUi)) {
      report({ phase: 'load_log', message: chunk })
    }
  }

  private queueStderrForUi(s: string, report?: (e: RuntimeLoadProgress) => void): void {
    if (!this.forwardStderrToUi || !report) return
    this.stderrUiBatch += s
    if (this.stderrUiFlushTimer != null) return
    this.stderrUiFlushTimer = setTimeout(() => {
      this.stderrUiFlushTimer = null
      const chunk = this.stderrUiBatch
      this.stderrUiBatch = ''
      if (chunk && this.forwardStderrToUi) {
        report({ phase: 'load_log', message: chunk })
      }
    }, 50)
  }

  /** Last few process log lines for the load UI (tensor / layer progress). */
  private serverLogDetailLines(maxLen = 1200): string {
    const raw = this.normalizeServerChunk(this.serverLogTail).trim()
    if (!raw) return ''
    const lines = raw
      .split(/\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
    const pick = lines.slice(-14)
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
    let lastStatusLogAt = 0
    let firstStatusLog = true
    /** Force first poll to publish so the UI updates immediately after spawn. */
    let lastDetailKey = '\x00'
    for (;;) {
      if (!this.proc) {
        const tail = this.serverLogTail.trim().slice(-1200)
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
            (this.serverLogTail.trim() ? `\nRecent server output:\n${this.serverLogTail.trim().slice(-1200)}` : '')
        )
      }
      const elapsed = Date.now() - start
      const pct = Math.min(92, 28 + Math.round((elapsed / LLAMA_READY_TIMEOUT_MS) * 64))
      const logBit = this.serverLogDetailLines()
      const detailParts = [
        `Process pid ${this.proc.pid ?? '?'} · HTTP 127.0.0.1:${this.port}`,
        info ? `Health / API: ${info}` : 'Health / API: (not responding yet — normal while weights load)',
        logBit ? `Server log (stdout+stderr, last lines):\n${logBit}` : ''
      ].filter(Boolean)
      const detail = detailParts.join('\n\n').slice(0, 2800)
      const detailKey = `${info}|${logBit}`
      const now = Date.now()
      if (detailKey !== lastDetailKey || now - lastEmitAt >= 1400) {
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
      if (firstStatusLog || now - lastStatusLogAt >= 1800) {
        firstStatusLog = false
        lastStatusLogAt = now
        const statusLines = [
          `── ${Math.round(elapsed / 1000)}s · pid ${this.proc.pid ?? '?'} · port ${this.port}`,
          info ? `Health: ${info}` : 'Health: still waiting (connection refused or loading)',
          logBit ? `Log tail:\n${logBit}` : '(no stdout/stderr lines captured yet — server may be quiet or still starting)'
        ]
        report?.({ phase: 'load_log', message: `${statusLines.join('\n')}\n\n` })
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
    /** Aligns server default `-n` with Settings → Max response tokens (HTTP still sends `max_tokens` each call). */
    defaultPredictTokens?: number
    /** `-c` KV context length; defaults if omitted. */
    contextTokens?: number
    onLoadProgress?: (e: RuntimeLoadProgress) => void
  }): Promise<void> {
    await this.stop()
    this.port = opts.port ?? 8080
    const report = opts.onLoadProgress
    const bin = opts.binaryPath
    if (!bin) {
      this.lastError = 'llama-server binary path not configured'
      throw new Error(this.lastError)
    }
    const binResolved = path.resolve(String(bin).replace(/^file:\/\//i, ''))
    if (!existsSync(binResolved)) {
      this.lastError = `llama-server binary not found: ${binResolved}`
      throw new Error(this.lastError)
    }
    const binDir = path.dirname(binResolved)
    const modelResolved = path.resolve(String(opts.modelPath).replace(/^file:\/\//i, ''))
    if (!existsSync(modelResolved)) {
      this.lastError = `Model weights not found: ${modelResolved}`
      throw new Error(this.lastError)
    }
    this.modelPath = modelResolved
    this.displayModelPath = (opts.displayModelPath?.trim() || modelResolved).trim()
    this.serverLogTail = ''
    this.lastExitCode = null
    this.stderrUiBatch = ''
    if (this.stderrUiFlushTimer != null) {
      clearTimeout(this.stderrUiFlushTimer)
      this.stderrUiFlushTimer = null
    }
    this.forwardStderrToUi = true
    report?.({ phase: 'spawn', message: 'Starting llama-server…', percent: 5 })
    /** `--verbose` forces log lines over piped stdio (see llama.cpp server README). */
    const nPredict =
      typeof opts.defaultPredictTokens === 'number' && Number.isFinite(opts.defaultPredictTokens)
        ? clampChatMaxCompletionTokens(opts.defaultPredictTokens)
        : undefined
    const ctx =
      typeof opts.contextTokens === 'number' && Number.isFinite(opts.contextTokens)
        ? clampLlamaContextTokens(opts.contextTokens)
        : LLAMA_CONTEXT_TOKENS_DEFAULT
    const baseArgs = [
      '--verbose',
      '-m',
      modelResolved,
      '--host',
      '127.0.0.1',
      '--port',
      String(this.port),
      '-c',
      String(ctx),
      ...(nPredict != null ? (['-n', String(nPredict)] as const) : [])
    ]
    const launchAttempt = async (cpuSafe: boolean): Promise<void> => {
      this.serverLogTail = ''
      this.lastExitCode = null
      const args = cpuSafe ? [...baseArgs, '-ngl', '0'] : [...baseArgs]
      const env = cpuSafe
        ? {
            ...process.env,
            GGML_VK_DISABLE: '1',
            CUDA_VISIBLE_DEVICES: '',
            HIP_VISIBLE_DEVICES: '',
            ROCR_VISIBLE_DEVICES: ''
          }
        : { ...process.env }
      const spawnOpts: SpawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: binDir,
        env,
        /**
         * Must stay `false` on Windows: `windowsHide: true` applies CREATE_NO_WINDOW, which often
         * breaks piped stdout/stderr and DLL loading for CUDA llama-server builds next to the exe.
         */
        windowsHide: false
      }
      const child = spawn(binResolved, args, spawnOpts)
      this.proc = child
      const argDisplay = args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
      report?.({
        phase: 'load_log',
        message:
          `Launching llama-server${cpuSafe ? ' (CPU-safe fallback)' : ''}\n` +
          `  exe: ${binResolved}\n` +
          `  cwd: ${binDir}\n` +
          `  pid (initial): ${String(child.pid ?? 'not yet assigned')}\n` +
          `  ${path.basename(binResolved)} ${argDisplay}\n` +
          `  API → http://127.0.0.1:${this.port}\n\n`
      })
      const onChunk = (stream: 'stdout' | 'stderr', d: Buffer | string): void => {
        const s = typeof d === 'string' ? d : d.toString('utf8')
        this.appendServerLog(s)
        const cleaned = this.normalizeServerChunk(s)
        if (cleaned.trim()) this.queueStderrForUi(cleaned, report)
        logLine('info', stream === 'stderr' ? 'llama_stderr' : 'llama_stdout', { chunk: s.slice(0, 200) })
      }
      child.stdout?.on('data', (d) => onChunk('stdout', d))
      child.stderr?.on('data', (d) => onChunk('stderr', d))
      child.on('spawn', () => {
        report?.({
          phase: 'load_log',
          message: `Spawn event · pid=${String(child.pid ?? '?')} (stdio pipes attached)\n\n`
        })
      })
      child.on('error', (e) => {
        this.lastError = e.message
        logLine('error', 'llama_spawn_error', { error: e.message })
        report?.({ phase: 'load_log', message: `\n[spawn error] ${e.message}\n\n` })
      })
      child.on('exit', (code) => {
        this.lastExitCode = code
        logLine('info', 'llama_exit', { code })
        this.flushStderrUiBatch(report, true)
        this.forwardStderrToUi = false
        this.proc = null
      })
      const ext = path.extname(modelResolved).toLowerCase()
      const weightKind =
        ext === '.gguf' ? 'GGUF' : ext === '.safetensors' || ext === '.safetensor' ? 'Safetensors' : 'model'
      report?.({
        phase: 'load',
        message: `Loading ${weightKind} weights into memory — server will accept chat when ready (may take several minutes for large files)…`,
        percent: 22,
        detail: `Model file:\n${this.displayModelPath || modelResolved}`
      })
      await new Promise((r) => setTimeout(r, 120))
      if (child.exitCode != null || child.signalCode != null) {
        const tail = this.serverLogTail.trim().slice(-2400)
        throw new Error(
          `llama-server exited immediately (code ${child.exitCode}, signal ${child.signalCode ?? 'none'}).` +
            (tail
              ? `\nCaptured output:\n${tail}`
              : '\nNo output was captured. Copy the command from the log and run it in Command Prompt to see the error.') +
            (process.platform === 'win32'
              ? '\nTip: CUDA builds need matching GPU drivers; the working directory is set to the folder containing the exe so bundled DLLs load.'
              : '')
        )
      }
      const deadline = Date.now() + LLAMA_READY_TIMEOUT_MS
      await this.waitUntilLlamaReady(deadline, report)
    }
    try {
      await launchAttempt(false)
    } catch (e) {
      if (!this.shouldRetryCpuSafe(e)) throw e
      report?.({
        phase: 'load_log',
        message:
          'GPU initialization failed (Vulkan/CUDA). Retrying with CPU-safe flags (`-ngl 0`) so the model can run without GPU support...\n\n'
      })
      try {
        await this.stop()
      } catch {
        /* ignore stop errors between attempts */
      }
      this.forwardStderrToUi = true
      await launchAttempt(true)
    }
    this.forwardStderrToUi = false
    this.flushStderrUiBatch(report, true)
    report?.({ phase: 'ready', message: 'llama-server is ready.', percent: 100 })
  }

  async stop(): Promise<void> {
    this.forwardStderrToUi = false
    this.stderrUiBatch = ''
    if (this.stderrUiFlushTimer != null) {
      clearTimeout(this.stderrUiFlushTimer)
      this.stderrUiFlushTimer = null
    }
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
    if (opts?.ollamaModel?.trim() || opts?.ollamaBaseUrl?.trim()) {
      throw new Error(
        'This runtime is llama.cpp — parallel workers cannot target different Ollama models. Switch to Ollama in Run, or turn off multi-model agents.'
      )
    }
    if (!this.proc) {
      throw new Error(
        'llama-server is not running (the process exited or was stopped). Open Run, then Start the llama.cpp runtime again.'
      )
    }
    const url = `http://127.0.0.1:${this.port}/v1/chat/completions`
    const stream = Boolean(opts?.onStreamChunk)
    const stop = mergeChatAssistantStopSequences({
      skipDefaultAntiSelfPromptStops: opts?.skipDefaultAntiSelfPromptStops,
      extraStopSequences: opts?.extraStopSequences
    })
    const stopBody = stop && stop.length > 0 ? { stop } : {}
    const samp: Record<string, number> = {}
    if (typeof opts?.temperature === 'number' && Number.isFinite(opts.temperature)) {
      samp.temperature = opts.temperature
    }
    if (typeof opts?.topP === 'number' && Number.isFinite(opts.topP)) {
      samp.top_p = opts.topP
    }
    if (typeof opts?.frequencyPenalty === 'number' && Number.isFinite(opts.frequencyPenalty)) {
      samp.frequency_penalty = opts.frequencyPenalty
    }
    if (typeof opts?.presencePenalty === 'number' && Number.isFinite(opts.presencePenalty)) {
      samp.presence_penalty = opts.presencePenalty
    }
    const samplingBody = Object.keys(samp).length > 0 ? samp : {}
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
            max_tokens: opts?.maxTokens ?? CHAT_MAX_COMPLETION_TOKENS_FALLBACK,
            stream: false,
            ...stopBody,
            ...samplingBody
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
        return truncateSimulatedUserContinuation(text)
      }

      const streamOpts = opts!
      const body = JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: streamOpts.maxTokens ?? CHAT_MAX_COMPLETION_TOKENS_FALLBACK,
        stream: true,
        ...stopBody,
        ...samplingBody
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
      return truncateSimulatedUserContinuation(acc)
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
