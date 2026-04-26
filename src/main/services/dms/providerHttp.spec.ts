import { afterEach, describe, expect, it, vi } from 'vitest'
import { maybeRefreshOAuthToken } from './providerHttp'

describe('maybeRefreshOAuthToken', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips refresh when token is still valid', async () => {
    const secret = {
      accessToken: 'token',
      expiresAt: Date.now() + 10 * 60 * 1000
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const out = await maybeRefreshOAuthToken({ secret })
    expect(out).toEqual(secret)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refreshes token close to expiry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    } as Response)

    const secret = {
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: Date.now() - 1000,
      tokenUrl: 'https://example.com/token',
      authConfig: {
        clientId: 'cid',
        clientSecret: 'secret',
        redirectUri: 'http://localhost/callback',
        scopes: ['scope-a']
      }
    }

    const out = await maybeRefreshOAuthToken({ secret })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(out.accessToken).toBe('new-token')
    expect(out.refreshToken).toBe('new-refresh')
    expect(typeof out.expiresAt).toBe('number')
  })
})
