import { useMemo, type ReactElement } from 'react'

export type ActivityTokenHistoryPoint = {
  ts: number
  promptCum: number
  completionCum: number
}

const W = 300
const H = 92
const PAD = { t: 10, r: 6, b: 20, l: 40 }

function fmtTok(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return String(Math.round(n))
}

function pathForSeries(
  ts: number[],
  vals: number[],
  t0: number,
  t1: number,
  yMin: number,
  yMax: number,
  innerW: number,
  innerH: number,
  padL: number,
  padT: number
): string {
  const spanT = Math.max(1, t1 - t0)
  const spanY = Math.max(1e-9, yMax - yMin)
  const pts: string[] = []
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!
    const v = vals[i]!
    const x = padL + ((t - t0) / spanT) * innerW
    const y = padT + (1 - (v - yMin) / spanY) * innerH
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  if (pts.length < 2) return ''
  return 'M ' + pts.join(' L ')
}

export function ActivityTokenSessionChart(props: { history: ActivityTokenHistoryPoint[] }): ReactElement {
  const { history } = props

  const { chron, t0, t1, promptPath, completionPath, yMin, yMax, lastP, lastC } = useMemo(() => {
    const chron = [...history].sort((a, b) => a.ts - b.ts)
    if (chron.length === 0) {
      return {
        chron: [] as ActivityTokenHistoryPoint[],
        t0: 0,
        t1: 0,
        promptPath: '',
        completionPath: '',
        yMin: 0,
        yMax: 1,
        lastP: 0,
        lastC: 0
      }
    }
    let ts = chron.map((p) => p.ts)
    let pCum = chron.map((p) => p.promptCum)
    let cCum = chron.map((p) => p.completionCum)
    if (ts.length === 1) {
      ts = [ts[0]!, ts[0]! + 60_000]
      pCum = [...pCum, pCum[0]!]
      cCum = [...cCum, cCum[0]!]
    }
    const t0 = Math.min(...ts)
    const t1 = Math.max(t0 + 1, ...ts)
    const maxV = Math.max(1, ...pCum, ...cCum)
    const pad = Math.max(4, maxV * 0.06)
    const yMin = 0
    const yMax = maxV + pad
    const innerW = W - PAD.l - PAD.r
    const innerH = H - PAD.t - PAD.b
    return {
      chron,
      t0,
      t1,
      promptPath: pathForSeries(ts, pCum, t0, t1, yMin, yMax, innerW, innerH, PAD.l, PAD.t),
      completionPath: pathForSeries(ts, cCum, t0, t1, yMin, yMax, innerW, innerH, PAD.l, PAD.t),
      yMin,
      yMax,
      lastP: chron[chron.length - 1]!.promptCum,
      lastC: chron[chron.length - 1]!.completionCum
    }
  }, [history])

  if (chron.length === 0) {
    return (
      <p className="muted activity-token-chart-empty">
        Chart fills in after each assistant reply when the runtime reports token usage (Ollama / llama.cpp with usage in
        stream).
      </p>
    )
  }

  const baseY = H - PAD.b
  const innerW = W - PAD.l - PAD.r

  return (
    <div className="activity-token-session-chart">
      <p className="muted metric-charts-hint metric-charts-hint--pinned">
        {chron.length} update{chron.length === 1 ? '' : 's'} · cumulative tokens since this model was loaded
      </p>
      <svg className="activity-token-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
        <line x1={PAD.l} y1={baseY} x2={W - PAD.r} y2={baseY} className="metric-chart-axis" />
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" className="metric-chart-tick-label" fontSize="9">
          {fmtTok(yMax)}
        </text>
        <text x={PAD.l - 4} y={baseY - 2} textAnchor="end" className="metric-chart-tick-label" fontSize="9">
          {fmtTok(yMin)}
        </text>
        <text
          x={PAD.l}
          y={H - 4}
          className="metric-chart-tick-label"
          fontSize="9"
        >
          {new Date(t0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </text>
        <text
          x={PAD.l + innerW}
          y={H - 4}
          textAnchor="end"
          className="metric-chart-tick-label"
          fontSize="9"
        >
          {new Date(t1).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </text>
        {promptPath ? (
          <path d={promptPath} fill="none" stroke="#7c6cf0" strokeWidth={1.75} strokeLinejoin="round" />
        ) : null}
        {completionPath ? (
          <path d={completionPath} fill="none" stroke="#e8a54b" strokeWidth={1.75} strokeLinejoin="round" />
        ) : null}
      </svg>
      <div className="activity-token-chart-legend" role="list">
        <span className="activity-token-chart-legend-item">
          <span className="activity-token-chart-swatch activity-token-chart-swatch--sent" aria-hidden />
          Sent <strong>{fmtTok(lastP)}</strong>
        </span>
        <span className="activity-token-chart-legend-item">
          <span className="activity-token-chart-swatch activity-token-chart-swatch--recv" aria-hidden />
          Received <strong>{fmtTok(lastC)}</strong>
        </span>
      </div>
    </div>
  )
}
