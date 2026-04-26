import { logLine } from '../../logger'
import type { DmsConnectionSecret } from './dmsTypes'

type RefreshParams = {
  secret: DmsConnectionSecret
  onSecretRefresh?: (next: DmsConnectionSecret) => void
}

function shouldRefresh(secret: DmsConnectionSecret): boolean {
  if (!secret.expiresAt) return false
  return Date.now() >= secret.expiresAt - 60_000
}

export async function maybeRefreshOAuthToken(params: RefreshParams): Promise<DmsConnectionSecret> {
  const { secret, onSecretRefresh } = params
  if (!shouldRefresh(secret)) return secret
  if (!secret.refreshToken || !secret.authConfig?.clientId || !secret.tokenUrl) return secret
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: secret.refreshToken,
    client_id: secret.authConfig.clientId
  })
  if (secret.authConfig.clientSecret) {
    body.set('client_secret', secret.authConfig.clientSecret)
  }
  const res = await fetch(secret.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status})`)
  }
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    token_type?: string
  }
  const access = json.access_token?.trim()
  if (!access) throw new Error('Token refresh response did not include access_token.')
  const next: DmsConnectionSecret = {
    ...secret,
    accessToken: access,
    refreshToken: json.refresh_token?.trim() || secret.refreshToken,
    scope: json.scope ?? secret.scope,
    tokenType: json.token_type ?? secret.tokenType,
    expiresAt:
      typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
        ? Date.now() + json.expires_in * 1000
        : secret.expiresAt
  }
  onSecretRefresh?.(next)
  return next
}

export async function authedJsonRequest<T>(
  url: string,
  secret: DmsConnectionSecret,
  opts?: {
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
    onSecretRefresh?: (next: DmsConnectionSecret) => void
  }
): Promise<{ json: T; secret: DmsConnectionSecret }> {
  const nextSecret = await maybeRefreshOAuthToken({ secret, onSecretRefresh: opts?.onSecretRefresh })
  const res = await fetch(url, {
    method: opts?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${nextSecret.accessToken}`,
      Accept: 'application/json',
      ...(opts?.headers ?? {})
    },
    body: opts?.body
  })
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 400)
    logLine('warn', 'dms_request_failed', { url, status: res.status, body: msg })
    throw new Error(`DMS request failed (${res.status})`)
  }
  return { json: (await res.json()) as T, secret: nextSecret }
}

export async function authedBinaryRequest(
  url: string,
  secret: DmsConnectionSecret,
  opts?: { onSecretRefresh?: (next: DmsConnectionSecret) => void }
): Promise<{ bytes: Uint8Array; secret: DmsConnectionSecret }> {
  const nextSecret = await maybeRefreshOAuthToken({ secret, onSecretRefresh: opts?.onSecretRefresh })
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${nextSecret.accessToken}` }
  })
  if (!res.ok) {
    throw new Error(`DMS download failed (${res.status})`)
  }
  const buf = await res.arrayBuffer()
  return { bytes: new Uint8Array(buf), secret: nextSecret }
}
