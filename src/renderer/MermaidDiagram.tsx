import mermaid from 'mermaid'
import { useEffect, useId, useState, type ReactElement } from 'react'

function pickTheme(): 'default' | 'dark' {
  if (typeof window === 'undefined') return 'default'
  if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) return 'dark'
  return 'default'
}

export function MermaidDiagram(props: { source: string; className?: string }): ReactElement {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const theme = pickTheme()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: 'inherit'
    })
    const id = `archrepo_mer_${reactId}_${Math.random().toString(36).slice(2, 9)}`
    void mermaid
      .render(id, props.source)
      .then(({ svg: out }) => {
        if (!cancelled) {
          setErr(null)
          setSvg(out)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSvg(null)
          setErr(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [props.source, reactId])

  const wrapClass = ['mermaid-diagram', props.className].filter(Boolean).join(' ')

  if (err) {
    return (
      <div className={`${wrapClass} mermaid-diagram--error`}>
        <p className="muted" style={{ marginTop: 0 }}>
          Mermaid parse or layout error: {err}
        </p>
        <pre className="arch-repo-code-fence" style={{ marginBottom: 0 }}>
          {props.source}
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className={`${wrapClass} mermaid-diagram--loading muted`} aria-live="polite">
        Rendering diagram…
      </div>
    )
  }

  return <div className={wrapClass} dangerouslySetInnerHTML={{ __html: svg }} />
}
