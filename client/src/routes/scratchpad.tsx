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
      <style>{fontFaces + beaconKeyframes}</style>
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
