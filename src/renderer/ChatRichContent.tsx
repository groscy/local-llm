import asciidoctorFactory from '@asciidoctor/core'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
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
import { enhanceRichRootMath, injectMarkdownMathSlots, type MathSlot } from './markdownMathKatex'
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
  if (/\b(?:stem|latexmath|asciimath):\[/m.test(head)) return true
  if (/^\[(?:stem|latexmath)\]/m.test(head)) return true
  return false
}

function toSafeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [
      'target',
      'rel',
      'data-katex-id',
      'data-katex-display',
      'loading',
      'decoding',
      'srcset',
      'sizes',
      'referrerpolicy',
      'media',
      'type'
    ],
    /** https / http / mailto / ftp / data (e.g. PNG base64) / blob (e.g. canvas) + relative-looking paths */
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|ftp|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  })
}

type RichRender = { html: string; mathSlots: MathSlot[] }

function renderRichString(content: string): RichRender {
  const trimmed = content.trim()
  if (!trimmed) return { html: '', mathSlots: [] }

  try {
    if (looksLikeHtmlFragment(content)) {
      return { html: toSafeHtml(content.trim()), mathSlots: [] }
    }
    if (looksLikeAsciiDoc(content)) {
      const adoc = getAsciidoctor()
      const headSnippet = content.slice(0, Math.min(content.length, 6000))
      const hasStemAttr = /^:stem:\s*\S/m.test(headSnippet)
      const out = adoc.convert(content, {
        safe: 'secure',
        ...(hasStemAttr ? {} : { attributes: { stem: 'latexmath' } })
      })
      if (typeof out !== 'string') {
        return { html: toSafeHtml(`<pre>${escapeHtml(content)}</pre>`), mathSlots: [] }
      }
      return { html: toSafeHtml(out), mathSlots: [] }
    }
    const { text, slots } = injectMarkdownMathSlots(content)
    const mdOut = marked.parse(text, { async: false })
    if (typeof mdOut !== 'string') {
      return { html: toSafeHtml(`<pre>${escapeHtml(content)}</pre>`), mathSlots: [] }
    }
    return { html: toSafeHtml(mdOut), mathSlots: slots }
  } catch {
    return {
      html: toSafeHtml(`<pre class="msg-rich-fallback">${escapeHtml(content)}</pre>`),
      mathSlots: []
    }
  }
}

function pickWikiKwEl(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest(`.${CHAT_WIKI_KW_CLASS}`) : null
}

function ChatWikiKeywordShell(props: {
  children: ReactNode
  onNavigate?: (sourceId: string) => void
}): ReactElement {
  const [tip, setTip] = useState<{
    left: number
    top: number
    snippet: string
    graphSummary?: string
  } | null>(null)

  const onOut = (e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    const rel = e.relatedTarget
    if (rel instanceof Node && e.currentTarget.contains(rel)) return
    setTip(null)
  }

  const readTipFromEl = (el: HTMLElement): void => {
    const sid = el.getAttribute('data-source-id')
    if (!sid) return
    const sn = el.getAttribute('data-snippet') ?? ''
    const gs = el.getAttribute('data-graph-summary')?.trim() || undefined
    const r = el.getBoundingClientRect()
    setTip({ left: r.left, top: r.bottom + 6, snippet: sn, graphSummary: gs })
  }

  return (
    <div
      className="msg-rich-wiki-shell"
      onMouseOver={(e) => {
        const el = pickWikiKwEl(e.target)
        if (!el || !e.currentTarget.contains(el)) return
        readTipFromEl(el)
      }}
      onMouseOut={onOut}
      onFocus={(e) => {
        const el = pickWikiKwEl(e.target)
        if (!el || !e.currentTarget.contains(el)) return
        readTipFromEl(el)
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
          {tip.snippet ? <div className="chat-wiki-kw-tooltip-kb">{tip.snippet}</div> : null}
          {tip.graphSummary ? (
            <div className="chat-wiki-kw-tooltip-kg">
              <div className="chat-wiki-kw-tooltip-kg-label">Knowledge graph</div>
              <div className="chat-wiki-kw-tooltip-kg-body">{tip.graphSummary}</div>
            </div>
          ) : null}
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

  const rich = useMemo(() => {
    if (plainStreaming) return null
    return renderRichString(content)
  }, [content, plainStreaming])

  const richRef = useRef<HTMLDivElement>(null)
  const wikiShell = Boolean(wikiHighlightTerms?.length)

  useLayoutEffect(() => {
    const el = richRef.current
    if (!el || plainStreaming) return
    el.innerHTML = rich?.html ?? ''
    enhanceRichRootMath(el, rich?.mathSlots ?? [])
    if (wikiHighlightTerms?.length) {
      applyWikiHighlightsToElement(el, wikiHighlightTerms)
    }
    onRichDomReady?.(el)
  }, [rich, plainStreaming, wikiHighlightTerms, onRichDomReady])

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
              className={
                p.term.graphSummary?.trim()
                  ? `${CHAT_WIKI_KW_CLASS} chat-wiki-kw--kg`
                  : CHAT_WIKI_KW_CLASS
              }
              role="link"
              tabIndex={0}
              data-source-id={p.term.sourceId}
              data-snippet={p.term.snippet.replace(/\s+/g, ' ').trim()}
              {...(p.term.graphSummary?.trim()
                ? { 'data-graph-summary': p.term.graphSummary.replace(/\s+/g, ' ').trim() }
                : {})}
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
