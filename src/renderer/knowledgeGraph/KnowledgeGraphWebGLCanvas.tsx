import { memo, useEffect, useLayoutEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { KnowledgeGraphEdgeKind, KnowledgeGraphNodeKind } from '@shared/types'

export type WebGLRenderNode = {
  id: string
  kind: KnowledgeGraphNodeKind
  x: number
  y: number
  r: number
  label: string
  highlighted: boolean
  dimmed: boolean
  showLabel: boolean
}

export type WebGLRenderEdge = {
  key: string
  kind: KnowledgeGraphEdgeKind
  x1: number
  y1: number
  x2: number
  y2: number
  salience: number
  highlighted: boolean
  dimmed: boolean
}

type Props = {
  width: number
  height: number
  tx: number
  ty: number
  scale: number
  nodes: WebGLRenderNode[]
  edges: WebGLRenderEdge[]
  lodTier: 'overview' | 'mid' | 'detail'
  onNodeHover: (id: string | null) => void
  onNodeClick: (id: string, clientX: number, clientY: number) => void
}

type GlProgramBundle = {
  gl: WebGL2RenderingContext
  lineProgram: WebGLProgram
  linePosBuffer: WebGLBuffer
  lineColorBuffer: WebGLBuffer
  linePosLoc: number
  lineColorLoc: number
  pointProgram: WebGLProgram
  pointPosBuffer: WebGLBuffer
  pointColorBuffer: WebGLBuffer
  pointSizeBuffer: WebGLBuffer
  pointPosLoc: number
  pointColorLoc: number
  pointSizeLoc: number
}

function disposeGlBundle(bundle: GlProgramBundle): void {
  const { gl } = bundle
  gl.deleteProgram(bundle.lineProgram)
  gl.deleteProgram(bundle.pointProgram)
  gl.deleteBuffer(bundle.linePosBuffer)
  gl.deleteBuffer(bundle.lineColorBuffer)
  gl.deleteBuffer(bundle.pointPosBuffer)
  gl.deleteBuffer(bundle.pointColorBuffer)
  gl.deleteBuffer(bundle.pointSizeBuffer)
}

const EDGE_COLOR_BY_KIND: Record<KnowledgeGraphEdgeKind, [number, number, number]> = {
  contains: [0.58, 0.62, 0.7],
  indexes: [0.32, 0.61, 0.86],
  compiled_from: [0.45, 0.73, 0.95],
  related: [0.8, 0.56, 0.91],
  semantic_related: [0.55, 0.77, 0.89]
}

const NODE_COLOR_BY_KIND: Record<KnowledgeGraphNodeKind, [number, number, number]> = {
  source: [0.28, 0.67, 0.93],
  chunk: [0.61, 0.66, 0.74],
  wiki: [0.51, 0.73, 0.88]
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram | null {
  const v = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const f = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!v || !f) {
    if (v) gl.deleteShader(v)
    if (f) gl.deleteShader(f)
    return null
  }
  const p = gl.createProgram()
  if (!p) {
    gl.deleteShader(v)
    gl.deleteShader(f)
    return null
  }
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p)
    return null
  }
  return p
}

function pickNearestNode(
  nodes: WebGLRenderNode[],
  x: number,
  y: number,
  tx: number,
  ty: number,
  scale: number
): WebGLRenderNode | null {
  let best: WebGLRenderNode | null = null
  let bestDist = 999999
  for (const node of nodes) {
    const sx = tx + node.x * scale
    const sy = ty + node.y * scale
    const hit = Math.max(7, node.r * scale + 5)
    const dist = Math.hypot(x - sx, y - sy)
    if (dist <= hit && dist < bestDist) {
      best = node
      bestDist = dist
    }
  }
  return best
}

