import { describe, expect, it } from 'vitest'
import { postProcessAssistantChatMarkdown } from './chatResponsePostProcess'

describe('postProcessAssistantChatMarkdown', () => {
  it('inserts blank line before headings', () => {
    const raw = 'Intro line\n## Next\nBody'
    const out = postProcessAssistantChatMarkdown(raw)
    expect(out).toContain('Intro line\n\n## Next')
  })

  it('preserves fenced code and does not inject outline inside it', () => {
    const raw = '```js\n## not a heading\nconst x = 1\n```\n\n## Real'
    const out = postProcessAssistantChatMarkdown(raw)
    expect(out).toContain('## not a heading')
    expect(out).toMatch(/## Real/)
  })

  it('adds outline when multiple section headings exist', () => {
    const raw = 'Hi\n\n## Alpha\nx\n\n## Beta\ny'
    const out = postProcessAssistantChatMarkdown(raw)
    expect(out).toContain('> **In this reply**')
    expect(out).toMatch(/1\.\s*Alpha/)
    expect(out).toMatch(/2\.\s*Beta/)
  })

  it('does not duplicate outline', () => {
    const raw = '> **In this reply**\n> 1. A\n\n## A\n## B\n## C'
    const out = postProcessAssistantChatMarkdown(raw)
    const count = (out.match(/> \*\*In this reply\*\*/g) ?? []).length
    expect(count).toBe(1)
  })

  it('collapses excessive blank lines outside code', () => {
    const raw = 'a\n\n\n\nb'
    const out = postProcessAssistantChatMarkdown(raw)
    expect(out).toBe('a\n\nb')
  })
})
