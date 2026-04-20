import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '0.0.0.0') return true
  if (h === '::1' || h === '[::1]') return true

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    const c = Number(v4[3])
    const d = Number(v4[4])
    if ([a, b, c, d].some((n) => n > 255)) return true
    if (a === 127) return true
    if (a === 10) return true
    if (a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    return false
  }
  return false
}

/**
 * Block obvious SSRF targets (loopback, private nets, link-local). Public hostnames are allowed.
 */
export function assertUrlAllowedForDeepLearnFetch(urlString: string): void {
  let u: URL
  try {
    u = new URL(urlString)
  } catch {
    throw new Error('Invalid URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs can be fetched')
  }
  if (isBlockedHostname(u.hostname)) {
    throw new Error('This host is not allowed for deep-learn fetch (private or loopback address)')
  }
}

function stripHtmlToText(html: string): string {
  let s = html.replace(/\r\n/g, '\n')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/&nbsp;/gi, ' ')
  s = s.replace(/&amp;/gi, '&')
  s = s.replace(/&lt;/gi, '<')
  s = s.replace(/&gt;/gi, '>')
  s = s.replace(/&quot;/gi, '"')
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n)
    return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : ''
  })
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

export type FetchApprovedUrlOptions = {
  maxBytes: number
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * GET a user-approved URL from the main process only. Clips body and strips basic HTML.
 */
export async function fetchApprovedUrl(urlString: string, opts: FetchApprovedUrlOptions): Promise<string> {
  assertUrlAllowedForDeepLearnFetch(urlString)
  const u = new URL(urlString)
  const maxBytes = Math.max(1024, Math.min(opts.maxBytes, 8 * 1024 * 1024))
  const timeoutMs = Math.max(3000, Math.min(opts.timeoutMs, 120_000))

  const chunks: Buffer[] = []
  let total = 0

  return await new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'LocalLLMDesktop-DeepLearn/1.0',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
        },
        timeout: timeoutMs
      },
      (res) => {
        const code = res.statusCode ?? 0
        if (code < 200 || code >= 300) {
          res.resume()
          reject(new Error(`HTTP ${code}`))
          return
        }
        const ctype = String(res.headers['content-type'] ?? '').toLowerCase()
        if (!ctype.includes('text/html') && !ctype.includes('text/plain') && !ctype.includes('application/xhtml')) {
          res.resume()
          reject(new Error(`Unsupported content-type: ${ctype || 'unknown'}`))
          return
        }
        res.on('data', (chunk: Buffer) => {
          if (opts.signal?.aborted) {
            res.destroy()
            return
          }
          total += chunk.length
          if (total > maxBytes + 64 * 1024) {
            res.destroy()
            reject(new Error('Response too large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const slice = buf.subarray(0, Math.min(buf.length, maxBytes))
          let text = slice.toString('utf8')
          if (ctype.includes('html')) {
            text = stripHtmlToText(text)
          } else {
            text = text.replace(/\r\n/g, '\n').trim()
          }
          resolve(text.slice(0, 80_000))
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    opts.signal?.addEventListener(
      'abort',
      () => {
        req.destroy()
        reject(new Error('Aborted'))
      },
      { once: true }
    )
    req.end()
  })
}
