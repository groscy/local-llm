import { describe, expect, it } from 'vitest'
import { assertUrlAllowedForDeepLearnFetch } from './deepLearnFetch'

describe('assertUrlAllowedForDeepLearnFetch', () => {
  it('allows public https hostnames', () => {
    expect(() => assertUrlAllowedForDeepLearnFetch('https://example.com/doc')).not.toThrow()
  })

  it('rejects non-http(s)', () => {
    expect(() => assertUrlAllowedForDeepLearnFetch('file:///etc/passwd')).toThrow()
  })

  it('rejects localhost', () => {
    expect(() => assertUrlAllowedForDeepLearnFetch('http://localhost:8080/')).toThrow()
  })

  it('rejects private IPv4', () => {
    expect(() => assertUrlAllowedForDeepLearnFetch('http://192.168.1.1/')).toThrow()
    expect(() => assertUrlAllowedForDeepLearnFetch('http://10.0.0.1/')).toThrow()
    expect(() => assertUrlAllowedForDeepLearnFetch('http://172.20.0.1/')).toThrow()
  })
})
