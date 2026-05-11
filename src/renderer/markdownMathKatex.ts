import katex from 'katex'

export const KATEX_SLOT_CLASS = 'katex-slot'

export type MathSlot = { id: string; tex: string; display: boolean }

/** Split on ``` / ~~~ fenced regions; odd segments are code (verbatim). */
function splitByFencedCode(src: string): string[] {
  const parts: string[] = []
  const re = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    parts.push(src.slice(last, m.index))
    parts.push(m[0])
    last = m.index + m[0].length
  }
  parts.push(src.slice(last))
  return parts
}

const MATH_FENCE_RE = /^```(?:math|latex)\b[ \t]*\r?\n([\s\S]*?)```$/im

function textNodeOkForDelimiterMath(node: Text): boolean {
  if (!node.data?.trim()) return false
  let el: HTMLElement | null = node.parentElement
  while (el) {
    if (el.closest('.katex')) return false
    const tag = el.tagName
    if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
      return false
    }
    el = el.parentElement
  }
  return true
}

function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const n = walker.currentNode as Text
    if (textNodeOkForDelimiterMath(n)) out.push(n)
  }
  return out
}

function replaceRegexMathInTextNode(node: Text, re: RegExp, display: boolean): void {
  const s = node.data
  re.lastIndex = 0
  if (!re.test(s)) return
  re.lastIndex = 0
  const frag = document.createDocumentFragment()
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    frag.appendChild(document.createTextNode(s.slice(last, m.index)))
    const host = document.createElement(display ? 'div' : 'span')
    if (display) host.className = 'rich-math-display-host'
    try {
      katex.render(m[1].trim(), host, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: false
      })
    } catch {
      host.textContent = m[0]
    }
    frag.appendChild(host)
    last = m.index + m[0].length
  }
  frag.appendChild(document.createTextNode(s.slice(last)))
  node.parentNode?.replaceChild(frag, node)
}

/** AsciiDoc / stem:latexmath block output: `.stemblock .content` holds `\\[...\\]` text. */
export function renderAsciiDocStemBlocks(root: HTMLElement): void {
  root.querySelectorAll('.stemblock .content').forEach((el) => {
    const t = el.textContent?.trim() ?? ''
    if (!t) return
    let tex = t
    if (tex.startsWith('\\[') && tex.endsWith('\\]')) {
      tex = tex.slice(2, -2).trim()
    } else if (tex.startsWith('$$') && tex.endsWith('$$')) {
      tex = tex.slice(2, -2).trim()
    }
    const host = el as HTMLElement
    host.textContent = ''
    try {
      katex.render(tex, host, {
        displayMode: true,
        throwOnError: false,
        strict: 'ignore',
        trust: false
      })
    } catch {
      host.textContent = t
    }
  })
}

const RE_DISPLAY_BRACKET = /\\\[([\s\S]*?)\\\]/g
const RE_INLINE_PAREN = /\\\(([\s\S]*?)\\\)/g

/**
 * Render `\\[...\\]` and `\\(...\\)` still present as text (e.g. AsciiDoc stem inline, pasted HTML).
 * Runs after markdown slots and stem blocks.
 */
export function renderLatexDelimiterMathInRoot(root: HTMLElement): void {
  for (const node of collectTextNodes(root)) {
    if (!node.data.includes('\\[')) continue
    replaceRegexMathInTextNode(node, RE_DISPLAY_BRACKET, true)
  }
  for (const node of collectTextNodes(root)) {
    if (!node.data.includes('\\(')) continue
    replaceRegexMathInTextNode(node, RE_INLINE_PAREN, false)
  }
}

/**
 * Replace LaTeX delimiters with empty HTML slots (survive marked → DOMPurify).
 * Skips ``` / ~~~ fenced code except ```math / ```latex (converted to display math).
 *
 * - Display: `$$ ... $$`, `\\[ ... \\]`
 * - Inline: `\\( ... \\)`
 */
export function injectMarkdownMathSlots(src: string): { text: string; slots: MathSlot[] } {
  const slots: MathSlot[] = []
  let n = 0
  const nextId = (): string => `ks${++n}`

  const injectInPlain = (chunk: string): string => {
    let s = chunk

    s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, body: string) => {
      const id = nextId()
      slots.push({ id, tex: body.trim(), display: true })
      return `\n\n<div class="${KATEX_SLOT_CLASS}" data-katex-id="${id}" data-katex-display="true"></div>\n\n`
    })

    s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => {
      const id = nextId()
      slots.push({ id, tex: body.trim(), display: true })
      return `\n\n<div class="${KATEX_SLOT_CLASS}" data-katex-id="${id}" data-katex-display="true"></div>\n\n`
    })

    s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => {
      const id = nextId()
      slots.push({ id, tex: body.trim(), display: false })
      return `<span class="${KATEX_SLOT_CLASS} ${KATEX_SLOT_CLASS}--inline" data-katex-id="${id}" data-katex-display="false"></span>`
    })

    s = s.replace(
      /(^|[^\\$])\$(?!\$)([^\n$]*?[^\s$])[^\n$]*?\$(?!\$)/g,
      (full: string, prefix: string) => {
        const math = full.slice(prefix.length + 1, -1).trim()
        if (!math) return full
        const id = nextId()
        slots.push({ id, tex: math, display: false })
        return `${prefix}<span class="${KATEX_SLOT_CLASS} ${KATEX_SLOT_CLASS}--inline" data-katex-id="${id}" data-katex-display="false"></span>`
      }
    )

    s = s.replace(/\\begin\{([a-z*]+)\}([\s\S]*?)\\end\{\1\}/g, (_, _env: string, body: string) => {
      const id = nextId()
      slots.push({ id, tex: body.trim(), display: true })
      return `\n\n<div class="${KATEX_SLOT_CLASS}" data-katex-id="${id}" data-katex-display="true"></div>\n\n`
    })

    return s
  }

  const processFenceSegment = (block: string): string => {
    const t = block.trimEnd()
    const mm = MATH_FENCE_RE.exec(t)
    if (!mm) return block
    const id = nextId()
    slots.push({ id, tex: mm[1].trim(), display: true })
    return `\n\n<div class="${KATEX_SLOT_CLASS}" data-katex-id="${id}" data-katex-display="true"></div>\n\n`
  }

  const parts = splitByFencedCode(src)
  const text = parts.map((p, i) => (i % 2 === 1 ? processFenceSegment(p) : injectInPlain(p))).join('')
  return { text, slots }
}

/** After sanitized HTML is in `root`, fill each markdown slot with KaTeX output. */
export function renderKatexIntoSlots(root: HTMLElement, slots: readonly MathSlot[]): void {
  if (slots.length === 0) return
  const byId = new Map(slots.map((s) => [s.id, s]))
  const nodes = root.querySelectorAll<HTMLElement>(`.${KATEX_SLOT_CLASS}[data-katex-id]`)
  nodes.forEach((el) => {
    const id = el.getAttribute('data-katex-id')
    const slot = id ? byId.get(id) : undefined
    if (!slot) return
    try {
      katex.render(slot.tex, el, {
        displayMode: slot.display,
        throwOnError: false,
        strict: 'ignore',
        trust: false
      })
    } catch {
      el.textContent = slot.tex
    }
  })
}

/** Markdown slots + AsciiDoc stem blocks + remaining LaTeX delimiters in HTML text. */
export function enhanceRichRootMath(root: HTMLElement, slots: readonly MathSlot[]): void {
  renderKatexIntoSlots(root, slots)
  renderAsciiDocStemBlocks(root)
  renderLatexDelimiterMathInRoot(root)
}
