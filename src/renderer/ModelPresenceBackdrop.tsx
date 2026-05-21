import type { ModelPersonalityVibe } from '@shared/modelPersonality'
import { DEFAULT_MODEL_PERSONALITY } from '@shared/modelPersonality'
import { useEffect, useRef, useState, type ReactElement } from 'react'

/** Stable per-model tint so each loaded model feels slightly different. */
function modelHueOffset(path: string | undefined): number {
  if (!path?.trim()) return 0
  let h = 2166136261
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (((h >>> 0) % 72) - 36) * 0.45
}

export type ModelPresenceBackdropProps = {
  running: boolean
  starting: boolean
  loadPercent: number | null
  chatBusy: boolean
  modelPath?: string
  tokensPerSec?: number
  cpuPercent?: number
  ctxPercent?: number
  /** Evolving mood from optional [[AMB:…]] markers; blends with load-based motion. */
  personality?: ModelPersonalityVibe | null
  /** 0–1: brief startup “wake” pulse while the presence overlay is visible (idle runtime only). */
  wakeIntensity?: number
  /** 0..100 blended local machine load (CPU + memory pressure). */
  resourceLoadPercent?: number
  /** Live-status mirror: whether bridge status is currently positive. */
  bridgeStatusPositive?: boolean
  /** Live-status mirror: whether runtime status is currently positive. */
  runtimeStatusPositive?: boolean
  /** Direct Claude bridge activity indicator for a third orbiting satellite. */
  claudeBridgeStatusPositive?: boolean
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function targetActivity(p: ModelPresenceBackdropProps): number {
  const tok = Math.min(140, Math.max(0, p.tokensPerSec ?? 0))
  const cpu = Math.min(100, Math.max(0, p.cpuPercent ?? 0))
  const ctx = Math.min(100, Math.max(0, p.ctxPercent ?? 0))
  if (p.starting) {
    const lp = p.loadPercent != null ? Math.min(100, Math.max(0, p.loadPercent)) / 100 : 0.4
    return Math.min(1, 0.42 + lp * 0.48)
  }
  if (p.chatBusy) {
    return Math.min(1, 0.48 + Math.min(0.42, tok / 95) + (cpu / 100) * 0.18 + (ctx / 100) * 0.08)
  }
  if (p.running) {
    return Math.min(1, 0.16 + Math.min(0.36, tok / 75) + (cpu / 100) * 0.24 + (ctx / 100) * 0.16)
  }
  const wake = clamp(p.wakeIntensity ?? 0, 0, 1)
  if (wake > 0) {
    return Math.min(1, 0.08 + wake * 0.52)
  }
  return 0.06
}

type Phys = {
  lastNow: number
  px: number
  py: number
  vx: number
  vy: number
  restX: number
  restY: number
  rvx: number
  rvy: number
  pulsePos: number
  pulseVel: number
  activity: number
  resourceLoad: number
  satellitePhaseA: number
  satellitePhaseB: number
  satellitePhaseC: number
  bridgeVisiblePrev: boolean
  runtimeVisiblePrev: boolean
  claudeVisiblePrev: boolean
  init: boolean
}

function createPhys(): Phys {
  return {
    lastNow: 0,
    px: 50,
    py: 46,
    vx: (Math.random() - 0.5) * 4,
    vy: (Math.random() - 0.5) * 3,
    restX: 50 + (Math.random() - 0.5) * 4,
    restY: 46 + (Math.random() - 0.5) * 3,
    rvx: (Math.random() - 0.5) * 3,
    rvy: (Math.random() - 0.5) * 2.5,
    pulsePos: (Math.random() - 0.5) * 0.15,
    pulseVel: 0,
    activity: 0.1,
    resourceLoad: 0,
    satellitePhaseA: Math.random() * Math.PI * 2,
    satellitePhaseB: Math.random() * Math.PI * 2,
    satellitePhaseC: Math.random() * Math.PI * 2,
    bridgeVisiblePrev: false,
    runtimeVisiblePrev: false,
    claudeVisiblePrev: false,
    init: false
  }
}

/**
 * Soft “model presence” behind the frosted shell: color, glow, and motion react to
 * load, generation, tokens/s, CPU, and context. Motion is a continuous physics
 * sim (spring + drift + bounded rebounds), not a looping waveform.
 */
export function ModelPresenceBackdrop(props: ModelPresenceBackdropProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const physRef = useRef<Phys | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const onChange = (): void => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    const el = rootRef.current
    if (!el) return

    if (!physRef.current) physRef.current = createPhys()
    const s = physRef.current

    let raf = 0
    const tick = (now: number): void => {
      const p = propsRef.current
      if (!s.init) {
        s.lastNow = now
        s.init = true
      }
      const dt = clamp((now - s.lastNow) / 1000, 0, 0.064)
      s.lastNow = now
      if (dt <= 0) {
        raf = requestAnimationFrame(tick)
        return
      }

      const modelTint = modelHueOffset(p.modelPath)
      const targetAct = targetActivity(p)
      const blend = 1 - Math.exp(-(2.8 + targetAct * 2.2) * dt)
      s.activity += (targetAct - s.activity) * blend
      const activity = clamp(s.activity, 0, 1)

      const pers = p.personality ?? DEFAULT_MODEL_PERSONALITY
      const expr = pers.expressiveness
      const warm = pers.warmth
      const calm = pers.calm
      const nrg = pers.energy
      const play = pers.playfulness
      const roamPers = 0.72 + expr * 0.38
      const jitterMult =
        (0.52 + nrg * 0.95) * (1.05 - calm * 0.4) * (0.85 + play * 0.35)
      const dragPers = 1 + (calm - 0.5) * 0.45
      const pulseDriveMult = (0.45 + play * 0.85) * (0.55 + nrg * 0.55)
      const restitutionBoost = 0.04 + play * 0.1

      const roam = (p.running || p.starting || p.chatBusy ? 1 : 0.34) * roamPers

      // --- Drifting anchor (inner box, elastic rebounds) ---
      const rMinX = 41
      const rMaxX = 59
      const rMinY = 39
      const rMaxY = 55
      const restitutionRest = clamp(0.82 - activity * 0.06 + restitutionBoost * (0.35 + activity * 0.4), 0.55, 0.96)

      let pullX = (50 - s.restX) * (0.09 + activity * 0.11) * roam
      let pullY = (46 - s.restY) * (0.09 + activity * 0.11) * roam
      const jitterR = (Math.random() - 0.5) * (18 + activity * 42) * roam * jitterMult
      const jitterRy = (Math.random() - 0.5) * (18 + activity * 42) * roam * jitterMult
      s.rvx += (pullX + jitterR) * dt
      s.rvy += (pullY + jitterRy) * dt
      s.rvx *= Math.exp(-(0.55 + activity * 0.35) * dragPers * dt)
      s.rvy *= Math.exp(-(0.55 + activity * 0.35) * dragPers * dt)

      s.restX += s.rvx * dt
      s.restY += s.rvy * dt
      if (s.restX < rMinX) {
        s.restX = rMinX
        s.rvx = Math.abs(s.rvx) * restitutionRest
      } else if (s.restX > rMaxX) {
        s.restX = rMaxX
        s.rvx = -Math.abs(s.rvx) * restitutionRest
      }
      if (s.restY < rMinY) {
        s.restY = rMinY
        s.rvy = Math.abs(s.rvy) * restitutionRest
      } else if (s.restY > rMaxY) {
        s.restY = rMaxY
        s.rvy = -Math.abs(s.rvy) * restitutionRest
      }

      // --- Orb: spring toward anchor, swirl, thermal noise, outer walls ---
      const k = 0.95 + activity * 2.45
      let ax = (s.restX - s.px) * k
      let ay = (s.restY - s.py) * k
      const cx = s.px - 50
      const cy = s.py - 46
      ax += -cy * (0.018 + activity * 0.022) * roam
      ay += cx * (0.018 + activity * 0.022) * roam
      const thermal = (32 + activity * 95) * roam * jitterMult
      ax += (Math.random() - 0.5) * thermal * dt
      ay += (Math.random() - 0.5) * thermal * dt

      s.vx += ax * dt
      s.vy += ay * dt
      const dragOrb = Math.exp(-(0.5 + activity * 0.42) * dragPers * dt)
      s.vx *= dragOrb
      s.vy *= dragOrb

      s.px += s.vx * dt
      s.py += s.vy * dt

      const minX = 27
      const maxX = 73
      const minY = 23
      const maxY = 69
      const restitutionOrb = clamp(0.68 + activity * 0.16 + restitutionBoost * (0.25 + activity * 0.35), 0.52, 0.95)

      if (s.px < minX) {
        s.px = minX
        s.vx = Math.abs(s.vx) * restitutionOrb
      } else if (s.px > maxX) {
        s.px = maxX
        s.vx = -Math.abs(s.vx) * restitutionOrb
      }
      if (s.py < minY) {
        s.py = minY
        s.vy = Math.abs(s.vy) * restitutionOrb
      } else if (s.py > maxY) {
        s.py = maxY
        s.vy = -Math.abs(s.vy) * restitutionOrb
      }

      // --- Damped pulse oscillator (noise-driven, not periodic sine loop) ---
      const w = 3.2 + activity * 8.5
      const zeta = 0.32 + activity * 0.28
      const drive =
        (Math.random() - 0.5) * (6 + activity * 22) * (0.35 + roam * 0.65) * pulseDriveMult
      const pulseAcc = -w * w * s.pulsePos - 2 * zeta * w * s.pulseVel + drive
      s.pulseVel += pulseAcc * dt
      s.pulsePos += s.pulseVel * dt
      const pulseLim = 0.55
      if (s.pulsePos > pulseLim) {
        s.pulsePos = pulseLim
        s.pulseVel = -Math.abs(s.pulseVel) * 0.42
      } else if (s.pulsePos < -pulseLim) {
        s.pulsePos = -pulseLim
        s.pulseVel = Math.abs(s.pulseVel) * 0.42
      }

      const pulse = clamp(0.52 + s.pulsePos * 0.72, 0.14, 0.96)
      const targetResourceLoad = clamp((p.resourceLoadPercent ?? 0) / 100, 0, 1)
      const resourceBlend = 1 - Math.exp(-2.2 * dt)
      s.resourceLoad += (targetResourceLoad - s.resourceLoad) * resourceBlend
      const resourceLoad = clamp(s.resourceLoad, 0, 1)
      const bridgeVisible = p.bridgeStatusPositive === true
      const runtimeVisible = p.runtimeStatusPositive === true
      const claudeVisible = p.claudeBridgeStatusPositive === true
      if (bridgeVisible && !s.bridgeVisiblePrev) s.satellitePhaseA = Math.random() * Math.PI * 2
      if (runtimeVisible && !s.runtimeVisiblePrev) s.satellitePhaseB = Math.random() * Math.PI * 2
      if (claudeVisible && !s.claudeVisiblePrev) s.satellitePhaseC = Math.random() * Math.PI * 2
      s.bridgeVisiblePrev = bridgeVisible
      s.runtimeVisiblePrev = runtimeVisible
      s.claudeVisiblePrev = claudeVisible

      const baseHue = p.chatBusy ? 300 : p.starting ? 205 : 252
      let hue =
        baseHue +
        modelTint +
        activity * 30 +
        s.pulsePos * 18 * pulseDriveMult +
        (0.5 - resourceLoad) * 42 +
        pers.hueShift * 44 +
        (warm - 0.5) * 22
      let sat =
        48 +
        activity * 36 * (0.85 + expr * 0.28) +
        resourceLoad * 10 +
        (p.chatBusy ? 12 : 0) +
        (warm - 0.5) * 26
      let light = 52 + activity * 14 + (warm - 0.5) * 10 - (calm - 0.5) * 6 - resourceLoad * 8
      let orbScale =
        0.78 +
        activity * 0.62 * (0.82 + expr * 0.35) +
        (p.starting && p.loadPercent != null ? p.loadPercent / 220 : 0)
      let outerBlur = 72 + activity * 64 * (0.78 + expr * 0.42)
      let opacity = 0.26 + activity * 0.5 * (0.9 + expr * 0.3) + resourceLoad * 0.08
      let orbitX = 0
      let orbitY = 0
      const satelliteOrbitSpeedA = 0.2 + activity * 0.16 + resourceLoad * 0.08
      const satelliteOrbitSpeedB = 0.13 + activity * 0.1 + resourceLoad * 0.06
      const satelliteOrbitSpeedC = 0.1 + activity * 0.08 + resourceLoad * 0.05
      s.satellitePhaseA += satelliteOrbitSpeedA * dt
      s.satellitePhaseB += satelliteOrbitSpeedB * dt
      s.satellitePhaseC += satelliteOrbitSpeedC * dt
      if (s.satellitePhaseA > Math.PI * 2) s.satellitePhaseA -= Math.PI * 2
      if (s.satellitePhaseB > Math.PI * 2) s.satellitePhaseB -= Math.PI * 2
      if (s.satellitePhaseC > Math.PI * 2) s.satellitePhaseC -= Math.PI * 2
      const satellitePhaseA = s.satellitePhaseA
      const satellitePhaseB = s.satellitePhaseB + Math.PI * 0.92
      const satellitePhaseC = s.satellitePhaseC + Math.PI * 0.37
      const satelliteARadius = 58 + activity * 22 + resourceLoad * 8
      const satelliteBRadius = 46 + activity * 18 + resourceLoad * 10
      const satelliteCRadius = 70 + activity * 24 + resourceLoad * 12
      const orbitATiltAspect = 0.6
      const orbitBTiltAspect = 0.66
      const orbitCTiltAspect = 0.74
      const orbitARotateDeg = 17
      const orbitBRotateDeg = -29
      const orbitCRotateDeg = 46
      const orbitARotate = (orbitARotateDeg * Math.PI) / 180
      const orbitBRotate = (orbitBRotateDeg * Math.PI) / 180
      const orbitCRotate = (orbitCRotateDeg * Math.PI) / 180
      const orbitACos = Math.cos(orbitARotate)
      const orbitASin = Math.sin(orbitARotate)
      const orbitBCos = Math.cos(orbitBRotate)
      const orbitBSin = Math.sin(orbitBRotate)
      const orbitCCos = Math.cos(orbitCRotate)
      const orbitCSin = Math.sin(orbitCRotate)
      // Orbit A: X-axis tilt feel (vertical compression).
      const satABaseX = Math.cos(satellitePhaseA) * satelliteARadius
      const satABaseY = Math.sin(satellitePhaseA) * satelliteARadius * orbitATiltAspect
      const satelliteAX = satABaseX * orbitACos - satABaseY * orbitASin
      const satelliteAY = satABaseX * orbitASin + satABaseY * orbitACos
      // Orbit B: Y-axis tilt feel (horizontal compression).
      const satBBaseX = Math.cos(satellitePhaseB) * satelliteBRadius * orbitBTiltAspect
      const satBBaseY = Math.sin(satellitePhaseB) * satelliteBRadius
      const satelliteBX = satBBaseX * orbitBCos - satBBaseY * orbitBSin
      const satelliteBY = satBBaseX * orbitBSin + satBBaseY * orbitBCos
      // Orbit C: broader and slightly flatter lane for Claude bridge indicator.
      const satCBaseX = Math.cos(satellitePhaseC) * satelliteCRadius
      const satCBaseY = Math.sin(satellitePhaseC) * satelliteCRadius * orbitCTiltAspect
      const satelliteCX = satCBaseX * orbitCCos - satCBaseY * orbitCSin
      const satelliteCY = satCBaseX * orbitCSin + satCBaseY * orbitCCos
      const satelliteAPulse = clamp(0.62 + pulse * 0.48 + resourceLoad * 0.2, 0.42, 1.35)
      const satelliteBPulse = clamp(0.58 + (1 - pulse) * 0.34 + resourceLoad * 0.2, 0.4, 1.28)
      const satelliteCPulse = clamp(0.54 + pulse * 0.22 + resourceLoad * 0.24, 0.42, 1.22)

      hue = ((hue % 360) + 360) % 360
      sat = clamp(sat, 28, 92)
      light = clamp(light, 38, 72)
      orbScale = clamp(orbScale, 0.55, 2.1)
      outerBlur = clamp(outerBlur, 56, 228)
      opacity = clamp(opacity, 0.16, 0.94)

      if (p.starting) {
        const lp = p.loadPercent != null ? clamp(p.loadPercent / 100, 0, 1) : 0.4
        const orbitRadiusPx = 14 + activity * 26 + (1 - lp) * 12
        const orbitSpeed = 0.8 + activity * 1.25
        const phase = (now / 1000) * orbitSpeed
        orbitX = Math.cos(phase) * orbitRadiusPx
        orbitY = Math.sin(phase) * orbitRadiusPx * 0.72
      }

      el.style.setProperty('--mp-x', `${s.px}%`)
      el.style.setProperty('--mp-y', `${s.py}%`)
      el.style.setProperty('--mp-scale', orbScale.toFixed(4))
      el.style.setProperty('--mp-blur-outer', `${outerBlur.toFixed(0)}px`)
      el.style.setProperty('--mp-opacity', opacity.toFixed(4))
      el.style.setProperty('--mp-pulse', pulse.toFixed(4))
      el.style.setProperty('--mp-hue', hue.toFixed(1))
      el.style.setProperty('--mp-sat', `${sat.toFixed(1)}%`)
      el.style.setProperty('--mp-light', `${light.toFixed(1)}%`)
      el.style.setProperty('--mp-activity', activity.toFixed(4))
      el.style.setProperty('--mp-orbit-x', `${orbitX.toFixed(2)}px`)
      el.style.setProperty('--mp-orbit-y', `${orbitY.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-a-x', `${satelliteAX.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-a-y', `${satelliteAY.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-b-x', `${satelliteBX.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-b-y', `${satelliteBY.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-c-x', `${satelliteCX.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-c-y', `${satelliteCY.toFixed(2)}px`)
      el.style.setProperty('--mp-sat-a-pulse', satelliteAPulse.toFixed(4))
      el.style.setProperty('--mp-sat-b-pulse', satelliteBPulse.toFixed(4))
      el.style.setProperty('--mp-sat-c-pulse', satelliteCPulse.toFixed(4))
      el.style.setProperty('--mp-sat-a-width', `${(satelliteARadius * 2).toFixed(2)}px`)
      el.style.setProperty('--mp-sat-a-height', `${(satelliteARadius * 2 * orbitATiltAspect).toFixed(2)}px`)
      el.style.setProperty('--mp-sat-b-width', `${(satelliteBRadius * 2 * orbitBTiltAspect).toFixed(2)}px`)
      el.style.setProperty('--mp-sat-b-height', `${(satelliteBRadius * 2).toFixed(2)}px`)
      el.style.setProperty('--mp-sat-c-width', `${(satelliteCRadius * 2).toFixed(2)}px`)
      el.style.setProperty('--mp-sat-c-height', `${(satelliteCRadius * 2 * orbitCTiltAspect).toFixed(2)}px`)
      el.style.setProperty('--mp-sat-a-rotate-deg', `${orbitARotateDeg.toFixed(2)}deg`)
      el.style.setProperty('--mp-sat-b-rotate-deg', `${orbitBRotateDeg.toFixed(2)}deg`)
      el.style.setProperty('--mp-sat-c-rotate-deg', `${orbitCRotateDeg.toFixed(2)}deg`)

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  return (
    <div
      ref={rootRef}
      className={`model-presence-backdrop${reducedMotion ? ' model-presence-backdrop--reduced' : ''}`}
      aria-hidden
    >
      <div className="model-presence-vignette" />
      <div className="model-presence-cluster">
        <div className="model-presence-orb model-presence-orb--halo" />
        <div className="model-presence-orb model-presence-orb--body" />
        <div className="model-presence-orb model-presence-orb--core" />
        <div className="model-presence-orb model-presence-orb--mini" />
        <div className="model-presence-orb model-presence-orb--spark" />
        {props.bridgeStatusPositive ? (
          <>
            <div className="model-presence-orbit-line model-presence-orbit-line--bridge" aria-hidden />
            <div className="model-presence-satellite model-presence-satellite--bridge" aria-hidden />
          </>
        ) : null}
        {props.runtimeStatusPositive ? (
          <>
            <div className="model-presence-orbit-line model-presence-orbit-line--runtime" aria-hidden />
            <div className="model-presence-satellite model-presence-satellite--runtime" aria-hidden />
          </>
        ) : null}
        {props.claudeBridgeStatusPositive ? (
          <>
            <div className="model-presence-orbit-line model-presence-orbit-line--claude" aria-hidden />
            <div className="model-presence-satellite model-presence-satellite--claude" aria-hidden />
          </>
        ) : null}
      </div>
    </div>
  )
}
