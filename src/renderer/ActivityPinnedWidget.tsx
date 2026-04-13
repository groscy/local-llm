import type { ReactElement } from 'react'
import { useMemo } from 'react'
import type { PluginIntegrationReport, RuntimeLoadProgress } from '@shared/types'
import { ActivityTokenSessionChart, type ActivityTokenHistoryPoint } from './ActivityTokenSessionChart'

function formatPluginReportTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function pluginKindLabel(kind: PluginIntegrationReport['kind']): string {
  switch (kind) {
    case 'chat_completed':
      return 'IDE chat'
    case 'chat_failed':
      return 'IDE chat failed'
    case 'apply_completed':
      return 'IDE apply'
    case 'apply_failed':
      return 'IDE apply failed'
    case 'apply_cancelled':
      return 'IDE apply cancelled'
    case 'send_cancelled':
      return 'IDE send cancelled'
    default:
      return kind
  }
}

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
  /** Recent reports from IDE plugins (IntelliJ, etc.) via the localhost bridge. */
  pluginReports?: PluginIntegrationReport[]
  onUnpin: () => void
  onOpenChat: () => void
}): ReactElement {
  const { modelLoad, chatSending, chatTokens, tokenHistory, runtimeOn, pluginReports, onUnpin, onOpenChat } = props
  const busy = modelLoad != null || chatSending
  const hasTokenHistory = tokenHistory.length > 0
  const showTokenPending = runtimeOn && !hasTokenHistory
  const ideFeed = useMemo(() => {
    if (!pluginReports?.length) return []
    return [...pluginReports].sort((a, b) => b.receivedAt - a.receivedAt)
  }, [pluginReports])
  const showEmpty = !runtimeOn && !busy && ideFeed.length === 0

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
          {ideFeed.length > 0 ? (
            <div className="activity-pinned-block activity-pinned-block--ide">
              <div className="activity-pinned-block-title">IDE plugin</div>
              <ul className="activity-pinned-ide-feed" aria-label="IDE plugin activity">
                {ideFeed.map((r, i) => (
                  <li key={`${r.receivedAt}-${i}`} className="activity-pinned-ide-feed-item">
                    <span className="activity-pinned-ide-feed-time" title={new Date(r.receivedAt).toISOString()}>
                      {formatPluginReportTime(r.receivedAt)}
                    </span>
                    <span className="activity-pinned-ide-feed-kind">{pluginKindLabel(r.kind)}</span>
                    {r.message ? (
                      <span className="activity-pinned-ide-feed-msg" title={r.message}>
                        {r.message.length > 120 ? `${r.message.slice(0, 117)}…` : r.message}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
              {modelLoad.detail?.trim() ? (
                <pre className="activity-pinned-load-detail">{modelLoad.detail.trim()}</pre>
              ) : null}
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
