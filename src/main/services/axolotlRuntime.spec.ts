import { describe, expect, it } from 'vitest'
import { assertBundledAxolotlRuntimeAvailable, probeAxolotlModelSupport } from './axolotlRuntime'

describe('axolotlRuntime', () => {
  it('resolves bundled runtime from repository resources', () => {
    const runtime = assertBundledAxolotlRuntimeAvailable()
    expect(runtime.root.length).toBeGreaterThan(1)
  })

  it('reports supported for known family and extension', () => {
    const probe = probeAxolotlModelSupport('C:\\models\\Llama-3.2-3B-Instruct-Q4_K_M.gguf')
    expect(probe.supported).toBe(true)
    expect(probe.backend).toBe('axolotl')
  })

  it('reports unsupported for unknown family', () => {
    const probe = probeAxolotlModelSupport('C:\\models\\my-custom-arch.gguf')
    expect(probe.supported).toBe(false)
    expect(probe.reason.toLowerCase()).toContain('unsupported')
  })
})
