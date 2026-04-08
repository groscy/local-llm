import asciidoctorFactory from '@asciidoctor/core'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, type ReactElement } from 'react'

marked.use({
  gfm: true,
  breaks: false
})

let asciidoctorInstance: ReturnType<typeof asciidoctorFactory> | null = null
function getAsciidoctor(): ReturnType<typeof asciidoctorFactory> {
  if (!asciidoctorInstance) asciidoctorInstance = asciidoctorFactory()
  return asciidoctorInstance
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Trimmed body looks like an HTML fragment (not Markdown that happens to contain `<` later). */
function looksLikeHtmlFragment(s: string): boolean {
  const t = s.trimStart()
  if (!t.startsWith('<')) return false
  if (/^<!DOCTYPE\s+html/i.test(t)) return true
  if (/^<\?xml\s/i.test(t)) return true
  return /^<[a-zA-Z][\w:-]*(\s[\s\S]*?>|>|\/>)/.test(t)
}

/** Heuristic: AsciiDoc headings, blocks, or well-known macros — avoids Markdown false positives. */
function looksLikeAsciiDoc(s: string): boolean {
  const head = s.slice(0, Math.min(s.length, 12_000))
  if (/^={1,6}\s+\S/m.test(head)) return true
  if (/\[source[,\]]/m.test(head)) return true
  if (/^\.[A-Za-z][^\n]*\n/m.test(head)) return true
  if (/image::[^\s\[]+/m.test(head)) return true
  if (/include::[^\s\[]+/m.test(head)) return true
  if (/^:[-a-z0-9]+:\s+/im.test(head)) return true
  return false
}

function toSafeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|ftp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  })
}

function renderRichString(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  try {
    if (looksLikeHtmlFragment(content)) {
      return toSafeHtml(content.trim())
    }
    if (looksLikeAsciiDoc(content)) {
      const adoc = getAsciidoctor()
      const out = adoc.convert(content, { safe: 'secure' })
      if (typeof out !== 'string') return toSafeHtml(`<pre>${escapeHtml(content)}</pre>`)
      return toSafeHtml(out)
    }
    const mdOut = marked.parse(content, { async: false })
    if (typeof mdOut !== 'string') return toSafeHtml(`<pre>${escapeHtml(content)}</pre>`)
    return toSafeHtml(mdOut)
  } catch {
    return toSafeHtml(`<pre class="msg-rich-fallback">${escapeHtml(content)}</pre>`)
  }
}

export function ChatRichContent(props: {
  content: string
  /** Incomplete Markdown/HTML is shown as escaped plain text while streaming. */
  plainStreaming?: boolean
}): ReactElement {
  const { content, plainStreaming } = props

  const html = useMemo(() => {
    if (plainStreaming) return null
    return renderRichString(content)
  }, [content, plainStreaming])

  if (plainStreaming) {
    return (
      <div className="msg-rich msg-rich--plain-stream">
        <pre className="msg-rich-plain-pre">{content}</pre>
      </div>
    )
  }

  return <div className="msg-rich" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
}
