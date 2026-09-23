import { cn } from '@/lib/utils'

import './avatar.css'
import { useEffect, useRef } from 'react'

import { rgb, rgbFromCss, type Rgb } from './palette'
import {
  bayer4,
  clamp01,
  fnv1a,
  hueFill,
  type PixelBloom,
  pixelBloomStyle,
  pixelPrefersReducedMotion,
  xorshift32,
} from './pixel'

// 8×8 cells, mirrored across one axis → 32 free pattern bits. With the mirror
// axis bit and 180 hues that's 2^33 × 180 ≈ 1.5 trillion distinct avatars.
const GRID = 8
const CELL_PX = 4 // backing px per cell → a 32×32 canvas, scaled up pixelated

export type AvatarIdleMotion =
  | 'none'
  | 'shimmer'
  | 'ripple'
  | 'twitch'
  | 'drift'
  | 'swirl'
  | 'materialize'

export type AvatarMirror = 'auto' | 'horizontal' | 'vertical'

export type DitherAvatarProps = {
  /** The seed — same name, same avatar, every time. */
  name: string
  /** Hue override (0–360). Derived from the name when omitted. Ignored when `color` is set. */
  hue?: number
  /** CSS color for the dither fill (e.g. `var(--primary)`). Overrides `hue`. */
  color?: string
  /** Mirror axis. "auto" picks one from the name — half the avatars fold
   * left/right, half fold top/bottom. */
  mirror?: AvatarMirror
  /** Square size in px. Omit to size via className (e.g. `size-12`). */
  size?: number
  /** Glow on the dither fill. */
  bloom?: PixelBloom
  pulse?: boolean
  idleMotion?: AvatarIdleMotion
  /** Play the Bayer-ordered materialize entrance. */
  animate?: boolean
  animationDuration?: number
  /** Bump to replay the entrance. */
  replayToken?: number
  className?: string
}

type AvatarModel = {
  seed: number
  vertical: boolean
  on: boolean[] // GRID×GRID, row-major
  density: number[] // per-cell dither density for on cells
  fill: [number, number, number]
}

/**
 * Derive the full 8×8 cell grid from the name: 32 pattern bits + the mirror
 * axis + the hue + per-cell densities, all from one deterministic PRNG stream.
 * Every draw happens unconditionally so overriding `hue` or `mirror` never
 * shifts the pattern.
 */
function avatarModel(
  name: string,
  hueProp: number | undefined,
  mirrorProp: AvatarMirror
): AvatarModel {
  const rand = xorshift32(fnv1a(name))
  const bits = Array.from({ length: 32 }, () => rand() < 0.5)
  const drawnVertical = rand() < 0.5
  const drawnHue = Math.floor(rand() * 180) * 2
  const halfDensity = Array.from({ length: 32 }, () => 0.55 + rand() * 0.45)

  const vertical = mirrorProp === 'auto' ? drawnVertical : mirrorProp === 'vertical'
  const hue = hueProp ?? drawnHue

  const on = Array.from({ length: GRID * GRID }, () => false)
  const density = Array.from({ length: GRID * GRID }, () => 1)
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      // Fold across the chosen axis: left/right symmetric ("horizontal"
      // mirror) or top/bottom symmetric ("vertical").
      const i = vertical
        ? Math.min(r, GRID - 1 - r) * GRID + c
        : r * (GRID / 2) + Math.min(c, GRID - 1 - c)
      on[r * GRID + c] = bits[i] ?? false
      density[r * GRID + c] = halfDensity[i] ?? 1
    }
  }
  return { on, density, fill: hueFill(hue), vertical, seed: fnv1a(name) }
}

