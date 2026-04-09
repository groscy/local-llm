import asciidoctorFactory from '@asciidoctor/core'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type MutableRefObject,
  type Ref
} from 'react'
import type { WikiChatHighlightTerm } from '@shared/types'
import {
  applyWikiHighlightsToElement,
  CHAT_WIKI_KW_CLASS,
  splitPlainTextWithWikiTerms
} from './wikiChatDomHighlight'

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

function pickWikiKwEl(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest(`.${CHAT_WIKI_KW_CLASS}`) : null
}

function ChatWikiKeywordShell(props: {
  children: ReactNode
  onNavigate?: (sourceId: string) => void
}): ReactElement {
  const [tip, setTip] = useState<{ left: number; top: number; snippet: string } | null>(null)

  const onOut = (e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    const rel = e.relatedTarget
    if (rel instanceof Node && e.currentTarget.contains(rel)) return
    setTip(null)
  }

  return (
    <div
      className="msg-rich-wiki-shell"
      onMouseOver={(e) => {
        const el = pickWikiKwEl(e.target)
        if (!el || !e.currentTarget.contains(el)) return
        const sid = el.getAttribute('data-source-id')
        if (!sid) return
        const sn = el.getAttribute('data-snippet') ?? ''
        const r = el.getBoundingClientRect()
        setTip({ left: r.left, top: r.bottom + 6, snippet: sn })
      }}
      onMouseOut={onOut}
      onFocus={(e) => {
        const el = pickWikiKwEl(e.target)
        if (!el || !e.currentTarget.contains(el)) return
        const sn = el.getAttribute('data-snippet') ?? ''
        const r = el.getBoundingClientRect()
        setTip({ left: r.left, top: r.bottom + 6, snippet: sn })
      }}
      onBlur={onOut}
      onClick={(e) => {
        const el = pickWikiKwEl(e.target)
        const sid = el?.getAttribute('data-source-id')
        if (sid && props.onNavigate) {
          e.preventDefault()
          props.onNavigate(sid)
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        const el = e.target instanceof HTMLElement ? e.target.closest(`.${CHAT_WIKI_KW_CLASS}`) : null
        const sid = el?.getAttribute('data-source-id')
        if (sid && props.onNavigate) {
          e.preventDefault()
          props.onNavigate(sid)
        }
      }}
    >
      {props.children}
      {tip ? (
        <div
          className="chat-wiki-kw-tooltip-portal"
          style={{ left: tip.left, top: tip.top }}
          role="tooltip"
        >
          {tip.snippet}
        </div>
      ) : null}
    </div>
  )
}

export function ChatRichContent(props: {
  content: string
  /** Incomplete Markdown/HTML is shown as escaped plain text while streaming. */
  plainStreaming?: boolean
  /** Merged with `msg-rich` on the root (e.g. wiki article body). */
  className?: string
  /** Optional ref to the rich HTML root (for wiki TOC / tooling). */
  richRootRef?: Ref<HTMLDivElement | null>
  /** Called after sanitized HTML (and optional wiki-keyword wraps) is applied to the rich root. */
  onRichDomReady?: (root: HTMLDivElement) => void
  /** When set, phrases that match the knowledge base are linked to wiki articles. */
  wikiHighlightTerms?: WikiChatHighlightTerm[]
  onWikiKeywordNavigate?: (sourceId: string) => void
}): ReactElement {
  const {
    content,
    plainStreaming,
    className,
    richRootRef,
    onRichDomReady,
    wikiHighlightTerms,
    onWikiKeywordNavigate
  } = props

  const html = useMemo(() => {
    if (plainStreaming) return null
    return renderRichString(content)
  }, [content, plainStreaming])

  const richRef = useRef<HTMLDivElement>(null)
  const wikiShell = Boolean(wikiHighlightTerms?.length)

  useLayoutEffect(() => {
    const el = richRef.current
    if (!el || plainStreaming) return
    el.innerHTML = html ?? ''
    if (wikiHighlightTerms?.length) {
      applyWikiHighlightsToElement(el, wikiHighlightTerms)
    }
    onRichDomReady?.(el)
  }, [html, plainStreaming, wikiHighlightTerms, onRichDomReady])

  const rootClass = ['msg-rich', className].filter(Boolean).join(' ')

  if (plainStreaming) {
    const preInner =
      wikiShell && wikiHighlightTerms?.length ? (
        splitPlainTextWithWikiTerms(content, wikiHighlightTerms).map((p, i) =>
          p.kind === 'text' ? (
            <Fragment key={`p-${i}`}>{p.value}</Fragment>
          ) : (
            <span
              key={`k-${i}`}
              className={CHAT_WIKI_KW_CLASS}
              role="link"
              tabIndex={0}
              data-source-id={p.term.sourceId}
              data-snippet={p.term.snippet.replace(/\s+/g, ' ').trim()}
            >
              {p.value}
            </span>
          )
        )
      ) : (
        content
      )

    const block = (
      <div className={`${rootClass} msg-rich--plain-stream`}>
        <pre className="msg-rich-plain-pre">{preInner}</pre>
      </div>
    )

    return wikiShell ? (
      <ChatWikiKeywordShell onNavigate={onWikiKeywordNavigate}>{block}</ChatWikiKeywordShell>
    ) : (
      block
    )
  }

  const setRichEl = (el: HTMLDivElement | null): void => {
    ;(richRef as MutableRefObject<HTMLDivElement | null>).current = el
    const r = richRootRef
    if (typeof r === 'function') r(el)
    else if (r && typeof r === 'object' && 'current' in r) {
      ;(r as MutableRefObject<HTMLDivElement | null>).current = el
    }
  }

  const richBlock = <div ref={setRichEl} className={rootClass} />

  return wikiShell ? (
    <ChatWikiKeywordShell onNavigate={onWikiKeywordNavigate}>{richBlock}</ChatWikiKeywordShell>
  ) : (
    richBlock
  )
}
