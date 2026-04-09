import type { ReactElement } from 'react'
import type { RuntimeLoadProgress } from '@shared/types'
import { ActivityTokenSessionChart, type ActivityTokenHistoryPoint } from './ActivityTokenSessionChart'

export type ActivityChatTokens = {
  prompt: number
  completion: number
  promptIsEstimate: boolean
  completionIsEstimate: boolean
}

export function ActivityPinnedWidget(props: {
  modelLoad: RuntimeLoadProgress | null
  chatSending: boolean
  chatTokens: ActivityChatTokens | null
  tokenHistory: ActivityTokenHistoryPoint[]
  runtimeOn: boolean
  onUnpin: () => void
  onOpenChat: () => void
}): ReactElement {
  const { modelLoad, chatSending, chatTokens, tokenHistory, runtimeOn, onUnpin, onOpenChat } = props
  const busy = modelLoad != null || chatSending
  const hasTokenHistory = tokenHistory.length > 0
  const showTokenPending = runtimeOn && !hasTokenHistory
  const showEmpty = !runtimeOn && !busy

  function formatCount(n: number, isEst: boolean): string {
    const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
    return isEst ? `~${v}` : String(v)
  }

  return (
    <aside className="activity-pinned-widget" aria-label="Generation activity">
      <div className="activity-pinned-widget-header">
        <span className="activity-pinned-widget-title">Activity</span>
        <span className="activity-pinned-widget-interval">{runtimeOn ? 'since load' : 'idle'}</span>
        <div className="activity-pinned-widget-actions">
          <button type="button" className="activity-pinned-widget-link" onClick={onOpenChat}>
            Open chat
          </button>
          <button type="button" className="activity-pinned-widget-unpin" onClick={onUnpin} title="Unpin widget">
            Unpin
          </button>
        </div>
      </div>
      {showEmpty ? (
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
          {chatSending && chatTokens ? (
            <div className="activity-pinned-block">
              <div className="activity-pinned-block-title">Reply</div>
              <dl className="activity-pinned-tokens">
                <div className="activity-pinned-tokens-row">
                  <dt>Sent</dt>
                  <dd title="Prompt tokens (exact when the runtime reports them)">
                    {formatCount(chatTokens.prompt, chatTokens.promptIsEstimate)} tok
                  </dd>
                </div>
                <div className="activity-pinned-tokens-row">
                  <dt>Generated</dt>
                  <dd title="Completion tokens (estimated while streaming, then exact if reported)">
                    {formatCount(chatTokens.completion, chatTokens.completionIsEstimate)} tok
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
          {runtimeOn ? (
            <div className="activity-pinned-block activity-pinned-block--session">
              <div className="activity-pinned-block-title">Tokens this session</div>
              {hasTokenHistory ? (
                <div className="activity-pinned-token-chart-wrap">
                  <ActivityTokenSessionChart history={tokenHistory} />
                </div>
              ) : showTokenPending ? (
                <p className="muted activity-pinned-session-pending">
                  Historic sent/received totals appear after each reply when the runtime reports usage.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </aside>
  )
}
