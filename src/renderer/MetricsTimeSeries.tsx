import { useId, useMemo, type ReactElement } from 'react'
import type { MetricsSnapshot } from '@shared/types'

export type MetricsTimeSeriesVariant = 'drawer' | 'pinned'

type ChartLayout = { W: number; H: number; PAD: { t: number; r: number; b: number; l: number } }

const LAYOUT_DRAWER: ChartLayout = { W: 560, H: 76, PAD: { t: 6, r: 8, b: 20, l: 44 } }
const LAYOUT_PINNED: ChartLayout = { W: 300, H: 58, PAD: { t: 2, r: 4, b: 16, l: 28 } }

const QUARTER_MS = 15 * 60 * 1000

/** Wall-clock times on 15-minute boundaries inside [t0, t1]. */
function quarterHourTicks(t0: number, t1: number): number[] {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return []
  const ticks: number[] = []
  let t = Math.ceil(t0 / QUARTER_MS) * QUARTER_MS
  while (t <= t1) {
    if (t >= t0) ticks.push(t)
    t += QUARTER_MS
  }
  return ticks
}

function subsampleEvenlySorted(ticks: number[], max: number): number[] {
  if (ticks.length <= max) return ticks
  const n = ticks.length
  const picked = new Set<number>()
  for (let k = 0; k < max; k++) {
    const idx = Math.round((k * (n - 1)) / Math.max(1, max - 1))
    picked.add(ticks[idx]!)
  }
  return [...picked].sort((a, b) => a - b)
}

function formatQuarterLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

type Point = { x: number; y: number; raw: number }

function yExtent(vmin: number, vmax: number, yMinPad: number): { yMin: number; yMax: number; spanY: number } {
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) {
    return { yMin: 0, yMax: 1, spanY: 1 }
  }
  if (vmin === vmax) {
    const c = vmin
    const spread = Math.max(1e-3, Math.abs(c) * 0.08, 1)
    const yMin = c - spread
    const yMax = c + spread
    return { yMin, yMax, spanY: yMax - yMin }
  }
  const range = vmax - vmin
  const pad = Math.max(range * yMinPad, Math.max(Math.abs(vmax), Math.abs(vmin)) * 0.02, range * 0.02, 1e-6)
  const yMin = vmin - pad
  const yMax = vmax + pad
  const spanY = Math.max(1e-9, yMax - yMin)
  return { yMin, yMax, spanY }
}

function scaleSeries(
  values: (number | undefined)[],
  tsList: number[],
  layout: ChartLayout,
  yMinPad = 0.05,
  /** When set, X positions use this wall-clock span so every chart shares the same time axis. */
  timeDomain?: { t0: number; t1: number } | null
): { points: Point[]; yMin: number; yMax: number; tStart: number; tEnd: number } | null {
  const { W, H, PAD } = layout
  const pairs: { t: number; v: number }[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === undefined || v === null || Number.isNaN(v)) continue
    const t = tsList[i]
    if (t === undefined || !Number.isFinite(t)) continue
    pairs.push({ t, v: Number(v) })
  }
  if (pairs.length === 0) return null
  if (pairs.length === 1) {
    const p = pairs[0]!
    pairs.push({ t: p.t + 60_000, v: p.v })
  }

  const pairT0 = pairs[0]!.t
  const pairT1 = pairs[pairs.length - 1]!.t
  const t0 = timeDomain?.t0 ?? pairT0
  const t1 = timeDomain?.t1 ?? pairT1
  const spanT = Math.max(1, t1 - t0)
  const vmin = Math.min(...pairs.map((p) => p.v))
  const vmax = Math.max(...pairs.map((p) => p.v))
  const { yMin, yMax, spanY } = yExtent(vmin, vmax, yMinPad)

  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const points: Point[] = pairs.map((p) => ({
    x: PAD.l + ((p.t - t0) / spanT) * innerW,
    y: PAD.t + (1 - (p.v - yMin) / spanY) * innerH,
    raw: p.v
  }))

  return { points, yMin, yMax, tStart: t0, tEnd: t1 }
}

function sharedTimeDomain(tsList: number[]): { t0: number; t1: number } | null {
  const finite = tsList.filter((t) => t != null && Number.isFinite(t))
  if (finite.length === 0) return null
  const t0 = Math.min(...finite)
  const t1 = Math.max(...finite)
  return { t0, t1: Math.max(t0 + 1, t1) }
}

function pathFromPoints(points: Point[]): string {
  if (points.length < 2) return ''
  return (
    'M ' +
    points
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' L ')
  )
}

