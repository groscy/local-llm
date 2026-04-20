import { describe, expect, it } from 'vitest'
import { stripWikiControlMarkers, WIKI_REFERENCE_SECTION_MARKDOWN } from './wikiArticleExtras'

describe('stripWikiControlMarkers', () => {
  it('removes legacy wiki slot inline code spans', () => {
    const raw = '## Usage\n\nNothing here `wiki:usage-empty`\n\nMore `wiki:gloss-missing` text.'
    expect(stripWikiControlMarkers(raw)).not.toMatch(/wiki:/)
    expect(stripWikiControlMarkers(raw)).toContain('## Usage')
  })

  it('removes relations-manual style markers', () => {
    const raw = 'Line\n\n`wiki:relations-manual`\n\nBody'
    expect(stripWikiControlMarkers(raw)).not.toMatch(/wiki:relations-manual/)
  })

  it('leaves ordinary code spans intact', () => {
    const raw = 'Use `npm test` to run tests.'
    expect(stripWikiControlMarkers(raw)).toBe(raw)
  })
})

describe('WIKI_REFERENCE_SECTION_MARKDOWN', () => {
  it('exposes stable H2 lines for prompts and compiler', () => {
    expect(WIKI_REFERENCE_SECTION_MARKDOWN.practice).toMatch(/^## /)
    expect(WIKI_REFERENCE_SECTION_MARKDOWN.related).toMatch(/^## /)
    expect(WIKI_REFERENCE_SECTION_MARKDOWN.notes).toMatch(/^## /)
  })
})
