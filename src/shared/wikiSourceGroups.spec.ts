import { describe, expect, it } from 'vitest'
import { wikiNoteGroupKey, wikiSidebarRowsForKind } from './wikiSourceGroups'
import type { WikiTopic } from './types'

function topic(id: string, title: string, kind: WikiTopic['kind'] = 'extracted_note'): WikiTopic {
  return { id, title, chunkCount: 2, kind }
}

describe('wikiNoteGroupKey', () => {
  it('normalizes case and whitespace', () => {
    expect(wikiNoteGroupKey('  Foo  Bar  ')).toBe('foo bar')
    expect(wikiNoteGroupKey('FOO BAR')).toBe('foo bar')
  })
})

describe('wikiSidebarRowsForKind', () => {
  it('groups multiple extracted_note topics with the same keyword', () => {
    const topics = [topic('a', 'React hooks'), topic('b', 'react hooks'), topic('c', 'Vue')]
    const rows = wikiSidebarRowsForKind('extracted_note', topics)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ rowKind: 'group', label: 'React hooks' })
    if (rows[0].rowKind === 'group') expect(rows[0].topics).toHaveLength(2)
    expect(rows[1]).toMatchObject({ rowKind: 'topic', topic: { id: 'c', title: 'Vue' } })
  })

  it('leaves non-note kinds flat', () => {
    const topics = [topic('x', 'Same', 'document'), topic('y', 'Same', 'document')]
    const rows = wikiSidebarRowsForKind('document', topics)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.rowKind === 'topic')).toBe(true)
  })
})