function areaPath(points: Point[], baseY: number): string {
  if (points.length < 2) return ''
  const first = points[0]!
  const last = points[points.length - 1]!
  return `${pathFromPoints(points)} L ${last.x.toFixed(1)},${baseY} L ${first.x.toFixed(1)},${baseY} Z`
}

interface MiniChartProps {
  title: string
  unit: string
  color: string
  values: (number | undefined)[]
  ts: number[]
  formatTick: (v: number) => string
  timeDomain: { t0: number; t1: number } | null
  layout: ChartLayout
  variant: MetricsTimeSeriesVariant
}

function MiniChart({
  title,
  unit,
  color,
  values,
  ts,
  formatTick,
  timeDomain,
  layout,
  variant
}: MiniChartProps): ReactElement {
  const { W, H, PAD } = layout
  const gradId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const scaled = useMemo(
    () => scaleSeries(values, ts, layout, 0.05, timeDomain),
    [values, ts, layout, timeDomain]
  )
  const baseY = H - PAD.b
  const compact = variant === 'pinned'
  const strokeW = compact ? 1.5 : 2
  const dotR = compact ? 2.75 : 3.5

  const { timeTickTs, spanT, domainT0, domainT1 } = useMemo(() => {
    if (!timeDomain) {
      return { timeTickTs: [] as number[], spanT: 1, domainT0: 0, domainT1: 0 }
    }
    const { t0, t1 } = timeDomain
    const span = Math.max(1, t1 - t0)
    const raw = quarterHourTicks(t0, t1)
    const maxTicks = compact ? 5 : 12
    const timeTickTs = subsampleEvenlySorted(raw, maxTicks)
    return { timeTickTs, spanT: span, domainT0: t0, domainT1: t1 }
  }, [timeDomain, compact])

  const innerW = W - PAD.l - PAD.r
  const xForTime = (tMs: number): number => PAD.l + ((tMs - domainT0) / spanT) * innerW

  return (
    <div className="metric-chart-row">
      <div className="metric-chart-head">
        <span className="metric-chart-title">{title}</span>
        {scaled && (
          <span className="metric-chart-range">
            {formatTick(scaled.yMin)} – {formatTick(scaled.yMax)} {unit}
          </span>
        )}
      </div>
      <svg
        className="metric-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD.l} y1={baseY} x2={W - PAD.r} y2={baseY} className="metric-chart-axis" />
        {!scaled && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="metric-chart-empty">
            Not enough samples yet
          </text>
        )}
        {scaled && timeDomain && timeTickTs.length > 0 && (
          <g className="metric-chart-time-axis" aria-hidden>
            {timeTickTs.map((tMs) => {
              const x = xForTime(tMs)
              if (x < PAD.l - 0.5 || x > W - PAD.r + 0.5) return null
              return (
                <g key={tMs}>
                  <line
                    x1={x}
                    y1={PAD.t}
                    x2={x}
                    y2={baseY}
                    className="metric-chart-grid-line"
                  />
                  <line x1={x} y1={baseY} x2={x} y2={baseY + (compact ? 2.5 : 3)} className="metric-chart-tick-mark" />
                  <text
                    x={x}
                    y={baseY + (compact ? 10 : 12)}
                    textAnchor="middle"
                    className="metric-chart-tick-label"
                  >
                    {formatQuarterLabel(tMs)}
                  </text>
                </g>
              )
            })}
          </g>
        )}
        {scaled && (
          <>
            <path d={areaPath(scaled.points, baseY)} fill={`url(#${gradId})`} />
            <path d={pathFromPoints(scaled.points)} fill="none" stroke={color} strokeWidth={strokeW} />
            <circle
              cx={scaled.points[scaled.points.length - 1]!.x}
              cy={scaled.points[scaled.points.length - 1]!.y}
              r={dotR}
              fill={color}
            />
          </>
        )}
      </svg>
      {scaled && timeDomain && timeTickTs.length === 0 && (
        <div className="metric-chart-foot">
          <span>{new Date(timeDomain.t0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          <span>{new Date(timeDomain.t1).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
    </div>
  )
}

export function MetricsTimeSeries({
  history,
  variant = 'drawer'
}: {
  history: MetricsSnapshot[]
  variant?: MetricsTimeSeriesVariant
}): ReactElement {
  const layout = variant === 'pinned' ? LAYOUT_PINNED : LAYOUT_DRAWER
  const chron = useMemo(() => [...history].reverse(), [history])
  const ts = useMemo(() => chron.map((h) => h.ts), [chron])
  const rss = useMemo(() => chron.map((h) => h.processRssMb), [chron])
  const cpu = useMemo(() => chron.map((h) => h.processCpuPercent), [chron])
  const tok = useMemo(() => chron.map((h) => h.runtimeTokensPerSec), [chron])
  const ctx = useMemo(() => chron.map((h) => h.runtimeCtxUsed), [chron])
  const gpuUsed = useMemo(() => chron.map((h) => h.gpuMemUsedMb), [chron])
  const modelMem = useMemo(() => chron.map((h) => h.modelMemoryMb), [chron])

  const hasTok = tok.some((v) => v !== undefined && v !== null && !Number.isNaN(v))
  const hasCtx = ctx.some((v) => v !== undefined && v !== null && !Number.isNaN(v))
  const hasGpu = gpuUsed.some((v) => v != null && !Number.isNaN(v))
  const hasModelMem = modelMem.some((v) => v != null && !Number.isNaN(v))
  const gpuUtilPct = useMemo(
    () =>
      chron.map((h) =>
        h.gpuMemUsedMb != null &&
        h.gpuMemTotalMb != null &&
        h.gpuMemTotalMb > 0 &&
        !Number.isNaN(h.gpuMemUsedMb) &&
        !Number.isNaN(h.gpuMemTotalMb)
          ? (100 * h.gpuMemUsedMb) / h.gpuMemTotalMb
          : undefined
      ),
    [chron]
  )
  const hasGpuUtil = gpuUtilPct.some((v) => v != null && !Number.isNaN(v))

  const timeDomain = useMemo(() => sharedTimeDomain(ts), [ts])

  const chartsClass = variant === 'pinned' ? 'metric-charts metric-charts--pinned' : 'metric-charts'

  if (chron.length === 0) {
    return (
      <p className="muted">
        {variant === 'pinned'
          ? 'Waiting for samples… charts appear as the widget polls.'
          : 'No history yet. Open Stats again after using the app to collect samples.'}
      </p>
    )
  }

  return (
    <div className={chartsClass}>
      {variant === 'drawer' && (
        <>
          <p className="muted metric-charts-hint">{chron.length} sample(s), oldest → newest (left to right).</p>
          <p className="muted metric-charts-hint metric-charts-hint--sub">
            GPU charts appear when <code className="inline-code">nvidia-smi</code> is available. Model memory is the llama-server process RSS
            (llama.cpp) or loaded model size from Ollama&apos;s <code className="inline-code">/api/ps</code> when the runtime is running.
          </p>
        </>
      )}
      {variant === 'pinned' && (
        <p className="muted metric-charts-hint metric-charts-hint--pinned">
          {chron.length} sample(s) · same series as Full stats
        </p>
      )}
      <MiniChart
        title={variant === 'pinned' ? 'RSS' : 'Process memory (RSS)'}
        unit="MB"
        color="#7c6cf0"
        values={rss}
        ts={ts}
        formatTick={(v) => v.toFixed(0)}
        timeDomain={timeDomain}
        layout={layout}
        variant={variant}
      />
      <MiniChart
        title={variant === 'pinned' ? 'CPU' : 'Process CPU (approx.)'}
        unit="%"
        color="#3db89d"
        values={cpu}
        ts={ts}
        formatTick={(v) => v.toFixed(0)}
        timeDomain={timeDomain}
        layout={layout}
        variant={variant}
      />
      {hasGpu && (
        <MiniChart
          title={variant === 'pinned' ? 'GPU MiB' : 'GPU memory used (NVIDIA)'}
          unit="MiB"
          color="#5a8dee"
          values={gpuUsed}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
          timeDomain={timeDomain}
          layout={layout}
          variant={variant}
        />
      )}
      {hasGpuUtil && (
        <MiniChart
          title={variant === 'pinned' ? 'GPU %' : 'GPU memory utilization'}
          unit="%"
          color="#8b7ae8"
          values={gpuUtilPct}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
          timeDomain={timeDomain}
          layout={layout}
          variant={variant}
        />
      )}
      {hasModelMem && (
        <MiniChart
          title={variant === 'pinned' ? 'Model' : 'Model memory (runtime)'}
          unit="MiB"
          color="#e878b8"
          values={modelMem}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
          timeDomain={timeDomain}
          layout={layout}
          variant={variant}
        />
      )}
      {hasTok && (
        <MiniChart
          title={variant === 'pinned' ? 'Tok/s' : 'Runtime tokens / sec'}
          unit="tok/s"
          color="#e8a54b"
          values={tok}
          ts={ts}
          formatTick={(v) => v.toFixed(1)}
          timeDomain={timeDomain}
          layout={layout}
          variant={variant}
        />
      )}
      {hasCtx && (
        <MiniChart
          title={variant === 'pinned' ? 'Ctx' : 'Context used (runtime)'}
          unit="tokens"
          color="#c4a35a"
          values={ctx}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
          timeDomain={timeDomain}
          layout={layout}
          variant={variant}
        />
      )}
    </div>
  )
}
