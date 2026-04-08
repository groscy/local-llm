import type { ReactElement } from 'react'

/** Animated ellipsis for “working” states (generation, load, etc.). */
export function FloatingDots(props: { label?: string }): ReactElement {
  const { label = 'In progress' } = props
  return (
    <span className="floating-dots" role="status" aria-label={label}>
      <span className="floating-dots-dot" />
      <span className="floating-dots-dot" />
      <span className="floating-dots-dot" />
    </span>
  )
}
