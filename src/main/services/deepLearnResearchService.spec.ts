import { describe, expect, it } from 'vitest'
import { parseDeepLearnExplorePaths } from './deepLearnResearchService'

describe('parseDeepLearnExplorePaths', () => {
  it('parses bold label bullets', () => {
    const raw = `<deep-learn-body>x</deep-learn-body>
<deep-learn-explore>
- **History** — important dates and figures
- **Tools** — what practitioners use today
</deep-learn-explore>`
    const p = parseDeepLearnExplorePaths(raw)
    expect(p).toHaveLength(2)
    expect(p[0].label).toBe('History')
    expect(p[0].prompt).toMatch(/dates/i)
    expect(p[1].label).toBe('Tools')
  })

  it('returns empty when tag missing', () => {
    expect(parseDeepLearnExplorePaths('no explore block')).toEqual([])
  })
})
