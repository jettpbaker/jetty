import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import pixelCircle from '@/fonts/GeistPixel-Circle.woff2'
import pixelGrid from '@/fonts/GeistPixel-Grid.woff2'
import pixelLine from '@/fonts/GeistPixel-Line.woff2'
import pixelSquare from '@/fonts/GeistPixel-Square.woff2'
import pixelTriangle from '@/fonts/GeistPixel-Triangle.woff2'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

export const Route = createFileRoute('/scratchpad')({
  component: ScratchpadPage,
})

const PIXEL_VARIANTS = [
  ['Geist Pixel Square', pixelSquare],
  ['Geist Pixel Grid', pixelGrid],
  ['Geist Pixel Triangle', pixelTriangle],
  ['Geist Pixel Line', pixelLine],
  ['Geist Pixel Circle', pixelCircle],
] as const

const fontFaces = PIXEL_VARIANTS.map(
  ([family, url]) =>
    `@font-face { font-family: '${family}'; src: url('${url}') format('woff2'); font-weight: 500; }`
).join('\n')

const beaconKeyframes = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes beacon {
    0%, 100% { text-shadow: 0 0 14px currentColor; opacity: 0.92; }
    50% { text-shadow: 0 0 46px currentColor; opacity: 1; }
  }
}
`

const tideKeyframes = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes tide-swell {
    0%, 100% { transform: translateY(-4px); }
    50% { transform: translateY(4px); }
  }
}
`

