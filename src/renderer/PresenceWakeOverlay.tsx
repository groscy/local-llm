import type { ModelPersonalityVibe } from '@shared/modelPersonality'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'

/** Minimum time the wake stays visible (intensity curve spans this duration when not blocked by runtime start). */
const WAKE_DURATION_MS = 10_000
/** Full-opacity fade-out of the wake layer before the main UI is shown. */
const WAKE_OUTRO_MS = 520
const WAKE_OUTRO_REDUCED_MS = 280
const PARTICLE_COUNT = 56
const SPARK_COUNT = 28
const STARFIELD_COUNT = 140
const SETUP_LINE_INTERVAL_MS = 3400
const SETUP_DETAIL_MAX_CHARS = 96

function truncateSetupDetail(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= SETUP_DETAIL_MAX_CHARS) return t
  return `${t.slice(0, SETUP_DETAIL_MAX_CHARS - 1)}…`
}

function buildWakeSetupLines(input: {
  runtimeStarting: boolean
  runtimeKind: 'ollama' | 'llamacpp' | null
  resumeRuntime: boolean
  liveDetail: string | null
}): string[] {
  const live = input.liveDetail ? truncateSetupDetail(input.liveDetail) : null
  const out: string[] = []
  const add = (s: string): void => {
    const t = s.trim()
    if (!t) return
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return
    out.push(t)
  }

  if (live) add(live)
  add('Reading saved preferences and layout…')
  add('Preparing secure local storage…')
  if (input.resumeRuntime) add('Restoring your last running model selection…')

  if (input.runtimeStarting) {
    add('Starting the local inference backend…')
    if (input.runtimeKind === 'llamacpp') {
      add('Loading GGUF weights and prompt context…')
      add('Spawning llama-server and checking health…')
    } else if (input.runtimeKind === 'ollama') {
      add('Connecting to the Ollama daemon…')
      add('Warming the selected model…')
    } else {
      add('Initializing the model runtime…')
    }
    add('Verifying the engine is ready to chat…')
  } else {
    add('Finishing the workspace shell…')
    add('Almost ready…')
  }

  return out.length > 0 ? out : ['Starting…']
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type WakeParticleSpec = {
  id: number
  angleDeg: number
  delayMs: number
  durationMs: number
  distVmin: number
  sizePx: number
  trail: boolean
  hueNudge: number
}

export type WakeStarSpec = {
  id: number
  xPct: number
  yPct: number
  sizePx: number
  delayMs: number
  durationMs: number
  bright: boolean
}

function buildParticles(seed: number, count: number): WakeParticleSpec[] {
  const rnd = mulberry32(seed)
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    angleDeg: rnd() * 360,
    delayMs: Math.floor(rnd() * 2600),
    durationMs: 5200 + Math.floor(rnd() * 4800),
    distVmin: 18 + rnd() * 38,
    sizePx: 1.2 + rnd() * 2.8,
    trail: rnd() > 0.55,
    hueNudge: rnd() * 28 - 14
  }))
}

function buildSparks(seed: number, count: number): WakeParticleSpec[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9)
  return Array.from({ length: count }, (_, i) => ({
    id: i + 4096,
    angleDeg: rnd() * 360,
    delayMs: Math.floor(rnd() * 2200),
    durationMs: 2800 + Math.floor(rnd() * 3600),
    distVmin: 10 + rnd() * 22,
    sizePx: 0.9 + rnd() * 1.6,
    trail: false,
    hueNudge: rnd() * 36 - 18
  }))
}

function buildStarfield(seed: number, count: number): WakeStarSpec[] {
  const rnd = mulberry32(seed ^ 0x27d4eb2d)
  return Array.from({ length: count }, (_, i) => ({
    id: i + 16384,
    xPct: rnd() * 100,
    yPct: rnd() * 100,
    sizePx: 0.9 + rnd() * 2.2,
    delayMs: Math.floor(rnd() * 5000),
    durationMs: 2200 + Math.floor(rnd() * 5200),
    bright: rnd() > 0.78
  }))
}

