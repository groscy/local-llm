import { describe, expect, it } from 'vitest'
import { heuristicCleanupMarkdown, runArticleCleanup } from './articleCleanupService'
import type { RuntimeAdapter } from './runtime/types'

describe('articleCleanupService', () => {
  it('applies deterministic heuristic cleanup', () => {
    const out = heuristicCleanupMarkdown('Line\tone  \n\n\n-Item a\n2)Entry b')
    expect(out.body).toContain('- Item a')
    expect(out.body).toContain('2. Entry b')
    expect(out.edits).toBeGreaterThan(0)
  })

  it('returns runtime-unavailable fallback when runtime is not running', async () => {
    const runtime: RuntimeAdapter = {
      kind: 'ollama',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: false, kind: 'ollama' } as any
      },
      async chat() {
        return ''
      }
    }
    const out = await runArticleCleanup({ title: 'A', body: '-Item', runtime })
    expect(out.mode).toBe('heuristic')
    expect(out.fallbackReason).toBe('runtime_unavailable')
  })

  it('falls back when model output is missing expected content', async () => {
    const runtime: RuntimeAdapter = {
      kind: 'ollama',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'ollama', modelPath: 'mock' } as any
      },
      async chat() {
        return '   '
      }
    }
    const out = await runArticleCleanup({ title: 'A', body: '-Item', runtime })
    expect(out.mode).toBe('heuristic')
    expect(out.fallbackReason).toBe('empty_model_output')
  })

  it('runs heuristic cleanup before sending draft to llm', async () => {
    let llmInput = ''
    const runtime: RuntimeAdapter = {
      kind: 'ollama',
      async start() {},
      async stop() {},
      getStatus() {
        return { running: true, kind: 'ollama', modelPath: 'mock' } as any
      },
      async chat(messages) {
        llmInput = String(messages[1]?.content ?? '')
        return '<clean_markdown>\n## Overview\nRefined article.\n</clean_markdown>'
      }
    }
    await runArticleCleanup({
      title: 'Doc',
      body: '## Overview\n-Item one\nLine\twith   spacing',
      runtime
    })
    expect(llmInput).toContain('- Item one')
    expect(llmInput).toContain('Line with spacing')
  })

  it('moves metadata fields to a metadata section at article end', async () => {
    const out = await runArticleCleanup({
      title: 'Doc',
      body: 'Author: Jane Doe\nDate: 2026-05-10\n\n## Overview\nMain body content.'
    })
    expect(out.body).toContain('## Overview')
    expect(out.body).toContain('## Metadata')
    expect(out.body).toMatch(/## Metadata[\s\S]*\*\*Author\*\*: Jane Doe/)
    expect(out.body).toMatch(/## Metadata[\s\S]*\*\*Date\*\*: 2026-05-10/)
  })

  it('removes out-of-place noise while keeping article content', async () => {
    const out = await runArticleCleanup({
      title: 'Doc',
      body:
        'Table of Contents\nPage 1 of 12\n\n## Overview\nThe architecture uses bounded contexts.\n\n------\n\nGenerated on 2026-05-10'
    })
    expect(out.body).toContain('## Overview')
    expect(out.body).toContain('bounded contexts')
    expect(out.body).not.toMatch(/Table of Contents/i)
    expect(out.body).not.toMatch(/Page 1 of 12/i)
    expect(out.body).not.toMatch(/Generated on/i)
  })
})
