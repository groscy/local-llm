import { useId, useMemo } from 'react'
import type { MetricsSnapshot } from '@shared/types'

const W = 560
const H = 76
const PAD = { t: 6, r: 8, b: 18, l: 44 }

type Point = { x: number; y: number; raw: number }

function scaleSeries(
  values: (number | undefined)[],
  tsList: number[],
  yMinPad = 0.05
): { points: Point[]; yMin: number; yMax: number } | null {
  const pairs: { t: number; v: number }[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === undefined || Number.isNaN(v)) continue
    pairs.push({ t: tsList[i]!, v })
  }
  if (pairs.length === 0) return null
  if (pairs.length === 1) {
    const p = pairs[0]!
    pairs.push({ t: p.t + 60_000, v: p.v })
  }

  const t0 = pairs[0]!.t
  const t1 = pairs[pairs.length - 1]!.t
  const spanT = Math.max(1, t1 - t0)
  const vmin = Math.min(...pairs.map((p) => p.v))
  const vmax = Math.max(...pairs.map((p) => p.v))
  const pad = Math.max((vmax - vmin) * yMinPad, vmax * 0.02, 1e-6)
  const yMin = vmin - pad
  const yMax = vmax + pad
  const spanY = Math.max(1e-6, yMax - yMin)

  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  const points: Point[] = pairs.map((p) => ({
    x: PAD.l + ((p.t - t0) / spanT) * innerW,
    y: PAD.t + (1 - (p.v - yMin) / spanY) * innerH,
    raw: p.v
  }))

  return { points, yMin, yMax }
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
}

function MiniChart({ title, unit, color, values, ts, formatTick }: MiniChartProps): React.ReactElement {
  const gradId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const scaled = useMemo(() => scaleSeries(values, ts), [values, ts])
  const baseY = H - PAD.b

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
      <svg className="metric-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
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
        {scaled && (
          <>
            <path d={areaPath(scaled.points, baseY)} fill={`url(#${gradId})`} />
            <path d={pathFromPoints(scaled.points)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <circle cx={scaled.points[scaled.points.length - 1]!.x} cy={scaled.points[scaled.points.length - 1]!.y} r={3.5} fill={color} />
          </>
        )}
      </svg>
      {scaled && ts.length >= 2 && (
        <div className="metric-chart-foot">
          <span>{new Date(ts[0]!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
          <span>{new Date(ts[ts.length - 1]!).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
    </div>
  )
}

export function MetricsTimeSeries({ history }: { history: MetricsSnapshot[] }): React.ReactElement {
  const chron = useMemo(() => [...history].reverse(), [history])
  const ts = useMemo(() => chron.map((h) => h.ts), [chron])
  const rss = useMemo(() => chron.map((h) => h.processRssMb), [chron])
  const cpu = useMemo(() => chron.map((h) => h.processCpuPercent), [chron])
  const tok = useMemo(() => chron.map((h) => h.runtimeTokensPerSec), [chron])
  const ctx = useMemo(() => chron.map((h) => h.runtimeCtxUsed), [chron])
  const gpuUsed = useMemo(() => chron.map((h) => h.gpuMemUsedMb), [chron])
  const modelMem = useMemo(() => chron.map((h) => h.modelMemoryMb), [chron])

  const hasTok = tok.some((v) => v !== undefined && v !== null)
  const hasCtx = ctx.some((v) => v !== undefined && v !== null)
  const hasGpu = gpuUsed.some((v) => v != null && !Number.isNaN(v) && v > 0)
  const hasModelMem = modelMem.some((v) => v != null && !Number.isNaN(v) && v > 0)
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

  if (chron.length === 0) {
    return <p className="muted">No history yet. Open Stats again after using the app to collect samples.</p>
  }

  return (
    <div className="metric-charts">
      <p className="muted metric-charts-hint">{chron.length} sample(s), oldest → newest (left to right).</p>
      <p className="muted metric-charts-hint metric-charts-hint--sub">
        GPU charts appear when <code className="inline-code">nvidia-smi</code> is available. Model memory is the llama-server process RSS
        (llama.cpp) or loaded model size from Ollama&apos;s <code className="inline-code">/api/ps</code> when the runtime is running.
      </p>
      <MiniChart
        title="Process memory (RSS)"
        unit="MB"
        color="#7c6cf0"
        values={rss}
        ts={ts}
        formatTick={(v) => v.toFixed(0)}
      />
      <MiniChart
        title="Process CPU (approx.)"
        unit="%"
        color="#3db89d"
        values={cpu}
        ts={ts}
        formatTick={(v) => v.toFixed(0)}
      />
      {hasGpu && (
        <MiniChart
          title="GPU memory used (NVIDIA)"
          unit="MiB"
          color="#5a8dee"
          values={gpuUsed}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
        />
      )}
      {hasGpuUtil && (
        <MiniChart
          title="GPU memory utilization"
          unit="%"
          color="#8b7ae8"
          values={gpuUtilPct}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
        />
      )}
      {hasModelMem && (
        <MiniChart
          title="Model memory (runtime)"
          unit="MiB"
          color="#e878b8"
          values={modelMem}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
        />
      )}
      {hasTok && (
        <MiniChart
          title="Runtime tokens / sec"
          unit="tok/s"
          color="#e8a54b"
          values={tok}
          ts={ts}
          formatTick={(v) => v.toFixed(1)}
        />
      )}
      {hasCtx && !hasTok && (
        <MiniChart
          title="Context used (runtime)"
          unit="tokens"
          color="#e8a54b"
          values={ctx}
          ts={ts}
          formatTick={(v) => v.toFixed(0)}
        />
      )}
    </div>
  )
}
