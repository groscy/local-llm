import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from 'react'

export type KgViewport = { scale: number; tx: number; ty: number }

const MIN_SCALE = 0.08
const MAX_SCALE = 2.8

type UseOpts = {
  contentW: number
  contentH: number
  /** When this changes, viewport resets to fit. */
  resetKey: string | number
}

export function useKnowledgeGraphViewport(wrapRef: RefObject<HTMLDivElement | null>, opts: UseOpts) {
  const { contentW, contentH, resetKey } = opts
  const [vp, setVp] = useState<KgViewport>({ scale: 1, tx: 0, ty: 0 })
  const panRef = useRef<{ active: boolean; sx: number; sy: number; tx0: number; ty0: number } | null>(null)

  const fitToView = useCallback(() => {
    const el = wrapRef.current
    if (!el || contentW <= 0 || contentH <= 0) return
    const pad = 24
    const vw = Math.max(80, el.clientWidth - pad)
    const vh = Math.max(80, el.clientHeight - pad)
    const sx = vw / contentW
    const sy = vh / contentH
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(sx, sy)))
    const tx = (el.clientWidth - contentW * scale) / 2
    const ty = (el.clientHeight - contentH * scale) / 2
    setVp({ scale, tx, ty })
  }, [wrapRef, contentW, contentH])

  useLayoutEffect(() => {
    if (contentW > 4 && contentH > 4) fitToView()
  }, [resetKey, fitToView, contentW, contentH])

  const zoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    setVp((prev) => {
      const worldX = (mx - prev.tx) / prev.scale
      const worldY = (my - prev.ty) / prev.scale
      return {
        scale: s,
        tx: mx - worldX * s,
        ty: my - worldY * s
      }
    })
  }, [wrapRef])

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = wrapRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.09 : 1 / 1.09
      setVp((prev) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor))
        const worldX = (mx - prev.tx) / prev.scale
        const worldY = (my - prev.ty) / prev.scale
        return { scale: s, tx: mx - worldX * s, ty: my - worldY * s }
      })
    },
    [wrapRef]
  )

  const vpRef = useRef(vp)
  vpRef.current = vp

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('button,a,input,select,textarea,[data-kg-no-pan],.kg-node,.kg-map-interactive')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = vpRef.current
    panRef.current = { active: true, sx: e.clientX, sy: e.clientY, tx0: v.tx, ty0: v.ty }
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const p = panRef.current
      if (!p?.active) return
      const dx = e.clientX - p.sx
      const dy = e.clientY - p.sy
      setVp((v) => ({ ...v, tx: p.tx0 + dx, ty: p.ty0 + dy }))
    },
    []
  )

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.active) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      panRef.current = null
    }
  }, [])

  const zoomIn = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    setVp((prev) => {
      const rect = el.getBoundingClientRect()
      const mx = cx - rect.left
      const my = cy - rect.top
      const s = Math.min(MAX_SCALE, prev.scale * 1.12)
      const worldX = (mx - prev.tx) / prev.scale
      const worldY = (my - prev.ty) / prev.scale
      return { scale: s, tx: mx - worldX * s, ty: my - worldY * s }
    })
  }, [wrapRef])

  const zoomOut = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    setVp((prev) => {
      const rect = el.getBoundingClientRect()
      const mx = cx - rect.left
      const my = cy - rect.top
      const s = Math.max(MIN_SCALE, prev.scale / 1.12)
      const worldX = (mx - prev.tx) / prev.scale
      const worldY = (my - prev.ty) / prev.scale
      return { scale: s, tx: mx - worldX * s, ty: my - worldY * s }
    })
  }, [wrapRef])

  const resetZoom = useCallback(() => {
    setVp({ scale: 1, tx: 16, ty: 16 })
  }, [])

  return {
    viewport: vp,
    setViewport: setVp,
    fitToView,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomAt,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPan,
    onPointerLeave: endPan
  }
}
