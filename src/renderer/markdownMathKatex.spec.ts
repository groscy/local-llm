import { describe, expect, it } from 'vitest'
import { injectMarkdownMathSlots } from './markdownMathKatex'

describe('injectMarkdownMathSlots', () => {
  it('captures single-dollar inline math conservatively', () => {
    const out = injectMarkdownMathSlots('Energy is $E=mc^2$ in this passage.')
    expect(out.slots.length).toBe(1)
    expect(out.slots[0]?.display).toBe(false)
    expect(out.slots[0]?.tex).toBe('E=mc^2')
  })

  it('captures LaTeX begin/end environments as display math', () => {
    const out = injectMarkdownMathSlots('\\begin{align}a+b=c\\end{align}')
    expect(out.slots.length).toBe(1)
    expect(out.slots[0]?.display).toBe(true)
    expect(out.slots[0]?.tex).toContain('a+b=c')
  })
})
