import type { ReactElement } from 'react'
import type { RuntimeLoadProgress } from '@shared/types'
import { FloatingDots } from './FloatingDots'

function clipPreview(s: string, max = 220): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

export function ActivityPinnedWidget(props: {
  modelLoad: RuntimeLoadProgress | null
  chatSending: boolean
  chatStreamPreview: string
  onUnpin: () => void
  onOpenChat: () => void
}): ReactElement {
  const { modelLoad, chatSending, chatStreamPreview, onUnpin, onOpenChat } = props
  const busy = modelLoad != null || chatSending

  return (
    <aside className="activity-pinned-widget" aria-label="Generation activity">
      <div className="activity-pinned-widget-header">
        <span className="activity-pinned-widget-title">Activity</span>
        <span className="activity-pinned-widget-interval">live</span>
        <div className="activity-pinned-widget-actions">
          <button type="button" className="activity-pinned-widget-link" onClick={onOpenChat}>
            Open chat
          </button>
          <button type="button" className="activity-pinned-widget-unpin" onClick={onUnpin} title="Unpin widget">
            Unpin
          </button>
        </div>
      </div>
      {!busy ? (
        <p className="activity-pinned-widget-empty">No model load or reply in progress.</p>
      ) : (
        <div className="activity-pinned-body">
          {modelLoad ? (
            <div className="activity-pinned-block">
              <div className="activity-pinned-block-title">Model load</div>
              {modelLoad.percent != null && (
                <div className="activity-pinned-progress">
                  <div
                    className="activity-pinned-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, modelLoad.percent))}%` }}
                  />
                </div>
              )}
              <p className="activity-pinned-message">{modelLoad.message}</p>
            </div>
          ) : null}
          {chatSending ? (
            <div className="activity-pinned-block">
              <div className="activity-pinned-block-title">
                Reply
                {!chatStreamPreview ? (
                  <>
                    {' '}
                    <FloatingDots label="Generating reply" />
                  </>
                ) : null}
              </div>
              {chatStreamPreview ? (
                <p className="activity-pinned-stream-preview">{clipPreview(chatStreamPreview)}</p>
              ) : (
                <p className="activity-pinned-message muted">Waiting for first token…</p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  )
}
