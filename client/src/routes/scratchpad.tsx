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
