import { accentChangeEvent } from '@/lib/accent'
import { cn } from '@/lib/utils'
import { useEffect, useRef, type CSSProperties } from 'react'

type Rgb = [number, number, number]

const GRID = 8
const CELL_PX = 4
const CANVAS_PX = GRID * CELL_PX
const ENTRANCE_MS = 600

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16))

const bloomStyle: CSSProperties = {
  filter: 'blur(1px) brightness(1.35) saturate(1.4)',
  opacity: 0.7,
  mixBlendMode: 'plus-lighter',
  imageRendering: 'auto',
}

function bayer4(row: number, col: number) {
  return BAYER4[row & 3]?.[col & 3] ?? 0
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

function fnv1a(str: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function xorshift32(seed: number) {
  let s = seed || 0x9e3779b9
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

function hueFill(hue: number): Rgb {
  const h = ((hue % 360) + 360) % 360
  const s = 0.85
  const l = 0.58
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

let cssProbe: CanvasRenderingContext2D | null | undefined

function rgbFromCss(value: string): Rgb | undefined {
  cssProbe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!cssProbe) return undefined
  cssProbe.clearRect(0, 0, 1, 1)
  cssProbe.fillStyle = '#000'
  cssProbe.fillStyle = value
  cssProbe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = cssProbe.getImageData(0, 0, 1, 1).data
  if (r === undefined || g === undefined || b === undefined || !a) return undefined
  return [r, g, b]
}

type AvatarMirror = 'auto' | 'horizontal' | 'vertical'

type AvatarModel = { on: boolean[]; density: number[]; fill: Rgb }

function avatarModel(name: string, mirror: AvatarMirror): AvatarModel {
  const rand = xorshift32(fnv1a(name))
  const bits = Array.from({ length: 32 }, () => rand() < 0.5)
  const drawnVertical = rand() < 0.5
  const hue = Math.floor(rand() * 180) * 2
  const halfDensity = Array.from({ length: 32 }, () => 0.55 + rand() * 0.45)
  const vertical = mirror === 'auto' ? drawnVertical : mirror === 'vertical'

  const on: boolean[] = []
  const density: number[] = []
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = vertical
        ? Math.min(r, GRID - 1 - r) * GRID + c
        : r * (GRID / 2) + Math.min(c, GRID - 1 - c)
      on.push(bits[i] ?? false)
      density.push(halfDensity[i] ?? 1)
    }
  }
  return { on, density, fill: hueFill(hue) }
}

function paintAvatar(
  canvas: HTMLCanvasElement,
  bloomCanvas: HTMLCanvasElement | null,
  model: AvatarModel,
  animate: boolean,
  getFill?: () => Rgb | undefined
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  canvas.width = CANVAS_PX
  canvas.height = CANVAS_PX
  const bloomCtx = bloomCanvas?.getContext('2d')
  if (bloomCanvas) {
    bloomCanvas.width = CANVAS_PX
    bloomCanvas.height = CANVAS_PX
  }

  const draw = (progress: number) => {
    model.fill = getFill?.() ?? model.fill
    const [r, g, b] = model.fill
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX)
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const cell = row * GRID + col
        if (!model.on[cell]) continue
        const cellAlpha = clamp01((progress - bayer4(row, col) * 0.7) / 0.3)
        if (cellAlpha <= 0) continue
        const density = model.density[cell] ?? 1
        const base = 0.35 + 0.65 * density
        for (let py = 0; py < CELL_PX; py++) {
          for (let px = 0; px < CELL_PX; px++) {
            const x = col * CELL_PX + px
            const y = row * CELL_PX + py
            const lit = density > bayer4(y, x)
            ctx.fillStyle = `rgba(${r},${g},${b},${base * (lit ? 1 : 0.35) * cellAlpha})`
            ctx.fillRect(x, y, 1, 1)
          }
        }
      }
    }
    if (bloomCtx) {
      bloomCtx.clearRect(0, 0, CANVAS_PX, CANVAS_PX)
      bloomCtx.drawImage(canvas, 0, 0)
    }
  }

  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(1)
    return { redraw: () => draw(1), stop() {} }
  }

  let raf = 0
  const startTime = performance.now()
  const tick = (now: number) => {
    const t = clamp01((now - startTime) / ENTRANCE_MS)
    if (!document.hidden) draw(1 - (1 - t) ** 3)
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return { redraw: () => draw(1), stop: () => cancelAnimationFrame(raf) }
}

export function DitherAvatar({
  name,
  color,
  mirror = 'auto',
  bloom = 'off',
  animate = true,
  className,
}: {
  name: string
  color?: string
  mirror?: AvatarMirror
  bloom?: 'off' | 'subtle'
  animate?: boolean
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const getFill = color ? () => rgbFromCss(getComputedStyle(root).color) : undefined
    const paint = paintAvatar(canvas, bloomRef.current, avatarModel(name, mirror), animate, getFill)
    if (!paint || !getFill) return paint?.stop
    window.addEventListener(accentChangeEvent, paint.redraw)
    const observer = new MutationObserver(paint.redraw)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-accent', 'data-accent-from'],
    })
    return () => {
      paint.stop()
      window.removeEventListener(accentChangeEvent, paint.redraw)
      observer.disconnect()
    }
  }, [name, color, mirror, animate, bloom])

  return (
    <div
      ref={rootRef}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a generated canvas avatar; img cannot paint the dither
      role='img'
      aria-label={`${name} avatar`}
      className={cn('relative', className)}
      style={{ color }}
    >
      <canvas ref={canvasRef} className='block size-full' style={{ imageRendering: 'pixelated' }} />
      {bloom === 'subtle' && (
        <canvas
          ref={bloomRef}
          className='pointer-events-none absolute inset-0 size-full'
          style={bloomStyle}
        />
      )}
    </div>
  )
}
