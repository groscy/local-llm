import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'

function slugifyHeading(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'section'
}

export type WikiTocGroup = {
  id: string
  text: string
  subs: { id: string; text: string }[]
}

/**
 * Reads `h2`/`h3` from a rendered article root, assigns stable `id`s for deep links, and returns nested TOC data.
 */
export function buildWikiTocGroupsFromRoot(root: HTMLElement): WikiTocGroup[] {
  const headings = root.querySelectorAll<HTMLElement>('h2, h3')
  const used = new Set<string>()
  const nextId = (text: string): string => {
    let base = slugifyHeading(text)
    let id = base
    let n = 2
    while (used.has(id)) {
      id = `${base}_${n++}`
    }
    used.add(id)
    return id
  }

  const groups: WikiTocGroup[] = []

  headings.forEach((h) => {
    const text = h.textContent?.trim() ?? ''
    if (!text) return
    const currentId = h.getAttribute('id')?.trim() ?? ''
    const id =
      currentId && !used.has(currentId)
        ? (() => {
            used.add(currentId)
            return currentId
          })()
        : nextId(text)
    if (!currentId) h.id = id

    if (h.tagName === 'H2') {
      groups.push({ id, text, subs: [] })
    } else if (groups.length > 0) {
      groups[groups.length - 1].subs.push({ id, text })
    } else {
      groups.push({ id, text, subs: [] })
    }
  })

  return groups
}

/** Wikipedia-style floating table of contents. */
export function WikiArticleTocNav(props: { groups: WikiTocGroup[] }): ReactElement | null {
  const count = props.groups.reduce((n, g) => n + 1 + g.subs.length, 0)
  if (count < 2) return null

  const onClick = (e: ReactMouseEvent<HTMLElement>): void => {
    const link = e.target instanceof HTMLElement ? e.target.closest('a[href^="#"]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    const href = link.getAttribute('href')?.trim() ?? ''
    if (!href || href === '#') return
    const raw = href.slice(1).trim()
    if (!raw) return
    let hash = raw
    try {
      hash = decodeURIComponent(raw)
    } catch {
      hash = raw
    }
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(hash) : hash
    const target = document.querySelector<HTMLElement>(`#${escaped}`)
    if (!target) return
    e.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target.classList.add('wiki-passage-focus')
    window.setTimeout(() => target.classList.remove('wiki-passage-focus'), 1400)
    if (window.location.hash !== `#${hash}`) {
      try {
        window.history.replaceState(null, '', `#${encodeURIComponent(hash)}`)
      } catch {
        /* ignore history errors */
      }
    }
  }

  return (
    <nav className="wiki-toc" aria-label="Contents" onClick={onClick}>
      <div className="wiki-toc-title">Contents</div>
      <ol className="wiki-toc-list">
        {props.groups.map((g) => (
          <li key={g.id}>
            <a href={`#${g.id}`}>{g.text}</a>
            {g.subs.length > 0 ? (
              <ol className="wiki-toc-sublist">
                {g.subs.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.text}</a>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  )
}
