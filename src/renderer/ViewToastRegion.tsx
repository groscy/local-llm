import type { ReactElement } from 'react'
import { dismissViewToast, runViewToastAction, useViewToastsForDisplay } from './viewToastBus'

function variantIcon(variant: string): string {
  if (variant === 'success') return 'fa-circle-check'
  if (variant === 'warning') return 'fa-triangle-exclamation'
  return 'fa-circle-info'
}

export function ViewToastRegion(): ReactElement {
  const items = useViewToastsForDisplay()

  return (
    <div className="view-toast-stack" aria-live="polite" aria-relevant="additions text">
      {items.map((t) => (
        <div key={t.id} className={`view-toast view-toast--${t.variant}`}>
          <div className="view-toast-main">
            <i className={`fa-solid ${variantIcon(t.variant)} view-toast-icon`} aria-hidden />
            <div className="view-toast-text">
              {t.title ? <div className="view-toast-title">{t.title}</div> : null}
              <div className="view-toast-message">{t.message}</div>
            </div>
          </div>
          <div className="view-toast-actions">
            {t.actionLabel ? (
              <button
                type="button"
                className="btn-secondary btn-ghost-sm view-toast-action"
                onClick={() => runViewToastAction(t.id)}
              >
                {t.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="view-toast-dismiss"
              aria-label="Dismiss notification"
              title="Dismiss"
              onClick={() => dismissViewToast(t.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
