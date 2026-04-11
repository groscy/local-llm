import { useMemo, type ReactElement } from 'react'

export type ActivityTokenHistoryPoint = {
  ts: number
  promptCum: number
  completionCum: number
}

const W = 300
const H = 108
const PAD = { t: 8, r: 8, b: 22, l: 34 }
const MAX_GROUPS = 20

function fmtTok(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return String(Math.round(n))
}

type IncPoint = { promptInc: number; completionInc: number; ts: number }

function incrementsFromChron(chron: ActivityTokenHistoryPoint[]): IncPoint[] {
  if (chron.length === 0) return []
  const out: IncPoint[] = []
  for (let i = 0; i < chron.length; i++) {
    const cur = chron[i]!
    if (i === 0) {
      out.push({
        promptInc: Math.max(0, cur.promptCum),
        completionInc: Math.max(0, cur.completionCum),
        ts: cur.ts
      })
    } else {
      const prev = chron[i - 1]!
      out.push({
        promptInc: Math.max(0, cur.promptCum - prev.promptCum),
        completionInc: Math.max(0, cur.completionCum - prev.completionCum),
        ts: cur.ts
      })
    }
  }
  return out
}

export function ActivityTokenSessionChart(props: { history: ActivityTokenHistoryPoint[] }): ReactElement {
  const { history } = props

  const { chron, slice, dropped, maxY, lastP, lastC, baselineY, chartH, innerW } = useMemo(() => {
    const chron = [...history].sort((a, b) => a.ts - b.ts)
    if (chron.length === 0) {
      return {
        chron,
        slice: [] as IncPoint[],
        dropped: 0,
        maxY: 1,
        lastP: 0,
        lastC: 0,
        baselineY: H - PAD.b,
        chartH: H - PAD.t - PAD.b,
        innerW: W - PAD.l - PAD.r
      }
    }
    const full = incrementsFromChron(chron)
    const dropped = Math.max(0, full.length - MAX_GROUPS)
    const slice = dropped > 0 ? full.slice(-MAX_GROUPS) : full
    const maxY = Math.max(
      1,
      ...slice.flatMap((p) => [p.promptInc, p.completionInc])
    )
    const last = chron[chron.length - 1]!
    return {
      chron,
      slice,
      dropped,
      maxY,
      lastP: last.promptCum,
      lastC: last.completionCum,
      baselineY: H - PAD.b,
      chartH: H - PAD.t - PAD.b,
      innerW: W - PAD.l - PAD.r
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

  const n = slice.length
  const groupW = n > 0 ? innerW / n : innerW
  const padBetweenPairs = 2
  const innerPad = Math.min(4, groupW * 0.08)

  return (
    <div className="activity-token-session-chart activity-token-session-chart--bars">
      <p className="muted metric-charts-hint metric-charts-hint--pinned">
        {chron.length} update{chron.length === 1 ? '' : 's'}
        {dropped > 0 ? ` · showing last ${slice.length}` : ''} · tokens per reply (sent / received)
      </p>
      <svg
        className="activity-token-chart-svg activity-token-chart-svg--bars"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Token activity: ${slice.length} bar groups. Totals sent ${fmtTok(lastP)}, received ${fmtTok(lastC)}.`}
      >
        <line
          x1={PAD.l}
          y1={baselineY}
          x2={W - PAD.r}
          y2={baselineY}
          className="metric-chart-axis"
        />
        <text x={PAD.l - 4} y={PAD.t + 10} textAnchor="end" className="metric-chart-tick-label" fontSize="9">
          {fmtTok(maxY)}
        </text>
        <text x={PAD.l - 4} y={baselineY - 2} textAnchor="end" className="metric-chart-tick-label" fontSize="9">
          0
        </text>
        {slice.map((p, i) => {
          const x0 = PAD.l + i * groupW + innerPad
          const usableW = Math.max(2, groupW - 2 * innerPad)
          const barW = Math.max(1, (usableW - padBetweenPairs) / 2)
          const hP = maxY > 0 ? (p.promptInc / maxY) * chartH : 0
          const hC = maxY > 0 ? (p.completionInc / maxY) * chartH : 0
          const yP = baselineY - hP
          const yC = baselineY - hC
          const xSent = x0
          const xRecv = x0 + barW + padBetweenPairs
          const title = `${new Date(p.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}: sent +${fmtTok(p.promptInc)}, recv +${fmtTok(p.completionInc)}`
          return (
            <g key={`${p.ts}-${i}`}>
              <title>{title}</title>
              <rect
                x={xSent}
                y={yP}
                width={barW}
                height={Math.max(0, hP)}
                rx={1}
                ry={1}
                fill="var(--accent)"
                className="activity-token-bar activity-token-bar--sent"
              />
              <rect
                x={xRecv}
                y={yC}
                width={barW}
                height={Math.max(0, hC)}
                rx={1}
                ry={1}
                fill="var(--warning)"
                className="activity-token-bar activity-token-bar--recv"
              />
            </g>
          )
        })}
        {n <= 10 && n > 0
          ? slice.map((p, i) => {
              const cx = PAD.l + i * groupW + groupW / 2
              const t = new Date(p.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              return (
                <text
                  key={`lbl-${p.ts}-${i}`}
                  x={cx}
                  y={H - 5}
                  textAnchor="middle"
                  className="metric-chart-tick-label"
                  fontSize="7"
                >
                  {t}
                </text>
              )
            })
          : null}
      </svg>
      <div className="activity-token-chart-legend" role="list">
        <span className="activity-token-chart-legend-item">
          <span className="activity-token-chart-swatch activity-token-chart-swatch--sent" aria-hidden />
          Sent (total) <strong>{fmtTok(lastP)}</strong>
        </span>
        <span className="activity-token-chart-legend-item">
          <span className="activity-token-chart-swatch activity-token-chart-swatch--recv" aria-hidden />
          Received (total) <strong>{fmtTok(lastC)}</strong>
        </span>
      </div>
    </div>
  )
}