function swirlThreshold(x: number, y: number, seconds: number, seed: number): number {
  const time = Math.floor(seconds * 8) / 8
  const phase = (seed % 628) / 100
  const cx = x - 15.5 - 2 * Math.sin(time * 0.19 + phase)
  const cy = y - 15.5 - 2 * Math.cos(time * 0.23 + phase)
  const radius = Math.hypot(cx, cy)
  const angle = time * 0.16 + radius * 0.035 * Math.sin(time * 0.13 + phase)
  const u = Math.floor(cx * Math.cos(angle) - cy * Math.sin(angle) + time * 0.37)
  const v = Math.floor(cx * Math.sin(angle) + cy * Math.cos(angle) + time * 0.29)
  let hash = Math.imul(u, 374761393) ^ Math.imul(v, 668265263) ^ seed
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  const noise = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
  return bayer4(v, u) * 0.65 + noise * 0.35
}

/**
 * Paint the avatar, optionally sweeping cells in with the Bayer-ordered
 * materialize entrance. Lives outside the component (same shape as the chart
 * canvases). Returns a cleanup that cancels the entrance loop.
 */
function paintAvatar(
  canvas: HTMLCanvasElement,
  bloomCanvas: HTMLCanvasElement | null,
  model: AvatarModel,
  animate: boolean,
  duration: number,
  idleMotion: AvatarIdleMotion,
  getFill?: () => Rgb | undefined
): { redraw: () => void; stop: () => void } | undefined {
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  const px = GRID * CELL_PX
  canvas.width = px
  canvas.height = px
  const bloomCtx = bloomCanvas?.getContext('2d') ?? null
  if (bloomCanvas) {
    bloomCanvas.width = px
    bloomCanvas.height = px
  }

  const activePairs = [
    ...new Set(
      model.on.flatMap((on, index) => {
        if (!on) return []
        const r = Math.floor(index / GRID)
        const c = index % GRID
        return [model.vertical ? Math.min(r, 7 - r) * 8 + c : r * 4 + Math.min(c, 7 - c)]
      })
    ),
  ]

  const materializeOrder = model.on
    .flatMap((on, index) => (on ? [index] : []))
    .sort((a, b) => {
      const rank = (index: number) => bayer4(Math.floor(index / GRID), index)
      return rank(a) - rank(b) || a - b
    })

  const draw = (progress: number, seconds = 0) => {
    const live = getFill?.()
    if (live) model.fill = live
    const groupCount = Math.ceil(materializeOrder.length / 3)
    const group = Math.floor((seconds / 3.6) * groupCount) % groupCount
    const hiddenBlocks =
      idleMotion === 'materialize' && seconds > 0
        ? new Set(materializeOrder.slice(group * 3, group * 3 + 3))
        : new Set<number>()
    ctx.clearRect(0, 0, px, px)
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (!model.on[r * GRID + c]) continue
        // Cells materialize in Bayer order — the entrance is made of the same
        // matrix as the texture.
        const start = bayer4(r, c) * 0.7
        const materialize = hiddenBlocks.has(r * GRID + c) ? 0 : 1
        const cellAlpha = clamp01((progress - start) / 0.3) * materialize
        if (cellAlpha <= 0) continue
        const pair = model.vertical ? Math.min(r, 7 - r) * 8 + c : r * 4 + Math.min(c, 7 - c)
        const cycle = seconds % 4.5
        const twitch =
          idleMotion === 'twitch' &&
          cycle > 3.4 &&
          cycle < 3.65 &&
          pair === activePairs[Math.floor(seconds / 4.5) % activePairs.length]
        const dx = twitch && !model.vertical ? (c < 4 ? 1 : -1) : 0
        const dy = twitch && model.vertical ? (r < 4 ? 1 : -1) : 0
        const density = model.density[r * GRID + c] ?? 1
        const base = 0.35 + 0.65 * density
        for (let py = 0; py < CELL_PX; py++) {
          for (let pxi = 0; pxi < CELL_PX; pxi++) {
            const gx = c * CELL_PX + pxi
            const gy = r * CELL_PX + py
            const drift = idleMotion === 'drift' ? Math.floor(seconds * 5) : 0
            const threshold =
              idleMotion === 'swirl'
                ? swirlThreshold(gx, gy, seconds, model.seed)
                : bayer4(gy - drift, gx - drift)
            const shimmerEnvelope = Math.max(0, Math.sin((seconds * Math.PI) / 4)) ** 2
            const shimmer = 0.12 * shimmerEnvelope * Math.sin(seconds * 2 + gx * 0.8 + gy * 1.3)
            const waveDistance = gy / px - (((seconds % 5) / 3) * 1.8 - 0.4)
            const ripple = 0.2 * Math.exp((-waveDistance * waveDistance) / 0.012)
            const modulation =
              idleMotion === 'shimmer' ? shimmer : idleMotion === 'ripple' ? ripple : 0
            const lit =
              idleMotion === 'shimmer' || idleMotion === 'ripple'
                ? clamp01((density + modulation - threshold) / 0.08 + 0.5)
                : Number(density > threshold)
            // On/off cells modulate alpha tiers of the one fill colour, so the
            // avatar holds up on light and dark backgrounds alike.
            const alpha = base * (0.35 + 0.65 * lit) * cellAlpha
            ctx.fillStyle = rgb(model.fill, 1, alpha)
            ctx.fillRect(gx + dx, gy + dy, 1, 1)
          }
        }
      }
    }
    if (bloomCtx) {
      bloomCtx.clearRect(0, 0, px, px)
      bloomCtx.drawImage(canvas, 0, 0)
    }
  }

  if ((!animate && idleMotion === 'none') || pixelPrefersReducedMotion()) {
    draw(1)
    return { redraw: () => draw(1), stop() {} }
  }

  let raf = 0
  const startTime = performance.now()
  const tick = (now: number) => {
    const elapsed = now - startTime
    const t = animate ? clamp01(elapsed / Math.max(1, duration)) : 1
    if (!document.hidden)
      draw(1 - (1 - t) ** 3, Math.max(0, elapsed - (animate ? duration : 0)) / 1000)
    if (t < 1 || idleMotion !== 'none') raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return { redraw: () => draw(1), stop: () => cancelAnimationFrame(raf) }
}