const scanKeyframes = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes scan-sweep {
    0% { background-position: -60% 0; }
    100% { background-position: 160% 0; }
  }
}
`

const markStyle = {
  fontFamily: "'Geist Pixel Square'",
  WebkitTextStroke: '2px currentColor',
} as const

type Particle = { hx: number; hy: number; x: number; y: number; vx: number; vy: number }

const CANVAS_W = 640
const CANVAS_H = 180
const BLOCK = 5
const REPULSE_RADIUS = 70

function RepulsionMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const cv: HTMLCanvasElement = canvas
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.scale(dpr, dpr)
    const color = getComputedStyle(canvas).color

    let particles: Particle[] = []
    let raf = 0
    let pointer: { x: number; y: number } | null = null

    function build() {
      const off = document.createElement('canvas')
      off.width = CANVAS_W
      off.height = CANVAS_H
      const octx = off.getContext('2d')
      if (!octx) return
      octx.font = "500 150px 'Geist Pixel Square'"
      octx.textBaseline = 'middle'
      if ('letterSpacing' in octx) {
        ;(octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = octx.measureText('Jetty').width
      const x0 = (CANVAS_W - width) / 2
      octx.lineWidth = 4
      octx.strokeText('Jetty', x0, CANVAS_H / 2)
      octx.fillText('Jetty', x0, CANVAS_H / 2)

      const data = octx.getImageData(0, 0, CANVAS_W, CANVAS_H).data
      particles = []
      for (let y = 0; y < CANVAS_H; y += BLOCK) {
        for (let x = 0; x < CANVAS_W; x += BLOCK) {
          const alpha = data[(y * CANVAS_W + x) * 4 + 3] ?? 0
          if (alpha > 128) particles.push({ hx: x, hy: y, x, y, vx: 0, vy: 0 })
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = color
      for (const p of particles) {
        ctx.fillRect(p.x, p.y, BLOCK - 1, BLOCK - 1)
      }
    }

    function step(): boolean {
      let moving = false
      for (const p of particles) {
        if (pointer) {
          const dx = p.x - pointer.x
          const dy = p.y - pointer.y
          const d = Math.hypot(dx, dy)
          if (d < REPULSE_RADIUS && d > 0.01) {
            const force = ((REPULSE_RADIUS - d) / REPULSE_RADIUS) * 3
            p.vx += (dx / d) * force
            p.vy += (dy / d) * force
          }
        }
        p.vx += (p.hx - p.x) * 0.06
        p.vy += (p.hy - p.y) * 0.06
        p.vx *= 0.82
        p.vy *= 0.82
        p.x += p.vx
        p.y += p.vy
        if (Math.abs(p.x - p.hx) > 0.1 || Math.abs(p.y - p.hy) > 0.1) moving = true
      }
      return moving || pointer !== null
    }

    // rAF runs only while displaced or hovered; settles back to a static frame.
    function loop() {
      const active = step()
      draw()
      raf = active ? requestAnimationFrame(loop) : 0
    }

    function wake() {
      if (raf === 0) raf = requestAnimationFrame(loop)
    }

    function onMove(event: PointerEvent) {
      const rect = cv.getBoundingClientRect()
      pointer = {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      }
      wake()
    }

    function onLeave() {
      pointer = null
      wake()
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      draw()
      if (!reduced) {
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerleave', onLeave)
      }
    })

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label='Jetty'
      style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}
    />
  )
}

function ReflectionMark() {
  return (
    <div className='flex flex-col items-center'>
      <h1 className='text-9xl tracking-[0.15em]' style={markStyle}>
        Jetty
      </h1>
      <div
        aria-hidden
        className='select-none text-9xl tracking-[0.15em]'
        style={{
          ...markStyle,
          transform: 'scaleY(-1)',
          filter: 'url(#jetty-ripple)',
          opacity: 0.3,
          marginTop: '-0.12em',
          maskImage: 'linear-gradient(to top, transparent 15%, black 95%)',
          WebkitMaskImage: 'linear-gradient(to top, transparent 15%, black 95%)',
        }}
      >
        Jetty
      </div>
      <svg width={0} height={0} aria-hidden>
        <filter id='jetty-ripple'>
          <feTurbulence type='turbulence' baseFrequency='0.015 0.07' numOctaves='2' seed='4'>
            <animate
              attributeName='baseFrequency'
              dur='10s'
              values='0.015 0.07;0.02 0.1;0.015 0.07'
              repeatCount='indefinite'
            />
          </feTurbulence>
          <feDisplacementMap in='SourceGraphic' scale='16' />
        </filter>
      </svg>
    </div>
  )
}

function BeaconMark() {
  return (
    <h1
      className='text-9xl tracking-[0.15em]'
      style={{ ...markStyle, animation: 'beacon 5s ease-in-out infinite' }}
    >
      Jetty
    </h1>
  )
}

// Two canvases, one particle array: the reflection mirrors every displaced
// block, so cursor scatter and ripple compose for free.
function CombinedMark() {
  const mainRef = useRef<HTMLCanvasElement>(null)
  const reflRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const main = mainRef.current
    const refl = reflRef.current
    if (!main || !refl) return
    const rawMain = main.getContext('2d')
    const rawRefl = refl.getContext('2d')
    if (!rawMain || !rawRefl) return
    const cv: HTMLCanvasElement = main
    const reflEl: HTMLCanvasElement = refl
    const mctx: CanvasRenderingContext2D = rawMain
    const rctx: CanvasRenderingContext2D = rawRefl

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    for (const c of [main, refl]) {
      c.width = CANVAS_W * dpr
      c.height = CANVAS_H * dpr
    }
    mctx.scale(dpr, dpr)
    rctx.scale(dpr, dpr)
    const color = getComputedStyle(main).color

    let particles: Particle[] = []
    let raf = 0
    let pointer: { x: number; y: number } | null = null

    function build() {
      const off = document.createElement('canvas')
      off.width = CANVAS_W
      off.height = CANVAS_H
      const octx = off.getContext('2d')
      if (!octx) return
      octx.font = "500 150px 'Geist Pixel Square'"
      octx.textBaseline = 'middle'
      if ('letterSpacing' in octx) {
        ;(octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = octx.measureText('Jetty').width
      const x0 = (CANVAS_W - width) / 2
      octx.lineWidth = 4
      octx.strokeText('Jetty', x0, CANVAS_H / 2)
      octx.fillText('Jetty', x0, CANVAS_H / 2)

      const data = octx.getImageData(0, 0, CANVAS_W, CANVAS_H).data
      particles = []
      let maxY = 0
      for (let y = 0; y < CANVAS_H; y += BLOCK) {
        for (let x = 0; x < CANVAS_W; x += BLOCK) {
          const alpha = data[(y * CANVAS_W + x) * 4 + 3] ?? 0
          if (alpha > 128) {
            particles.push({ hx: x, hy: y, x, y, vx: 0, vy: 0 })
            if (y > maxY) maxY = y
          }
        }
      }
      // Snug the reflection up so mirrored glyphs sit just under the originals.
      reflEl.style.marginTop = `${-2 * (CANVAS_H - maxY - BLOCK) + 6}px`
    }

    function draw() {
      mctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      mctx.fillStyle = color
      rctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      rctx.fillStyle = color
      for (const p of particles) {
        mctx.fillRect(p.x, p.y, BLOCK - 1, BLOCK - 1)
        rctx.fillRect(p.x, CANVAS_H - p.y - BLOCK, BLOCK - 1, BLOCK - 1)
      }
    }

    function step(): boolean {
      let moving = false
      for (const p of particles) {
        if (pointer) {
          const dx = p.x - pointer.x
          const dy = p.y - pointer.y
          const d = Math.hypot(dx, dy)
          if (d < REPULSE_RADIUS * 2 && d > 0.01) {
            // Gaussian falloff: no hard rim — influence melts to zero smoothly.
            const sigma = REPULSE_RADIUS * 0.55
            const force = 1.3 * Math.exp(-(d * d) / (2 * sigma * sigma))
            p.vx += (dx / d) * force
            p.vy += (dy / d) * force
          }
        }
        p.vx += (p.hx - p.x) * 0.05
        p.vy += (p.hy - p.y) * 0.05
        p.vx *= 0.68
        p.vy *= 0.68
        p.x += p.vx
        p.y += p.vy
        if (Math.abs(p.x - p.hx) > 0.1 || Math.abs(p.y - p.hy) > 0.1) moving = true
      }
      return moving || pointer !== null
    }

    function loop() {
      const active = step()
      draw()
      raf = active ? requestAnimationFrame(loop) : 0
    }

    function wake() {
      if (raf === 0) raf = requestAnimationFrame(loop)
    }

    function onMove(event: PointerEvent) {
      const rect = cv.getBoundingClientRect()
      pointer = {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      }
      wake()
    }

    function onLeave() {
      pointer = null
      wake()
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      draw()
      if (!reduced) {
        main.addEventListener('pointermove', onMove)
        main.addEventListener('pointerleave', onLeave)
      }
    })

    return () => {
      cancelAnimationFrame(raf)
      main.removeEventListener('pointermove', onMove)
      main.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div className='flex flex-col items-center'>
      <canvas
        ref={mainRef}
        aria-label='Jetty'
        style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}
      />
      <canvas
        ref={reflRef}
        aria-hidden
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          maxWidth: '100%',
          opacity: 0.3,
          pointerEvents: 'none',
          filter: 'url(#jetty-ripple-combined)',
          maskImage: 'linear-gradient(to bottom, black 25%, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 25%, transparent 70%)',
        }}
      />
      <svg width={0} height={0} aria-hidden>
        <filter id='jetty-ripple-combined'>
          <feTurbulence type='turbulence' baseFrequency='0.015 0.07' numOctaves='2' seed='4'>
            <animate
              attributeName='baseFrequency'
              dur='10s'
              values='0.015 0.07;0.02 0.1;0.015 0.07'
              repeatCount='indefinite'
            />
          </feTurbulence>
          <feDisplacementMap in='SourceGraphic' scale='16' />
        </filter>
      </svg>
    </div>
  )
}

// Vercel-hero technique: the glow is a blurred copy of the text itself (light
// leaking from behind), tinted by a slowly rotating conic hue sweep, dusted
// with shimmering grain, with the crisp glyphs occluding the center.
function BacklitMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.scale(dpr, dpr)

    const W = 880
    const H = 480
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const bg = getComputedStyle(document.body).backgroundColor
    let raf = 0
    let theta = 0
    let hot: HTMLCanvasElement | null = null
    let bloom: HTMLCanvasElement | null = null
    let occluder: HTMLCanvasElement | null = null
    let grain: HTMLCanvasElement | null = null

    function makeLayer(): [HTMLCanvasElement, CanvasRenderingContext2D] {
      const layer = document.createElement('canvas')
      layer.width = W
      layer.height = H
      const lctx = layer.getContext('2d')
      if (!lctx) throw new Error('2d context unavailable')
      return [layer, lctx]
    }

    function drawText(target: CanvasRenderingContext2D, fill: string) {
      target.font = "500 150px 'Geist Pixel Square'"
      target.textBaseline = 'middle'
      if ('letterSpacing' in target) {
        ;(target as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = target.measureText('Jetty').width
      const x0 = (W - width) / 2
      target.fillStyle = fill
      target.strokeStyle = fill
      target.lineWidth = 4
      target.strokeText('Jetty', x0, H / 2)
      target.fillText('Jetty', x0, H / 2)
    }

    function build() {
      const [textLayer, tctx] = makeLayer()
      drawText(tctx, '#fff')

      // Hot core: tight blurs stacked additively so the rim clips toward white.
      const [hotLayer, hotCtx] = makeLayer()
      hotCtx.globalCompositeOperation = 'lighter'
      for (const [blur, alpha, times] of [
        [6, 0.9, 2],
        [18, 0.8, 2],
      ] as const) {
        hotCtx.filter = `blur(${blur}px)`
        hotCtx.globalAlpha = alpha
        for (let i = 0; i < times; i++) hotCtx.drawImage(textLayer, 0, 0)
      }
      hot = hotLayer

      // Far bloom: wide additive blurs; this is the layer that takes the hue.
      const [bloomLayer, bloomCtx] = makeLayer()
      bloomCtx.globalCompositeOperation = 'lighter'
      for (const [blur, alpha, times] of [
        [48, 0.85, 2],
        [120, 0.7, 3],
      ] as const) {
        bloomCtx.filter = `blur(${blur}px)`
        bloomCtx.globalAlpha = alpha
        for (let i = 0; i < times; i++) bloomCtx.drawImage(textLayer, 0, 0)
      }
      bloom = bloomLayer

      const [occluderLayer, octx] = makeLayer()
      drawText(octx, bg)
      occluder = occluderLayer

      const [grainLayer, gctx] = makeLayer()
      const noise = gctx.createImageData(W, H)
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = Math.random() * 255
        noise.data[i] = v
        noise.data[i + 1] = v
        noise.data[i + 2] = v
        noise.data[i + 3] = 72
      }
      gctx.putImageData(noise, 0, 0)
      grain = grainLayer
    }

    function frame() {
      if (!hot || !bloom || !occluder || !grain) return
      const [composed, compCtx] = makeLayer()
      compCtx.drawImage(bloom, 0, 0)
      compCtx.globalCompositeOperation = 'source-in'
      const hue = compCtx.createConicGradient(theta, W / 2, H / 2)
      const stops = 6
      for (let i = 0; i <= stops; i++) {
        hue.addColorStop(i / stops, `oklch(0.72 0.26 ${(i / stops) * 360})`)
      }
      compCtx.fillStyle = hue
      compCtx.fillRect(0, 0, W, H)
      // White-hot rim added on top of the tinted bloom — light saturates to white.
      compCtx.globalCompositeOperation = 'lighter'
      compCtx.drawImage(hot, 0, 0)
      compCtx.globalCompositeOperation = 'source-atop'
      compCtx.drawImage(
        grain,
        Math.floor(Math.random() * 24) - 12,
        Math.floor(Math.random() * 24) - 12
      )

      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(composed, 0, 0)
      ctx.drawImage(occluder, 0, 0)
    }

    function loop() {
      theta += 0.004
      frame()
      raf = requestAnimationFrame(loop)
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      frame()
      if (!reduced) {
        // Ambient animation: only run while visible and the tab is foreground.
        const observer = new IntersectionObserver(([entry]) => {
          const visible = (entry?.isIntersecting ?? false) && !document.hidden
          if (visible && raf === 0) raf = requestAnimationFrame(loop)
          if (!visible && raf !== 0) {
            cancelAnimationFrame(raf)
            raf = 0
          }
        })
        observer.observe(canvas)
      }
    })

    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label='Jetty'
      style={{ width: 880, height: 480, maxWidth: '100%' }}
    />
  )
}

type Block = {
  hx: number
  hy: number
  x: number
  y: number
  vx: number
  vy: number
  flicker: number
}

// CRT power-on: blocks fly in from scattered offsets to their home cells while
// their brightness flickers up, settling into the crisp word. Click replays.
function BootAssemblyMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.scale(dpr, dpr)
    const color = getComputedStyle(canvas).color

    let blocks: Block[] = []
    let raf = 0

    function build() {
      const off = document.createElement('canvas')
      off.width = CANVAS_W
      off.height = CANVAS_H
      const octx = off.getContext('2d')
      if (!octx) return
      octx.font = "500 150px 'Geist Pixel Square'"
      octx.textBaseline = 'middle'
      if ('letterSpacing' in octx) {
        ;(octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = octx.measureText('Jetty').width
      const x0 = (CANVAS_W - width) / 2
      octx.lineWidth = 4
      octx.strokeText('Jetty', x0, CANVAS_H / 2)
      octx.fillText('Jetty', x0, CANVAS_H / 2)

      const data = octx.getImageData(0, 0, CANVAS_W, CANVAS_H).data
      blocks = []
      for (let y = 0; y < CANVAS_H; y += BLOCK) {
        for (let x = 0; x < CANVAS_W; x += BLOCK) {
          const alpha = data[(y * CANVAS_W + x) * 4 + 3] ?? 0
          if (alpha > 128) blocks.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, flicker: 1 })
        }
      }
    }

    function scatter() {
      for (const b of blocks) {
        const angle = Math.random() * Math.PI * 2
        const dist = 120 + Math.random() * 220
        b.x = b.hx + Math.cos(angle) * dist
        b.y = b.hy + Math.sin(angle) * dist
        b.vx = 0
        b.vy = 0
        b.flicker = Math.random() * 0.4
      }
    }

    function draw() {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = color
      for (const b of blocks) {
        ctx.globalAlpha = b.flicker
        ctx.fillRect(b.x, b.y, BLOCK - 1, BLOCK - 1)
      }
      ctx.globalAlpha = 1
    }

    function step(): boolean {
      let moving = false
      for (const b of blocks) {
        b.vx += (b.hx - b.x) * 0.08
        b.vy += (b.hy - b.y) * 0.08
        b.vx *= 0.78
        b.vy *= 0.78
        b.x += b.vx
        b.y += b.vy
        const dist = Math.abs(b.x - b.hx) + Math.abs(b.y - b.hy)
        const target = dist > 3 ? 0.3 + Math.random() * 0.55 : 1
        b.flicker += (target - b.flicker) * 0.25
        if (dist > 0.3 || Math.abs(b.flicker - 1) > 0.02) moving = true
      }
      return moving
    }

    function loop() {
      const active = step()
      draw()
      raf = active ? requestAnimationFrame(loop) : 0
    }

    function replay() {
      scatter()
      if (raf === 0) raf = requestAnimationFrame(loop)
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      if (reduced) {
        draw()
        return
      }
      scatter()
      draw()
      raf = requestAnimationFrame(loop)
      canvas.addEventListener('pointerdown', replay)
    })

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', replay)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label='Jetty'
      style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%', cursor: 'pointer' }}
    />
  )
}

// Dim wordmark with a full-brightness copy revealed through a soft radial mask
// that tracks the pointer — pure CSS custom-prop updates, no rAF.
function FlashlightMark() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const node: HTMLDivElement = el

    function onMove(event: PointerEvent) {
      const rect = node.getBoundingClientRect()
      node.style.setProperty('--x', `${event.clientX - rect.left}px`)
      node.style.setProperty('--y', `${event.clientY - rect.top}px`)
    }

    node.addEventListener('pointermove', onMove)
    return () => node.removeEventListener('pointermove', onMove)
  }, [])

  const reveal =
    'radial-gradient(circle 140px at var(--x) var(--y), black 0%, black 35%, transparent 75%)'

  return (
    <div
      ref={ref}
      className='relative'
      style={{ '--x': '50%', '--y': '50%' } as React.CSSProperties}
    >
      <h1 className='text-9xl tracking-[0.15em]' style={{ ...markStyle, opacity: 0.12 }}>
        Jetty
      </h1>
      <h1
        aria-hidden
        className='absolute inset-0 text-9xl tracking-[0.15em]'
        style={{ ...markStyle, maskImage: reveal, WebkitMaskImage: reveal }}
      >
        Jetty
      </h1>
    </div>
  )
}

// Moored-boat bob: each letter rides a slow sine on its own phase.
function TideSwellMark() {
  const letters = [...'Jetty']
  return (
    <h1 className='text-9xl tracking-[0.15em]' style={markStyle} aria-label='Jetty'>
      {letters.map((ch, i) => (
        <span
          key={`${ch}-${i}`}
          aria-hidden
          style={{
            display: 'inline-block',
            animation: `tide-swell 6s ease-in-out ${i * -0.7}s infinite`,
          }}
        >
          {ch}
        </span>
      ))}
    </h1>
  )
}

type Glow = { x: number; y: number; g: number }

const WAKE_RADIUS = 60
const WAKE_BASE = 0.28

// Hand over dock lights: the word is a static block field, but blocks under the
// passing cursor flare to full brightness then decay back to base. No motion.
function WakeTrailMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const cv: HTMLCanvasElement = canvas
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.scale(dpr, dpr)
    const color = getComputedStyle(canvas).color

    let lights: Glow[] = []
    let raf = 0
    let pointer: { x: number; y: number } | null = null

    function build() {
      const off = document.createElement('canvas')
      off.width = CANVAS_W
      off.height = CANVAS_H
      const octx = off.getContext('2d')
      if (!octx) return
      octx.font = "500 150px 'Geist Pixel Square'"
      octx.textBaseline = 'middle'
      if ('letterSpacing' in octx) {
        ;(octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = octx.measureText('Jetty').width
      const x0 = (CANVAS_W - width) / 2
      octx.lineWidth = 4
      octx.strokeText('Jetty', x0, CANVAS_H / 2)
      octx.fillText('Jetty', x0, CANVAS_H / 2)

      const data = octx.getImageData(0, 0, CANVAS_W, CANVAS_H).data
      lights = []
      for (let y = 0; y < CANVAS_H; y += BLOCK) {
        for (let x = 0; x < CANVAS_W; x += BLOCK) {
          const alpha = data[(y * CANVAS_W + x) * 4 + 3] ?? 0
          if (alpha > 128) lights.push({ x, y, g: 0 })
        }
      }
    }

    function draw(fixed: number | null) {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = color
      for (const l of lights) {
        const alpha = fixed ?? WAKE_BASE + l.g * (1 - WAKE_BASE)
        ctx.globalAlpha = alpha
        ctx.fillRect(l.x, l.y, BLOCK - 1, BLOCK - 1)
      }
      ctx.globalAlpha = 1
    }

    function step(): boolean {
      let active = false
      for (const l of lights) {
        if (pointer) {
          const d = Math.hypot(l.x - pointer.x, l.y - pointer.y)
          if (d < WAKE_RADIUS) l.g = Math.min(1, l.g + (WAKE_RADIUS - d) / WAKE_RADIUS)
        }
        l.g *= 0.95
        if (l.g > 0.01) active = true
      }
      return active || pointer !== null
    }

    function loop() {
      const active = step()
      draw(null)
      raf = active ? requestAnimationFrame(loop) : 0
    }

    function wake() {
      if (raf === 0) raf = requestAnimationFrame(loop)
    }

    function onMove(event: PointerEvent) {
      const rect = cv.getBoundingClientRect()
      pointer = {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      }
      wake()
    }

    function onLeave() {
      pointer = null
      wake()
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      if (reduced) {
        draw(0.85)
        return
      }
      draw(null)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerleave', onLeave)
    })

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label='Jetty'
      style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}
    />
  )
}

const DEPTH_LAYERS = [4, 3, 2, 1, 0]

// Extruded pixel slab: stacked copies recede down-right, darker with depth, and
// the whole stack tilts toward the pointer with a short direct-set transition.
function DepthStackMark() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const node: HTMLDivElement = el
    const layers = [...node.querySelectorAll<HTMLElement>('[data-depth]')]

    function onMove(event: PointerEvent) {
      const rect = node.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width - 0.5
      const py = (event.clientY - rect.top) / rect.height - 0.5
      for (const layer of layers) {
        const depth = Number(layer.dataset.depth)
        layer.style.transform = `translate(${px * depth * 9}px, ${py * depth * 9}px)`
      }
    }

    function onLeave() {
      for (const layer of layers) layer.style.transform = 'translate(0px, 0px)'
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div ref={ref} className='relative'>
      {DEPTH_LAYERS.map((depth) => (
        <h1
          key={depth}
          data-depth={depth}
          aria-hidden={depth !== 0}
          className='text-9xl tracking-[0.15em]'
          style={{
            ...markStyle,
            position: depth === 0 ? 'relative' : 'absolute',
            top: depth === 0 ? 0 : depth * 3,
            left: depth === 0 ? 0 : depth * 3,
            zIndex: 10 - depth,
            opacity: 1 - depth * 0.16,
            transition: 'transform 80ms linear',
          }}
        >
          Jetty
        </h1>
      ))}
    </div>
  )
}

// Lighthouse pass: a specular band sweeps across the glyphs via an animated
// gradient clipped to the text; base color reads through when the band is away.
function ScanSweepMark() {
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const base = getComputedStyle(el.parentElement ?? el).color
    el.style.setProperty('--base', base)
  }, [])

  return (
    <h1
      ref={ref}
      className='text-9xl tracking-[0.15em]'
      style={
        {
          fontFamily: "'Geist Pixel Square'",
          '--base': 'rgb(245,245,245)',
          WebkitTextStroke: '2px var(--base)',
          backgroundImage:
            'linear-gradient(100deg, var(--base) 0%, var(--base) 42%, #fff 50%, var(--base) 58%, var(--base) 100%)',
          backgroundSize: '250% 100%',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: 'scan-sweep 5s ease-in-out infinite',
        } as React.CSSProperties
      }
    >
      Jetty
    </h1>
  )
}

type Grain = {
  hx: number
  hy: number
  x: number
  y: number
  vx: number
  vy: number
  alpha: number
  falling: boolean
}

const DISSOLVE_RADIUS = 52

// Melting sand: blocks near the cursor lose cohesion and fall under gravity and
// a light wind, fading out; on pointerleave the whole word springs back home.
function SandDissolveMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const cv: HTMLCanvasElement = canvas
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.scale(dpr, dpr)
    const color = getComputedStyle(canvas).color

    let grains: Grain[] = []
    let raf = 0
    let pointer: { x: number; y: number } | null = null

    function build() {
      const off = document.createElement('canvas')
      off.width = CANVAS_W
      off.height = CANVAS_H
      const octx = off.getContext('2d')
      if (!octx) return
      octx.font = "500 150px 'Geist Pixel Square'"
      octx.textBaseline = 'middle'
      if ('letterSpacing' in octx) {
        ;(octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = octx.measureText('Jetty').width
      const x0 = (CANVAS_W - width) / 2
      octx.lineWidth = 4
      octx.strokeText('Jetty', x0, CANVAS_H / 2)
      octx.fillText('Jetty', x0, CANVAS_H / 2)

      const data = octx.getImageData(0, 0, CANVAS_W, CANVAS_H).data
      grains = []
      for (let y = 0; y < CANVAS_H; y += BLOCK) {
        for (let x = 0; x < CANVAS_W; x += BLOCK) {
          const alpha = data[(y * CANVAS_W + x) * 4 + 3] ?? 0
          if (alpha > 128)
            grains.push({ hx: x, hy: y, x, y, vx: 0, vy: 0, alpha: 1, falling: false })
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = color
      for (const g of grains) {
        ctx.globalAlpha = g.alpha
        ctx.fillRect(g.x, g.y, BLOCK - 1, BLOCK - 1)
      }
      ctx.globalAlpha = 1
    }

    function step(): boolean {
      let active = false
      for (const g of grains) {
        if (pointer && !g.falling) {
          const d = Math.hypot(g.x - pointer.x, g.y - pointer.y)
          if (d < DISSOLVE_RADIUS) {
            g.falling = true
            g.vx = (Math.random() - 0.5) * 1.2
            g.vy = Math.random() * -0.6
          }
        }
        if (!pointer) g.falling = false

        if (g.falling) {
          g.vy += 0.35
          g.vx += 0.06
          g.x += g.vx
          g.y += g.vy
          g.alpha = Math.max(0, g.alpha - 0.016)
          active = true
        } else {
          g.vx += (g.hx - g.x) * 0.08
          g.vy += (g.hy - g.y) * 0.08
          g.vx *= 0.75
          g.vy *= 0.75
          g.x += g.vx
          g.y += g.vy
          g.alpha += (1 - g.alpha) * 0.15
          if (Math.abs(g.x - g.hx) > 0.2 || Math.abs(g.y - g.hy) > 0.2 || g.alpha < 0.99)
            active = true
        }
      }
      return active || pointer !== null
    }

    function loop() {
      const active = step()
      draw()
      raf = active ? requestAnimationFrame(loop) : 0
    }

    function wake() {
      if (raf === 0) raf = requestAnimationFrame(loop)
    }

    function onMove(event: PointerEvent) {
      const rect = cv.getBoundingClientRect()
      pointer = {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      }
      wake()
    }

    function onLeave() {
      pointer = null
      wake()
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      draw()
      if (!reduced) {
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerleave', onLeave)
      }
    })

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label='Jetty'
      style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}
    />
  )
}

const CHROMA = { r: '#ff2b2b', g: '#2bff2b', b: '#2b2bff' } as const

// Lens fringe: pure R/G/B copies screen-blended to white when aligned; cursor
// proximity nudges the red and blue channels apart, settling back when idle.
function ChromaticSplitMark() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const node: HTMLDivElement = el
    const rEl = node.querySelector<HTMLElement>('[data-ch="r"]')
    const bEl = node.querySelector<HTMLElement>('[data-ch="b"]')
    if (!rEl || !bEl) return
    const r: HTMLElement = rEl
    const b: HTMLElement = bEl

    function onMove(event: PointerEvent) {
      const rect = node.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(event.clientX - cx, event.clientY - cy)
      const max = Math.hypot(rect.width / 2, rect.height / 2)
      const offset = Math.max(0, 1 - dist / max) * 6
      r.style.transform = `translateX(${-offset}px)`
      b.style.transform = `translateX(${offset}px)`
    }

    function onLeave() {
      r.style.transform = 'translateX(0px)'
      b.style.transform = 'translateX(0px)'
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <div ref={ref} className='relative'>
      {(['r', 'g', 'b'] as const).map((ch, i) => (
        <h1
          key={ch}
          data-ch={ch}
          aria-hidden={i !== 0}
          className='text-9xl tracking-[0.15em]'
          style={{
            fontFamily: "'Geist Pixel Square'",
            WebkitTextStroke: `2px ${CHROMA[ch]}`,
            color: CHROMA[ch],
            position: i === 0 ? 'relative' : 'absolute',
            inset: i === 0 ? undefined : 0,
            mixBlendMode: 'screen',
            transition: 'transform 120ms ease-out',
          }}
        >
          Jetty
        </h1>
      ))}
    </div>
  )
}

// The word standing at a waterline: its lower band is displaced through a
// turbulence filter so the submerged portion refracts in place.
function WaterlineMark() {
  return (
    <div className='relative'>
      <h1 className='text-9xl tracking-[0.15em]' style={markStyle}>
        Jetty
      </h1>
      <h1
        aria-hidden
        className='absolute inset-0 select-none text-9xl tracking-[0.15em]'
        style={{
          ...markStyle,
          clipPath: 'inset(66% 0 0 0)',
          WebkitClipPath: 'inset(66% 0 0 0)',
          filter: 'url(#jetty-waterline)',
          opacity: 0.85,
        }}
      >
        Jetty
      </h1>
      <svg width={0} height={0} aria-hidden>
        <filter id='jetty-waterline'>
          <feTurbulence type='turbulence' baseFrequency='0.01 0.045' numOctaves='2' seed='7'>
            <animate
              attributeName='baseFrequency'
              dur='8s'
              values='0.01 0.045;0.014 0.06;0.01 0.045'
              repeatCount='indefinite'
            />
          </feTurbulence>
          <feDisplacementMap in='SourceGraphic' scale='12' />
        </filter>
      </svg>
    </div>
  )
}

type Light = { x: number; y: number; lit: boolean; phase: number; period: number }

// Harbor at night: a sparse scatter of the word's blocks twinkle on their own
// phases; hovering swells every block in so the full wordmark surfaces.
function HarborLightsMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    ctx.scale(dpr, dpr)
    const color = getComputedStyle(canvas).color

    let lights: Light[] = []
    let raf = 0
    let reveal = 0
    let target = 0

    function build() {
      const off = document.createElement('canvas')
      off.width = CANVAS_W
      off.height = CANVAS_H
      const octx = off.getContext('2d')
      if (!octx) return
      octx.font = "500 150px 'Geist Pixel Square'"
      octx.textBaseline = 'middle'
      if ('letterSpacing' in octx) {
        ;(octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.15em'
      }
      const width = octx.measureText('Jetty').width
      const x0 = (CANVAS_W - width) / 2
      octx.lineWidth = 4
      octx.strokeText('Jetty', x0, CANVAS_H / 2)
      octx.fillText('Jetty', x0, CANVAS_H / 2)

      const data = octx.getImageData(0, 0, CANVAS_W, CANVAS_H).data
      lights = []
      for (let y = 0; y < CANVAS_H; y += BLOCK) {
        for (let x = 0; x < CANVAS_W; x += BLOCK) {
          const alpha = data[(y * CANVAS_W + x) * 4 + 3] ?? 0
          if (alpha > 128)
            lights.push({
              x,
              y,
              lit: Math.random() < 0.35,
              phase: Math.random() * Math.PI * 2,
              period: 2000 + Math.random() * 3000,
            })
        }
      }
    }

    function draw(now: number, animate: boolean) {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = color
      for (const l of lights) {
        const tw = animate ? 0.5 + 0.5 * Math.sin((now / l.period) * Math.PI * 2 + l.phase) : 0.5
        const sparse = l.lit ? 0.25 + 0.55 * tw : 0
        const full = 0.35 + 0.55 * tw
        ctx.globalAlpha = sparse + (full - sparse) * reveal
        ctx.fillRect(l.x, l.y, BLOCK - 1, BLOCK - 1)
      }
      ctx.globalAlpha = 1
    }

    function loop(now: number) {
      reveal += (target - reveal) * 0.12
      draw(now, true)
      raf = requestAnimationFrame(loop)
    }

    void document.fonts.load("500 150px 'Geist Pixel Square'").then(() => {
      build()
      if (reduced) {
        draw(0, false)
        return
      }
      canvas.addEventListener('pointerenter', () => {
        target = 1
      })
      canvas.addEventListener('pointerleave', () => {
        target = 0
      })
      const observer = new IntersectionObserver(([entry]) => {
        const visible = (entry?.isIntersecting ?? false) && !document.hidden
        if (visible && raf === 0) raf = requestAnimationFrame(loop)
        if (!visible && raf !== 0) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      })
      observer.observe(canvas)
    })

    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-label='Jetty'
      style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: '100%' }}
    />
  )
}

// The composer as the hero occluder: our backlit-bloom engine drawing light
// around a rounded rect, with the real PromptInput sitting inside it.
function GlowComposer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const ctx: CanvasRenderingContext2D = rawCtx

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const W = 1000
    const H = 520
    const BOX_W = 672
    const BOX_H = 160
    const RADIUS = 14
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const bg = getComputedStyle(document.body).backgroundColor
    let raf = 0
    let theta = 0
    let hot: HTMLCanvasElement | null = null
    let bloom: HTMLCanvasElement | null = null
    let grain: HTMLCanvasElement | null = null

    function makeLayer(): [HTMLCanvasElement, CanvasRenderingContext2D] {
      const layer = document.createElement('canvas')
      layer.width = W
      layer.height = H
      const lctx = layer.getContext('2d')
      if (!lctx) throw new Error('2d context unavailable')
      return [layer, lctx]
    }

    function boxPath(target: CanvasRenderingContext2D) {
      target.beginPath()
      target.roundRect((W - BOX_W) / 2, (H - BOX_H) / 2, BOX_W, BOX_H, RADIUS)
    }

    function build() {
      const [shape, sctx] = makeLayer()
      boxPath(sctx)
      sctx.fillStyle = '#fff'
      sctx.fill()

      const [hotLayer, hotCtx] = makeLayer()
      hotCtx.globalCompositeOperation = 'lighter'
      for (const [blur, alpha, times] of [
        [6, 0.9, 2],
        [18, 0.8, 2],
      ] as const) {
        hotCtx.filter = `blur(${blur}px)`
        hotCtx.globalAlpha = alpha
        for (let i = 0; i < times; i++) hotCtx.drawImage(shape, 0, 0)
      }
      hot = hotLayer

      const [bloomLayer, bloomCtx] = makeLayer()
      bloomCtx.globalCompositeOperation = 'lighter'
      for (const [blur, alpha, times] of [
        [48, 0.8, 2],
        [130, 0.65, 3],
      ] as const) {
        bloomCtx.filter = `blur(${blur}px)`
        bloomCtx.globalAlpha = alpha
        for (let i = 0; i < times; i++) bloomCtx.drawImage(shape, 0, 0)
      }
      bloom = bloomLayer

      const [grainLayer, gctx] = makeLayer()
      const noise = gctx.createImageData(W, H)
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = Math.random() * 255
        noise.data[i] = v
        noise.data[i + 1] = v
        noise.data[i + 2] = v
        noise.data[i + 3] = 72
      }
      gctx.putImageData(noise, 0, 0)
      grain = grainLayer
    }

    function frame() {
      if (!hot || !bloom || !grain) return
      const [composed, compCtx] = makeLayer()
      compCtx.drawImage(bloom, 0, 0)
      compCtx.globalCompositeOperation = 'source-in'
      const hue = compCtx.createConicGradient(theta, W / 2, H / 2)
      const stops = 6
      for (let i = 0; i <= stops; i++) {
        hue.addColorStop(i / stops, `oklch(0.72 0.26 ${(i / stops) * 360})`)
      }
      compCtx.fillStyle = hue
      compCtx.fillRect(0, 0, W, H)
      compCtx.globalCompositeOperation = 'lighter'
      compCtx.drawImage(hot, 0, 0)
      compCtx.globalCompositeOperation = 'source-atop'
      compCtx.drawImage(
        grain,
        Math.floor(Math.random() * 24) - 12,
        Math.floor(Math.random() * 24) - 12
      )

      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(composed, 0, 0)
      // Occlude the interior so the glow reads as leaking from behind the box.
      boxPath(ctx)
      ctx.fillStyle = bg
      ctx.fill()
    }

    function loop() {
      theta += 0.004
      frame()
      raf = requestAnimationFrame(loop)
    }

    build()
    frame()
    if (!reduced) {
      const observer = new IntersectionObserver(([entry]) => {
        const visible = (entry?.isIntersecting ?? false) && !document.hidden
        if (visible && raf === 0) raf = requestAnimationFrame(loop)
        if (!visible && raf !== 0) {
          cancelAnimationFrame(raf)
          raf = 0
        }
      })
      observer.observe(canvas)
    }

    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className='relative' style={{ width: 1000, height: 520, maxWidth: '100%' }}>
      <canvas
        ref={canvasRef}
        aria-hidden
        className='absolute inset-0'
        style={{ width: '100%', height: '100%' }}
      />
      <div
        className='absolute'
        style={{ left: (1000 - 672) / 2, top: (520 - 160) / 2, width: 672, height: 160 }}
      >
        <PromptInput onSubmit={() => {}}>
          <PromptInputTextarea placeholder='Message the agent…' />
          <PromptInputFooter>
            <PromptInputSubmit className='ml-auto' status='ready' />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}

function Experiment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className='flex flex-col items-center gap-6'>
      <span className='font-mono text-muted-foreground text-xs uppercase tracking-widest'>
        {label}
      </span>
      {children}
    </section>
  )
}

// Design-pass playground: throwaway experiments only, nothing routes here.
function ScratchpadPage() {
  return (
    <div className='h-full overflow-y-auto'>
      <style>{fontFaces + beaconKeyframes + tideKeyframes + scanKeyframes}</style>
      <div className='flex flex-col items-center gap-24 px-8 py-20'>
        <Experiment label='1 · cursor repulsion'>
          <RepulsionMark />
        </Experiment>
        <Experiment label='2 · rippling reflection'>
          <ReflectionMark />
        </Experiment>
        <Experiment label='3 · beacon glow'>
          <BeaconMark />
        </Experiment>
        <Experiment label='4 · repulsion + reflection'>
          <CombinedMark />
        </Experiment>
        <Experiment label='5 · backlit rainbow (vercel-style)'>
          <BacklitMark />
        </Experiment>
        <Experiment label='6 · boot assembly'>
          <BootAssemblyMark />
        </Experiment>
        <Experiment label='7 · cursor flashlight'>
          <FlashlightMark />
        </Experiment>
        <Experiment label='8 · tide swell'>
          <TideSwellMark />
        </Experiment>
        <Experiment label='9 · wake trail'>
          <WakeTrailMark />
        </Experiment>
        <Experiment label='10 · depth stack'>
          <DepthStackMark />
        </Experiment>
        <Experiment label='11 · scan sweep'>
          <ScanSweepMark />
        </Experiment>
        <Experiment label='12 · sand dissolve'>
          <SandDissolveMark />
        </Experiment>
        <Experiment label='13 · chromatic split'>
          <ChromaticSplitMark />
        </Experiment>
        <Experiment label='14 · waterline'>
          <WaterlineMark />
        </Experiment>
        <Experiment label='15 · harbor lights'>
          <HarborLightsMark />
        </Experiment>
        <Experiment label='16 · the glowing composer'>
          <GlowComposer />
        </Experiment>
        <div className='w-full max-w-2xl'>
          <PromptInput onSubmit={() => {}}>
            <PromptInputTextarea placeholder='Message the agent…' />
            <PromptInputFooter>
              <PromptInputSubmit className='ml-auto' status='ready' />
            </PromptInputFooter>
          </PromptInput>
        </div>
        <div className='flex flex-wrap justify-center gap-6 text-muted-foreground'>
          {PIXEL_VARIANTS.map(([family]) => (
            <span key={family} className='text-xl' style={{ fontFamily: `'${family}'` }}>
              {family.replace('Geist Pixel ', '')}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
