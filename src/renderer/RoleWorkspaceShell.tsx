import type { ReactElement, ReactNode } from 'react'

export function RoleWorkspaceShell(props: React.ComponentProps<'div'>): ReactElement {
  const { className, ...rest } = props
  return <div {...rest} className={['role-workspace-shell', className ?? ''].filter(Boolean).join(' ')} />
}

export function ContextRail(props: React.ComponentProps<'aside'>): ReactElement {
  const { className, ...rest } = props
  return <aside {...rest} className={['context-rail', className ?? ''].filter(Boolean).join(' ')} />
}

export function PrimaryWork(props: React.ComponentProps<'div'>): ReactElement {
  const { className, ...rest } = props
  return <div {...rest} className={['primary-work', className ?? ''].filter(Boolean).join(' ')} />
}

export type ActionDockItem = {
  id: string
  label: string
  icon: string
  onClick: () => void
}

export function ActionDock(props: { items: readonly ActionDockItem[] }): ReactElement {
  return (
    <section className="workspace-action-dock" aria-label="Quick actions">
      {props.items.map((item) => (
        <button key={item.id} type="button" className="workspace-action-dock-btn" onClick={item.onClick}>
          <i className={`fa-solid ${item.icon}`} aria-hidden />
          {item.label}
        </button>
      ))}
    </section>
  )
}

export function UnifiedCommandSurfaceButton(props: {
  label: string
  title: string
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" className="btn-secondary workspace-next-action-btn" title={props.title} onClick={props.onClick}>
      <i className="fa-solid fa-bolt" aria-hidden />
      {props.label}
    </button>
  )
}