export const KnowledgeGraphWebGLCanvas = memo(function KnowledgeGraphWebGLCanvas(props: Props): JSX.Element {
  const { width, height, tx, ty, scale, nodes, edges, lodTier, onNodeHover, onNodeClick } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fallback2dRef = useRef<CanvasRenderingContext2D | null>(null)
  const glBundleRef = useRef<GlProgramBundle | null>(null)
  const dpr = globalThis.devicePixelRatio || 1

  const linesVertex = useMemo(
    () =>
      `#version 300 es
in vec2 aPosition;
in vec4 aColor;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vColor = aColor;
}
`,
    []
  )
  const linesFragment = useMemo(
    () =>
      `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = vColor;
}
`,
    []
  )
  const pointsVertex = useMemo(
    () =>
      `#version 300 es
in vec2 aPosition;
in vec4 aColor;
in float aSize;
out vec4 vColor;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
}
`,
    []
  )
  const pointsFragment = useMemo(
    () =>
      `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5, 0.5);
  if (dot(c, c) > 0.25) discard;
  outColor = vColor;
}
`,
    []
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
    if (!gl) {
      fallback2dRef.current = canvas.getContext('2d')
      return
    }
    const lineProgram = createProgram(gl, linesVertex, linesFragment)
    const pointProgram = createProgram(gl, pointsVertex, pointsFragment)
    if (!lineProgram || !pointProgram) {
      fallback2dRef.current = canvas.getContext('2d')
      return
    }
    const linePosBuffer = gl.createBuffer()
    const lineColorBuffer = gl.createBuffer()
    const pointPosBuffer = gl.createBuffer()
    const pointColorBuffer = gl.createBuffer()
    const pointSizeBuffer = gl.createBuffer()
    if (!linePosBuffer || !lineColorBuffer || !pointPosBuffer || !pointColorBuffer || !pointSizeBuffer) {
      fallback2dRef.current = canvas.getContext('2d')
      return
    }
    const linePosLoc = gl.getAttribLocation(lineProgram, 'aPosition')
    const lineColorLoc = gl.getAttribLocation(lineProgram, 'aColor')
    const pointPosLoc = gl.getAttribLocation(pointProgram, 'aPosition')
    const pointColorLoc = gl.getAttribLocation(pointProgram, 'aColor')
    const pointSizeLoc = gl.getAttribLocation(pointProgram, 'aSize')
    if (linePosLoc < 0 || lineColorLoc < 0 || pointPosLoc < 0 || pointColorLoc < 0 || pointSizeLoc < 0) {
      disposeGlBundle({
        gl,
        lineProgram,
        linePosBuffer,
        lineColorBuffer,
        linePosLoc,
        lineColorLoc,
        pointProgram,
        pointPosBuffer,
        pointColorBuffer,
        pointSizeBuffer,
        pointPosLoc,
        pointColorLoc,
        pointSizeLoc
      })
      fallback2dRef.current = canvas.getContext('2d')
      return
    }
    glBundleRef.current = {
      gl,
      lineProgram,
      linePosBuffer,
      lineColorBuffer,
      linePosLoc,
      lineColorLoc,
      pointProgram,
      pointPosBuffer,
      pointColorBuffer,
      pointSizeBuffer,
      pointPosLoc,
      pointColorLoc,
      pointSizeLoc
    }
    return () => {
      const bundle = glBundleRef.current
      if (!bundle) return
      disposeGlBundle(bundle)
      glBundleRef.current = null
    }
  }, [linesFragment, linesVertex, pointsFragment, pointsVertex])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${Math.max(1, Math.floor(width))}px`
    canvas.style.height = `${Math.max(1, Math.floor(height))}px`
  }, [width, height, dpr])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const glBundle = glBundleRef.current
    if (glBundle) {
      try {
        const { gl } = glBundle
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)

      const clipX = (sx: number): number => (sx / Math.max(1, width)) * 2 - 1
      const clipY = (sy: number): number => 1 - (sy / Math.max(1, height)) * 2

      const linePos = new Float32Array(edges.length * 4)
      const lineColor = new Float32Array(edges.length * 8)
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i]!
        const sx1 = tx + edge.x1 * scale
        const sy1 = ty + edge.y1 * scale
        const sx2 = tx + edge.x2 * scale
        const sy2 = ty + edge.y2 * scale
        const p = i * 4
        linePos[p] = clipX(sx1)
        linePos[p + 1] = clipY(sy1)
        linePos[p + 2] = clipX(sx2)
        linePos[p + 3] = clipY(sy2)

        const tint = EDGE_COLOR_BY_KIND[edge.kind]
        const alphaBase = edge.highlighted ? 0.92 : edge.dimmed ? 0.08 : 0.18 + edge.salience * 0.5
        const a = Math.max(0.04, Math.min(1, alphaBase))
        const c = i * 8
        for (let j = 0; j < 2; j++) {
          lineColor[c + j * 4] = tint[0]
          lineColor[c + j * 4 + 1] = tint[1]
          lineColor[c + j * 4 + 2] = tint[2]
          lineColor[c + j * 4 + 3] = a
        }
      }

        gl.useProgram(glBundle.lineProgram)
        gl.bindBuffer(gl.ARRAY_BUFFER, glBundle.linePosBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, linePos, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(glBundle.linePosLoc)
        gl.vertexAttribPointer(glBundle.linePosLoc, 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, glBundle.lineColorBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, lineColor, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(glBundle.lineColorLoc)
        gl.vertexAttribPointer(glBundle.lineColorLoc, 4, gl.FLOAT, false, 0, 0)
        gl.drawArrays(gl.LINES, 0, edges.length * 2)

      const pointPos = new Float32Array(nodes.length * 2)
      const pointColor = new Float32Array(nodes.length * 4)
      const pointSize = new Float32Array(nodes.length)
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!
        const sx = tx + node.x * scale
        const sy = ty + node.y * scale
        pointPos[i * 2] = clipX(sx)
        pointPos[i * 2 + 1] = clipY(sy)
        const tint = NODE_COLOR_BY_KIND[node.kind]
        const alphaBase = node.highlighted ? 1 : node.dimmed ? 0.18 : 0.86
        pointColor[i * 4] = tint[0]
        pointColor[i * 4 + 1] = tint[1]
        pointColor[i * 4 + 2] = tint[2]
        pointColor[i * 4 + 3] = alphaBase
        const lodScale = lodTier === 'overview' ? 0.75 : lodTier === 'mid' ? 0.9 : 1
        pointSize[i] = Math.max(2.2, node.r * 2 * scale * lodScale)
      }

        gl.useProgram(glBundle.pointProgram)
        gl.bindBuffer(gl.ARRAY_BUFFER, glBundle.pointPosBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, pointPos, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(glBundle.pointPosLoc)
        gl.vertexAttribPointer(glBundle.pointPosLoc, 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, glBundle.pointColorBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, pointColor, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(glBundle.pointColorLoc)
        gl.vertexAttribPointer(glBundle.pointColorLoc, 4, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, glBundle.pointSizeBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, pointSize, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(glBundle.pointSizeLoc)
        gl.vertexAttribPointer(glBundle.pointSizeLoc, 1, gl.FLOAT, false, 0, 0)
        gl.drawArrays(gl.POINTS, 0, nodes.length)
        return
      } catch (err) {
        globalThis.console.warn('[kg-webgl] renderer fallback to 2d after draw error', err)
        disposeGlBundle(glBundle)
        fallback2dRef.current = canvas.getContext('2d')
        glBundleRef.current = null
      }
    }

    const ctx = fallback2dRef.current
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    for (const edge of edges) {
      const c = EDGE_COLOR_BY_KIND[edge.kind]
      const alphaBase = edge.highlighted ? 0.9 : edge.dimmed ? 0.07 : 0.15 + edge.salience * 0.35
      ctx.strokeStyle = `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${Math.min(1, Math.max(0.04, alphaBase))})`
      ctx.lineWidth = edge.highlighted ? 1.8 : 1
      ctx.beginPath()
      ctx.moveTo(tx + edge.x1 * scale, ty + edge.y1 * scale)
      ctx.lineTo(tx + edge.x2 * scale, ty + edge.y2 * scale)
      ctx.stroke()
    }
    for (const node of nodes) {
      const c = NODE_COLOR_BY_KIND[node.kind]
      const alphaBase = node.highlighted ? 1 : node.dimmed ? 0.2 : 0.8
      ctx.fillStyle = `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alphaBase})`
      const sx = tx + node.x * scale
      const sy = ty + node.y * scale
      const rr = Math.max(1.6, node.r * scale * (lodTier === 'overview' ? 0.72 : 1))
      ctx.beginPath()
      ctx.arc(sx, sy, rr, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [width, height, tx, ty, scale, edges, nodes, lodTier, dpr])

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = pickNearestNode(nodes, mx, my, tx, ty, scale)
    onNodeHover(hit?.id ?? null)
  }

  const onPointerLeave = (): void => onNodeHover(null)

  const onClick = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = pickNearestNode(nodes, mx, my, tx, ty, scale)
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    onNodeClick(hit.id, e.clientX, e.clientY)
  }

  return (
    <canvas
      ref={canvasRef}
      className="kg-webgl-canvas"
      width={Math.max(1, Math.floor(width * dpr))}
      height={Math.max(1, Math.floor(height * dpr))}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      aria-hidden
    />
  )
})
