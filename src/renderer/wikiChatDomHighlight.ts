import type { WikiChatHighlightTerm } from '@shared/types'

export const CHAT_WIKI_KW_CLASS = 'chat-wiki-kw'

type TextNodeMatch = { node: Text; start: number; end: number; term: WikiChatHighlightTerm }

export function sortWikiHighlightTerms(terms: readonly WikiChatHighlightTerm[]): WikiChatHighlightTerm[] {
  return [...terms].sort((a, b) => b.phrase.length - a.phrase.length)
}

function isWordChar(ch: string): boolean {
  if (!ch) return false
  return /[\p{L}\p{N}]/u.test(ch)
}

export function boundaryOkInString(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : ' '
  const after = end < text.length ? text[end] : ' '
  return !isWordChar(before) && !isWordChar(after)
}

function textNodeOkForHighlight(node: Text): boolean {
  if (!node.data || !/\S/.test(node.data)) return false
  let el: HTMLElement | null = node.parentElement
  while (el) {
    if (el.classList.contains(CHAT_WIKI_KW_CLASS)) return false
    const tag = el.tagName
    if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
      return false
    }
    if (tag === 'A') return false
    el = el.parentElement
  }
  return true
}

/**
 * Wrap KB phrases in rendered HTML (inside `root`). Skips code, pre, links, existing marks.
 * Mutates the DOM; run on a fresh `innerHTML` each time.
 */
export function applyWikiHighlightsToElement(root: HTMLElement, terms: readonly WikiChatHighlightTerm[]): void {
  const sorted = sortWikiHighlightTerms(terms)
  if (sorted.length === 0) return

  while (true) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let candidate: TextNodeMatch | null = null

    outer: while (walker.nextNode()) {
      const tn = walker.currentNode as Text
      if (!textNodeOkForHighlight(tn)) continue

      const text = tn.data
      const lower = text.toLowerCase()
      let earliestInNode: TextNodeMatch | null = null

      for (const term of sorted) {
        const ph = term.phrase
        if (!ph) continue
        const pl = ph.toLowerCase()
        let from = 0
        while (from < lower.length) {
          const idx = lower.indexOf(pl, from)
          if (idx < 0) break
          const end = idx + ph.length
          if (boundaryOkInString(lower, idx, end)) {
            if (
              !earliestInNode ||
              idx < earliestInNode.start ||
              (idx === earliestInNode.start && end > earliestInNode.end)
            ) {
              earliestInNode = { node: tn, start: idx, end, term }
            }
          }
          from = idx + 1
        }
      }

      if (earliestInNode) {
        candidate = earliestInNode
        break outer
      }
    }

    if (!candidate) break

    const { node, start, end, term } = candidate
    const text = node.data
    const before = text.slice(0, start)
    const mid = text.slice(start, end)
    const after = text.slice(end)

    const span = document.createElement('span')
    span.className = CHAT_WIKI_KW_CLASS
    span.setAttribute('role', 'link')
    span.setAttribute('tabindex', '0')
    span.dataset.sourceId = term.sourceId
    span.dataset.snippet = term.snippet.replace(/\s+/g, ' ').trim()
    span.textContent = mid

    const parent = node.parentNode
    if (!parent) break

    if (before) parent.insertBefore(document.createTextNode(before), node)
    parent.insertBefore(span, node)
    if (after) {
      node.data = after
    } else {
      parent.removeChild(node)
    }
  }
}

export type WikiPlainHighlightPiece =
  | { kind: 'text'; value: string }
  | { kind: 'kw'; value: string; term: WikiChatHighlightTerm }

export function splitPlainTextWithWikiTerms(
  text: string,
  terms: readonly WikiChatHighlightTerm[]
): WikiPlainHighlightPiece[] {
  const sorted = sortWikiHighlightTerms(terms)
  if (!sorted.length) return [{ kind: 'text', value: text }]
  if (!text) return [{ kind: 'text', value: '' }]

  const pieces: WikiPlainHighlightPiece[] = []

  const scan = (rest: string): void => {
    if (!rest) return
    const lower = rest.toLowerCase()
    let best: { idx: number; len: number; term: WikiChatHighlightTerm } | null = null

    for (const term of sorted) {
      const ph = term.phrase
      if (!ph) continue
      const pl = ph.toLowerCase()
      let from = 0
      while (from < lower.length) {
        const idx = lower.indexOf(pl, from)
        if (idx < 0) break
        const end = idx + ph.length
        if (boundaryOkInString(lower, idx, end)) {
          if (!best || idx < best.idx || (idx === best.idx && ph.length > best.len)) {
            best = { idx, len: ph.length, term }
          }
        }
        from = idx + 1
      }
    }

    if (!best) {
      pieces.push({ kind: 'text', value: rest })
      return
    }

    if (best.idx > 0) pieces.push({ kind: 'text', value: rest.slice(0, best.idx) })
    pieces.push({
      kind: 'kw',
      value: rest.slice(best.idx, best.idx + best.len),
      term: best.term
    })
    scan(rest.slice(best.idx + best.len))
  }

  scan(text)
  return pieces
}
