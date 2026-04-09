import type { ReactElement } from 'react'

export type OllamaChatBarProps = {
  baseUrl: string
  /** True after at least one `runtimeInstallPath` probe (avoids flashing “not reachable” on boot). */
  hostProbed: boolean
  reachable: boolean
  onOpenRun: () => void
  tags: string[]
  tagsLoading: boolean
  tagsError: string | null
  onRefreshTags: () => void
  modelTag: string
  onModelTagChange: (value: string) => void
  runtimeOn: boolean
  runtimeKind: 'llamacpp' | 'ollama' | 'none' | undefined
  loadedModelPath?: string
  starting: boolean
  onStart: () => void
}

/** Compact Ollama controls above the chat composer (pick tag, load into runtime). */
export function OllamaChatBar(props: OllamaChatBarProps): ReactElement {
  const {
    baseUrl,
    hostProbed,
    reachable,
    onOpenRun,
    tags,
    tagsLoading,
    tagsError,
    onRefreshTags,
    modelTag,
    onModelTagChange,
    runtimeOn,
    runtimeKind,
    loadedModelPath,
    starting,
    onStart
  } = props

  const selectValue = tags.includes(modelTag) ? modelTag : ''
  const loadBlockedByLlama = Boolean(runtimeOn && runtimeKind === 'llamacpp')
  const canStart = reachable && !starting && !loadBlockedByLlama
  const loadTitle = loadBlockedByLlama
    ? 'Unload llama.cpp in Run before loading an Ollama model'
    : !reachable
      ? 'Start Ollama and ensure it responds at the URL above'
      : undefined
  const trimmed = modelTag.trim()
  const loadDisabled = !trimmed || !canStart || (runtimeOn && runtimeKind === 'ollama')

  let statusLine: ReactElement | null = null
  if (runtimeOn && runtimeKind === 'llamacpp') {
    statusLine = (
      <p className="chat-ollama-bar-note">
        llama.cpp is running. Open <strong>Run</strong> to unload and use Ollama here.
      </p>
    )
  } else if (runtimeOn && runtimeKind === 'ollama') {
    statusLine = (
      <p className="chat-ollama-bar-note chat-ollama-bar-note--ok">
        Ollama ready
        {loadedModelPath ? (
          <>
            {' '}
            · <code className="inline-code">{loadedModelPath}</code>
          </>
        ) : null}
        . Unload in Run to switch models.
      </p>
    )
  } else if (hostProbed && !reachable) {
    statusLine = (
      <p className="chat-ollama-bar-note chat-ollama-bar-note--warn">
        No Ollama API at <code className="inline-code">{baseUrl}</code>. Start the Ollama app or{' '}
        <button type="button" className="btn-link-inline" onClick={onOpenRun}>
          open Run
        </button>{' '}
        to install or check settings.
      </p>
    )
  } else if (!hostProbed) {
    statusLine = <p className="chat-ollama-bar-note">Checking Ollama connection…</p>
  }

  const showControls = !runtimeOn || runtimeKind !== 'ollama'

  return (
    <div className="chat-ollama-bar" aria-label="Ollama quick start">
      <div className="chat-ollama-bar-head">
        <span className="chat-ollama-bar-title">Ollama</span>
        {hostProbed && reachable ? (
          <span className="chat-ollama-bar-url" title="Configured base URL">
            <code className="inline-code">{baseUrl}</code>
          </span>
        ) : null}
      </div>
      {statusLine}
      {showControls ? (
        <div className="chat-ollama-bar-row">
          <button
            type="button"
            className="btn-secondary btn-ghost-sm"
            onClick={onRefreshTags}
            disabled={tagsLoading}
            title="Refresh model list from Ollama"
          >
            {tagsLoading ? 'Listing…' : 'Refresh models'}
          </button>
          <label className="chat-ollama-bar-label">
            <span className="visually-hidden">Installed model</span>
            <select
              className="input chat-ollama-bar-select"
              value={selectValue}
              onChange={(e) => onModelTagChange(e.target.value)}
              disabled={tagsLoading || tags.length === 0}
              aria-label="Pick an installed Ollama model"
            >
              <option value="">{tags.length === 0 ? 'No models in list' : 'Custom tag…'}</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <input
            className="input chat-ollama-bar-input"
            placeholder="Model tag (e.g. llama3.2)"
            value={modelTag}
            onChange={(e) => onModelTagChange(e.target.value)}
            disabled={starting}
            aria-label="Ollama model tag"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={onStart}
            disabled={loadDisabled}
            title={loadTitle}
          >
            {starting ? 'Loading…' : 'Load model'}
          </button>
        </div>
      ) : null}
      {tagsError ? <p className="chat-ollama-bar-err">{tagsError}</p> : null}
    </div>
  )
}