function wakeIntensityAtProgress(u: number): number {
  if (u < 0.1) return clamp01((u / 0.1) * 0.58)
  if (u < 0.42) return 0.58 - clamp01((u - 0.1) / 0.32) * 0.2
  return Math.max(0, 0.38 - clamp01((u - 0.42) / 0.58) * 0.38)
}

export type PresenceWakeOverlayProps = {
  personality?: ModelPersonalityVibe | null
  /** When true, the wake stays up (no timed exit) until this becomes false (e.g. model load finished). */
  runtimeStarting?: boolean
  /** Inferred backend for contextual setup copy while the runtime starts. */
  setupRuntimeKind?: 'ollama' | 'llamacpp' | null
  /** Whether the app will try to resume the last model from the previous session. */
  resumeRuntimeSession?: boolean
  /** Short status from the main process (load progress, server lines), shown when non-empty. */
  setupLiveDetail?: string | null
  /** Product name shown at the top of the wake sequence. */
  appTitle?: string
  onIntensityChange: (intensity: number) => void
  onDone: () => void
}

export function PresenceWakeOverlay(props: PresenceWakeOverlayProps): ReactElement {
  const {
    personality,
    runtimeStarting = false,
    setupRuntimeKind = null,
    resumeRuntimeSession = false,
    setupLiveDetail = null,
    appTitle = 'Local LLM Desktop',
    onIntensityChange,
    onDone
  } = props

  const particleSeedRef = useRef((Math.random() * 0xffffffff) >>> 0)
  const particleSpecs = useMemo(
    () => buildParticles(particleSeedRef.current, PARTICLE_COUNT),
    []
  )
  const sparkSpecs = useMemo(() => buildSparks(particleSeedRef.current, SPARK_COUNT), [])
  const starSpecs = useMemo(() => buildStarfield(particleSeedRef.current, STARFIELD_COUNT), [])

  const [reducedMotion, setReducedMotion] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })
  const [exiting, setExiting] = useState(false)
  const doneRef = useRef(false)
  const rafRef = useRef(0)
  const startRef = useRef(0)
  const earlyExitRef = useRef(false)
  const reducedTimerRef = useRef(0)
  const reducedIntervalRef = useRef(0)
  const outroTimerRef = useRef(0)
  const outroScheduledRef = useRef(false)
  const runtimeStartingRef = useRef(runtimeStarting)

  const setupLines = useMemo(
    () =>
      buildWakeSetupLines({
        runtimeStarting,
        runtimeKind: setupRuntimeKind,
        resumeRuntime: resumeRuntimeSession,
        liveDetail: setupLiveDetail?.trim() ? setupLiveDetail.trim() : null
      }),
    [runtimeStarting, setupRuntimeKind, resumeRuntimeSession, setupLiveDetail]
  )

  const [setupLineIndex, setSetupLineIndex] = useState(0)
  const [setupAnimKey, setSetupAnimKey] = useState(0)
  const setupLinesSigRef = useRef<string | null>(null)

  useEffect(() => {
    const sig = setupLines.join('\0')
    setSetupLineIndex(0)
    if (setupLinesSigRef.current !== null && setupLinesSigRef.current !== sig) {
      setSetupAnimKey((k) => k + 1)
    }
    setupLinesSigRef.current = sig
  }, [setupLines])

  useEffect(() => {
    const n = setupLines.length
    const id = window.setInterval(() => {
      setSetupLineIndex((i) => (n <= 1 ? 0 : (i + 1) % n))
      setSetupAnimKey((k) => k + 1)
    }, SETUP_LINE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [setupLines])

  useEffect(() => {
    runtimeStartingRef.current = runtimeStarting
  }, [runtimeStarting])

  const rootStyle = useMemo((): CSSProperties | undefined => {
    const v = personality
    if (!v) return undefined
    return {
      '--wake-warmth': String(v.warmth),
      '--wake-energy': String(v.energy),
      '--wake-play': String(v.playfulness),
      '--wake-calm': String(v.calm),
      '--wake-expr': String(v.expressiveness),
      '--wake-hue-shift': String(v.hueShift)
    } as CSSProperties
  }, [personality])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const onChange = (): void => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const completeWake = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    outroScheduledRef.current = false
    window.clearTimeout(outroTimerRef.current)
    outroTimerRef.current = 0
    window.clearInterval(reducedIntervalRef.current)
    reducedIntervalRef.current = 0
    onIntensityChange(0)
    onDone()
  }, [onDone, onIntensityChange])

  const beginOutroAndComplete = useCallback(
    (outroMs: number) => {
      if (doneRef.current || outroScheduledRef.current) return
      outroScheduledRef.current = true
      cancelAnimationFrame(rafRef.current)
      window.clearInterval(reducedIntervalRef.current)
      window.clearTimeout(outroTimerRef.current)
      setExiting(true)
      outroTimerRef.current = window.setTimeout(() => {
        outroTimerRef.current = 0
        completeWake()
      }, outroMs)
    },
    [completeWake]
  )

  const startEarlyExit = useCallback(() => {
    if (doneRef.current || outroScheduledRef.current) return
    earlyExitRef.current = true
    window.clearTimeout(reducedTimerRef.current)
    reducedTimerRef.current = 0
    window.clearInterval(reducedIntervalRef.current)
    reducedIntervalRef.current = 0
    cancelAnimationFrame(rafRef.current)

    if (reducedMotion) {
      onIntensityChange(0)
      completeWake()
      return
    }

    setExiting(true)
    const t0 = performance.now()
    const elapsed = Math.max(0, performance.now() - startRef.current)
    const from = wakeIntensityAtProgress(Math.min(1, elapsed / WAKE_DURATION_MS))
    const easeOut = (): void => {
      const t = (performance.now() - t0) / 280
      if (t >= 1) {
        completeWake()
        return
      }
      onIntensityChange(from * (1 - t))
      rafRef.current = requestAnimationFrame(easeOut)
    }
    rafRef.current = requestAnimationFrame(easeOut)
  }, [completeWake, onIntensityChange, reducedMotion])

  useEffect(() => {
    doneRef.current = false
    earlyExitRef.current = false
    outroScheduledRef.current = false
    setExiting(false)
    window.clearTimeout(outroTimerRef.current)
    outroTimerRef.current = 0
    startRef.current = performance.now()

    if (reducedMotion) {
      onIntensityChange(0.38)
      reducedIntervalRef.current = window.setInterval(() => {
        if (doneRef.current || earlyExitRef.current || outroScheduledRef.current) return
        if (runtimeStartingRef.current) return
        const elapsed = performance.now() - startRef.current
        if (elapsed < WAKE_DURATION_MS) return
        window.clearInterval(reducedIntervalRef.current)
        reducedIntervalRef.current = 0
        onIntensityChange(0)
        beginOutroAndComplete(WAKE_OUTRO_REDUCED_MS)
      }, 100)
      return () => {
        window.clearInterval(reducedIntervalRef.current)
        reducedIntervalRef.current = 0
        window.clearTimeout(reducedTimerRef.current)
        window.clearTimeout(outroTimerRef.current)
        outroTimerRef.current = 0
        cancelAnimationFrame(rafRef.current)
      }
    }

    const tick = (now: number): void => {
      if (doneRef.current || earlyExitRef.current || outroScheduledRef.current) return
      if (runtimeStartingRef.current) {
        const pulse = 0.38 + Math.sin(now / 900) * 0.12
        onIntensityChange(clamp01(pulse))
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const elapsed = now - startRef.current
      const u = Math.min(1, elapsed / WAKE_DURATION_MS)
      onIntensityChange(wakeIntensityAtProgress(u))
      if (elapsed >= WAKE_DURATION_MS) {
        beginOutroAndComplete(WAKE_OUTRO_MS)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.clearInterval(reducedIntervalRef.current)
      reducedIntervalRef.current = 0
      window.clearTimeout(outroTimerRef.current)
      outroTimerRef.current = 0
    }
  }, [reducedMotion, onIntensityChange, beginOutroAndComplete])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        startEarlyExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startEarlyExit])

  const onPointerDown = (): void => {
    startEarlyExit()
  }

  const reducedClass = reducedMotion ? ' presence-wake--reduced-motion' : ''
  const exitingClass = exiting ? ' presence-wake--exiting' : ''

  const particleStyle = (p: WakeParticleSpec): CSSProperties =>
    ({
      '--p-ang': `${p.angleDeg}deg`,
      '--p-delay': `${p.delayMs}ms`,
      '--p-dur': `${p.durationMs}ms`,
      '--p-dist': `${p.distVmin.toFixed(2)}vmin`,
      '--p-size': `${p.sizePx.toFixed(2)}px`,
      '--p-hue-nudge': `${p.hueNudge.toFixed(1)}`
    }) as CSSProperties

  const starStyle = (s: WakeStarSpec): CSSProperties =>
    ({
      left: `${s.xPct.toFixed(2)}%`,
      top: `${s.yPct.toFixed(2)}%`,
      width: `${s.sizePx.toFixed(2)}px`,
      height: `${s.sizePx.toFixed(2)}px`,
      '--st-delay': `${s.delayMs}ms`,
      '--st-dur': `${s.durationMs}ms`
    }) as CSSProperties

  const setupLine = setupLines[Math.min(setupLineIndex, setupLines.length - 1)] ?? 'Starting…'

  return (
    <div
      className={`presence-wake-root${reducedClass}${exitingClass}`}
      role="dialog"
      aria-modal="true"
      aria-busy={runtimeStarting}
      aria-labelledby="presence-wake-app-title"
      style={rootStyle}
      onPointerDown={onPointerDown}
    >
      <h1 id="presence-wake-app-title" className="presence-wake-app-title">
        {appTitle}
      </h1>
      <div className="presence-wake-visual" aria-hidden="true">
        <div className="presence-wake-frost" />
        <div className="presence-wake-nebula presence-wake-nebula--a" />
        <div className="presence-wake-nebula presence-wake-nebula--b" />
        <div className="presence-wake-aurora" />
        <div className="presence-wake-starfield">
          {starSpecs.map((s) => (
            <span
              key={s.id}
              className={`presence-wake-star${s.bright ? ' presence-wake-star--bright' : ''}`}
              style={starStyle(s)}
            />
          ))}
        </div>
        <div className="presence-wake-visions">
          <div className="presence-wake-particles">
            {particleSpecs.map((p) => (
              <span
                key={p.id}
                className={`presence-wake-particle${p.trail ? ' presence-wake-particle--dust' : ''}`}
                style={particleStyle(p)}
              />
            ))}
          </div>
          <div className="presence-wake-ring presence-wake-ring--a" />
          <div className="presence-wake-ring presence-wake-ring--b" />
          <div className="presence-wake-ring presence-wake-ring--c" />
          <div className="presence-wake-orbit presence-wake-orbit--inner" />
          <div className="presence-wake-flare" />
          <div className="presence-wake-core" />
          <div className="presence-wake-sparks">
            {sparkSpecs.map((p) => (
              <span key={p.id} className="presence-wake-spark" style={particleStyle(p)} />
            ))}
          </div>
        </div>
      </div>
      <div className="presence-wake-setup" aria-live="polite" aria-atomic="true">
        <p key={setupAnimKey} className="presence-wake-setup-line">
          {setupLine}
        </p>
      </div>
    </div>
  )
}
