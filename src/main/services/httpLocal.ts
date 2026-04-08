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
  body?: string
  timeoutMs?: number
}): Promise<{ statusCode: number; body: string }> {
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
        method: options.method ?? 'GET',
        headers: {
          ...options.headers,
          ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body, 'utf8') } : {})
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

    if (options.body) req.write(options.body, 'utf8')
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
