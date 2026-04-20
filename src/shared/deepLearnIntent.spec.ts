/**
 * Manual QA (Ollama + llama.cpp): start runtime → send “learn everything about {topic}” → confirm dialog →
 * wait for wiki ingest → open Knowledge wiki + graph. With an https URL in the message, confirm the combined
 * dialog then verify fetch notes if the host is blocked or errors. Use Cancel during a run and expect a
 * cancelled error state without a new wiki page.
 */
import { describe, expect, it } from 'vitest'
import {
  deepLearnNeedsUrlApproval,
  extractHttpUrls,
  messageMatchesDeepLearnIntent,
  parseDeepLearnIntent
} from './deepLearnIntent'

describe('parseDeepLearnIntent', () => {
  it('matches learn everything about with typo', () => {
    const r = parseDeepLearnIntent('Please learn everythin about Rust ownership')
    expect(r.isDeepLearn).toBe(true)
    expect(r.subject.toLowerCase()).toContain('rust')
    expect(r.candidateUrls).toEqual([])
  })

  it('extracts subject and strips URLs from subject', () => {
    const r = parseDeepLearnIntent(
      'Learn everything about dolphins https://example.org/a and more https://example.org/b'
    )
    expect(r.isDeepLearn).toBe(true)
    expect(r.subject.toLowerCase()).toContain('dolphin')
    expect(r.candidateUrls).toEqual(['https://example.org/a', 'https://example.org/b'])
  })

  it('handles quoted subject', () => {
    const r = parseDeepLearnIntent('learn everything about "quantum tunneling"')
    expect(r.isDeepLearn).toBe(true)
    expect(r.subject.toLowerCase()).toContain('quantum')
  })

  it('returns not deep learn for unrelated text', () => {
    const r = parseDeepLearnIntent('Tell me about Rust')
    expect(r.isDeepLearn).toBe(false)
  })
})

describe('messageMatchesDeepLearnIntent', () => {
  it('is true when trigger appears mid-sentence', () => {
    expect(messageMatchesDeepLearnIntent('I want to learn everything about chess')).toBe(true)
  })
})

describe('extractHttpUrls', () => {
  it('dedupes identical URLs', () => {
    expect(extractHttpUrls('see https://a.com/x and https://a.com/x')).toEqual(['https://a.com/x'])
  })
})

describe('deepLearnNeedsUrlApproval', () => {
  it('is true when urls present', () => {
    expect(deepLearnNeedsUrlApproval(['https://a.com'])).toBe(true)
    expect(deepLearnNeedsUrlApproval([])).toBe(false)
  })
})