/**
 * Generative dithered avatar — a mirrored 8×8 pixel glyph derived from a name,
 * rendered with the ordered-dither texture the charts are made of. Same name,
 * same avatar; ~1.5 trillion combinations across pattern, mirror axis, and hue.
 */
export function DitherAvatar({
  name,
  hue,
  color,
  mirror = 'auto',
  size,
  bloom = 'off',
  pulse = false,
  idleMotion = 'none',
  animate = true,
  animationDuration = 600,
  replayToken = 0,
  className,
}: DitherAvatarProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas) return
    const model = avatarModel(name, hue, mirror)
    const getFill = color && root ? () => rgbFromCss(getComputedStyle(root).color) : undefined
    const paint = paintAvatar(
      canvas,
      bloomRef.current,
      model,
      animate,
      animationDuration,
      idleMotion,
      getFill
    )
    if (!paint || !getFill) return paint?.stop
    const onTokenChange = () => paint.redraw()
    window.addEventListener('jetty-accent', onTokenChange)
    const observer = new MutationObserver(onTokenChange)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-accent', 'data-accent-from'],
    })
    return () => {
      paint.stop()
      window.removeEventListener('jetty-accent', onTokenChange)
      observer.disconnect()
    }
  }, [name, hue, color, mirror, animate, animationDuration, replayToken, bloom, idleMotion])

  const bloomStyle = pixelBloomStyle(bloom)

  return (
    <div
      ref={rootRef}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a generated canvas avatar; img cannot paint the dither
      role='img'
      aria-label={`${name} avatar`}
      className={cn('relative', className)}
      style={{ color, ...(size != null ? { width: size, height: size } : undefined) }}
    >
      <canvas
        ref={canvasRef}
        className='block size-full'
        style={{ imageRendering: 'pixelated', filter: 'var(--avatar-ink-filter, none)' }}
      />
      {bloomStyle && (
        <canvas
          ref={bloomRef}
          className={cn(
            'pointer-events-none absolute inset-0 size-full',
            pulse && 'dither-avatar-pulse'
          )}
          style={bloomStyle}
        />
      )}
    </div>
  )
}
