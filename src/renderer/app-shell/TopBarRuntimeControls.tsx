import type { ReactElement } from 'react'
import type { RuntimeLoadProgress, RuntimeStatus } from '@shared/types'

type FileModelOption = {
  value: string
  label: string
  loadedOnly: boolean
}

export function TopBarRuntimeControls(props: {
  runtimeStarting: boolean
  runtimeOn: boolean
  modelPath: string
  topBarModelSelectValue: string
  ollamaChatTagsLoading: boolean
  ollamaChatTagsErr: string | null
  ollamaOptions: string[]
  fileOptions: FileModelOption[]
  runtimeStatus: RuntimeStatus | null
  runtimeLoadProgress: RuntimeLoadProgress | null
  runtimeStatusStale?: boolean
  onModelChange: (nextModel: string) => void
  onStart: () => void
  onStop: () => void
}): ReactElement {
  return (
    <div className="top-bar-runtime-wrap" aria-label="Model and runtime">
      <div className="top-bar-runtime-row">
        <select
          id="top-bar-runtime-model-select"
          className="select top-bar-runtime-model-select top-bar-runtime-model-select--unified"
          aria-label="Choose a local model (Ollama library or file on disk)"
          disabled={props.runtimeStarting || props.runtimeOn}
          value={props.topBarModelSelectValue}
          onChange={(e) => props.onModelChange(e.target.value)}
        >
          <option value="">
            {props.ollamaChatTagsLoading
              ? 'Loading models...'
              : props.ollamaChatTagsErr
                ? 'Could not list Ollama models'
                : props.ollamaOptions.length === 0 && props.fileOptions.length === 0
                  ? 'No models found - add weights or install Ollama'
                  : 'Choose a model...'}
          </option>
          {props.ollamaOptions.length > 0 ? (
            <optgroup label="Ollama library">
              {props.ollamaOptions.map((tag) => {
                const ollamaLoaded = props.runtimeStatus?.modelPath?.trim() ?? ''
                const loadedOnly = props.runtimeOn && ollamaLoaded !== '' && tag === ollamaLoaded && !props.ollamaOptions.includes(tag)
                return (
                  <option key={tag} value={tag} title={tag}>
                    {tag}
                    {loadedOnly ? ' - loaded' : ''}
                  </option>
                )
              })}
            </optgroup>
          ) : null}
          {props.fileOptions.length > 0 ? (
            <optgroup label="Files on this PC">
              {props.fileOptions.map((opt) => (
                <option key={opt.value} value={opt.value} title={opt.value}>
                  {opt.label}
                  {opt.loadedOnly ? ' - loaded' : ''}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <button
          type="button"
          className={`top-bar-runtime-playstop ${props.runtimeOn ? 'btn-secondary' : 'btn-primary'}`}
          disabled={!props.runtimeOn && (props.runtimeStarting || !props.modelPath.trim())}
          title={
            props.runtimeOn
              ? 'Stop - unload model from memory'
              : props.runtimeStarting
                ? 'Starting your model...'
                : !props.modelPath.trim()
                  ? 'Choose a model from the list first'
                  : 'Start - load model so you can chat'
          }
          aria-label={
            props.runtimeOn
              ? 'Stop and unload the model'
              : props.runtimeStarting
                ? 'Starting your model'
                : !props.modelPath.trim()
                  ? 'Start AI (choose a model first)'
                  : 'Start AI model'
          }
          onClick={() => (props.runtimeOn ? props.onStop() : props.onStart())}
        >
          <i className={`fa-solid ${props.runtimeOn ? 'fa-stop' : 'fa-play'}`} aria-hidden />
        </button>
      </div>
      {props.runtimeStatusStale && !props.runtimeStarting ? (
        <div className="top-bar-runtime-stale-indicator" role="status" aria-live="polite">
          <i className="fa-solid fa-circle-notch fa-spin" aria-hidden />
          <span>checking…</span>
        </div>
      ) : null}
      {props.runtimeStarting ? (
        <div className="top-bar-runtime-progress-wrap" role="status" aria-live="polite">
          {props.runtimeLoadProgress?.percent != null ? (
            <div className="top-bar-runtime-progress-track">
              <div
                className="top-bar-runtime-progress-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, props.runtimeLoadProgress.percent))}%`
                }}
              />
            </div>
          ) : null}
          <span className="top-bar-runtime-progress-msg">{props.runtimeLoadProgress?.message ?? 'Starting...'}</span>
        </div>
      ) : null}
    </div>
  )
}
