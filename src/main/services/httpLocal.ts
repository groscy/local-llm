import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import http from 'http'
import https from 'https'
import { URL } from 'url'

/**
 * HTTP(S) requests from the main process. Prefer this over `fetch` to localhost —
 * Electron/Node `fetch` often surfaces opaque `TypeError: fetch failed` on Windows.
 */
export async function httpRequestRaw(options: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer
  timeoutMs?: number
}): Promise<{ statusCode: number; body: string }> {
  const u = new URL(options.url)
  const isHttps = u.protocol === 'https:'
  const mod = isHttps ? https : http
  const defaultPort = isHttps ? '443' : '80'
  const port = u.port || defaultPort

  const contentLength =
    options.body == null
      ? undefined
      : Buffer.isBuffer(options.body)
        ? options.body.length
        : Buffer.byteLength(options.body, 'utf8')

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: options.method ?? 'GET',
        headers: {
          ...options.headers,
          ...(contentLength != null ? { 'Content-Length': String(contentLength) } : {})
        },
        timeout: options.timeoutMs ?? 300_000
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({ statusCode: res.statusCode ?? 0, body })
        })
      }
    )

    req.on('error', (err: NodeJS.ErrnoException) => {
      const target = `${u.hostname}:${port}`
      let hint = err.message
      if (err.code === 'ECONNREFUSED') {
        hint = `Nothing is listening at ${target}. Start Ollama (ollama serve) or your llama.cpp server, then try again.`
      } else if (err.code === 'ENOTFOUND') {
        hint = `Could not resolve host: ${u.hostname}`
      } else if (err.code === 'ETIMEDOUT') {
        hint = `Connection to ${target} timed out.`
      }
      reject(new Error(hint))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Request to ${u.hostname}:${port} timed out.`))
    })

    if (options.body != null) {
      if (Buffer.isBuffer(options.body)) req.write(options.body)
      else req.write(options.body, 'utf8')
    }
    req.end()
  })
}

/** POST raw file bytes to URL (streams from disk; does not load whole file into memory). */
export async function httpPostFileStream(options: {
  url: string
  filePath: string
  headers?: Record<string, string>
  timeoutMs?: number
  /** Bytes uploaded so far and total file size. */
  onUploadProgress?: (sent: number, total: number) => void
}): Promise<{ statusCode: number; body: string }> {
  const st = await stat(options.filePath)
  const u = new URL(options.url)
  const isHttps = u.protocol === 'https:'
  const mod = isHttps ? https : http
  const defaultPort = isHttps ? '443' : '80'
  const port = u.port || defaultPort

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          ...options.headers,
          'Content-Length': String(st.size)
        },
        timeout: options.timeoutMs ?? 300_000
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve({ statusCode: res.statusCode ?? 0, body })
        })
      }
    )

    req.on('error', (err: NodeJS.ErrnoException) => {
      const target = `${u.hostname}:${port}`
      let hint = err.message
      if (err.code === 'ECONNREFUSED') {
        hint = `Nothing is listening at ${target}. Start Ollama (ollama serve) or your llama.cpp server, then try again.`
      } else if (err.code === 'ENOTFOUND') {
        hint = `Could not resolve host: ${u.hostname}`
      } else if (err.code === 'ETIMEDOUT') {
        hint = `Connection to ${target} timed out.`
      }
      reject(new Error(hint))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Request to ${u.hostname}:${port} timed out.`))
    })

    const rs = createReadStream(options.filePath)
    rs.on('error', reject)
    if (options.onUploadProgress) {
      let sent = 0
      rs.on('data', (chunk: string | Buffer) => {
        const n = typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.length
        sent += n
        options.onUploadProgress!(sent, st.size)
      })
    }
    rs.pipe(req)
  })
}

/** POST JSON and read a newline-delimited JSON body (Ollama pull/chat with `stream: true`). */
export async function httpPostNdjsonStream(options: {
  url: string
  jsonBody: unknown
  headers?: Record<string, string>
  timeoutMs?: number
  onObject: (obj: Record<string, unknown>) => void
}): Promise<{ statusCode: number; errorText?: string }> {
  const body = JSON.stringify(options.jsonBody)
  const u = new URL(options.url)
  const isHttps = u.protocol === 'https:'
  const mod = isHttps ? https : http
  const defaultPort = isHttps ? '443' : '80'
  const port = u.port || defaultPort

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, application/x-ndjson, text/event-stream',
          ...options.headers,
          'Content-Length': String(Buffer.byteLength(body, 'utf8'))
        },
        timeout: options.timeoutMs ?? 300_000
      },
      (res) => {
        let buf = ''
        const errChunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          if (res.statusCode != null && (res.statusCode < 200 || res.statusCode >= 300)) {
            errChunks.push(chunk)
            return
          }
          buf += chunk.toString('utf8')
          for (;;) {
            const nl = buf.indexOf('\n')
            if (nl < 0) break
            let line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            if (line.startsWith('data:')) line = line.slice(5).trim()
            if (!line) continue
            try {
              options.onObject(JSON.parse(line) as Record<string, unknown>)
            } catch {
              /* ignore non-JSON line */
            }
          }
        })
        res.on('end', () => {
          const code = res.statusCode ?? 0
          if (code < 200 || code >= 300) {
            const errText = Buffer.concat(errChunks).toString('utf8').trim()
            resolve({ statusCode: code, errorText: errText || undefined })
            return
          }
          let tail = buf.trim()
          if (tail.startsWith('data:')) tail = tail.slice(5).trim()
          if (tail) {
            try {
              options.onObject(JSON.parse(tail) as Record<string, unknown>)
            } catch {
              /* ignore */
            }
          }
          resolve({ statusCode: code })
        })
      }
    )

    req.on('error', (err: NodeJS.ErrnoException) => {
      const target = `${u.hostname}:${port}`
      let hint = err.message
      if (err.code === 'ECONNREFUSED') {
        hint = `Nothing is listening at ${target}. Start Ollama (ollama serve) or your llama.cpp server, then try again.`
      } else if (err.code === 'ENOTFOUND') {
        hint = `Could not resolve host: ${u.hostname}`
      } else if (err.code === 'ETIMEDOUT') {
        hint = `Connection to ${target} timed out.`
      }
      reject(new Error(hint))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Request to ${u.hostname}:${port} timed out.`))
    })

    req.write(body, 'utf8')
    req.end()
  })
}

/** POST a UTF-8 body and forward each response chunk (for SSE / incremental parsing). */
export async function httpPostStreamingResponse(options: {
  url: string
  body: string
  headers?: Record<string, string>
  timeoutMs?: number
  onChunk: (chunk: string) => void
}): Promise<{ statusCode: number; tail: string }> {
  const u = new URL(options.url)
  const isHttps = u.protocol === 'https:'
  const mod = isHttps ? https : http
  const defaultPort = isHttps ? '443' : '80'
  const port = u.port || defaultPort

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: {
          ...options.headers,
          'Content-Length': String(Buffer.byteLength(options.body, 'utf8'))
        },
        timeout: options.timeoutMs ?? 300_000
      },
      (res) => {
        let tail = ''
        res.on('data', (chunk: Buffer) => {
          const s = chunk.toString('utf8')
          tail += s
          options.onChunk(s)
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, tail })
        })
      }
    )

    req.on('error', (err: NodeJS.ErrnoException) => {
      const target = `${u.hostname}:${port}`
      let hint = err.message
      if (err.code === 'ECONNREFUSED') {
        hint = `Nothing is listening at ${target}. Start Ollama (ollama serve) or your llama.cpp server, then try again.`
      } else if (err.code === 'ENOTFOUND') {
        hint = `Could not resolve host: ${u.hostname}`
      } else if (err.code === 'ETIMEDOUT') {
        hint = `Connection to ${target} timed out.`
      }
      reject(new Error(hint))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Request to ${u.hostname}:${port} timed out.`))
    })

    req.write(options.body, 'utf8')
    req.end()
  })
}

export async function httpPostJson<T>(
  url: string,
  jsonBody: unknown,
  timeoutMs?: number
): Promise<{ statusCode: number; json: T; raw: string }> {
  const body = JSON.stringify(jsonBody)
  const { statusCode, body: raw } = await httpRequestRaw({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
    timeoutMs
  })
  let json: T
  try {
    json = JSON.parse(raw) as T
  } catch {
    throw new Error(`Invalid JSON from ${url} (${statusCode}): ${raw.slice(0, 200)}`)
  }
  return { statusCode, json, raw }
}
