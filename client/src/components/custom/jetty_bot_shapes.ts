// States, bodies, faces, and colours for the Jetty bot. Geometry lives in a 100×100 box.

import type { BotColor, BotShape } from '@jetty/shared/wire'

export type { BotColor, BotShape }

// Tidying is the one wait you can see while it compacts its memory: you wrote mid-compaction and it
// couldn't stop.
export type BotState = 'idle' | 'thinking' | 'working' | 'waiting' | 'done' | 'tidying'

type Point = [number, number]
export type Body = {
  d?: string
  circles?: [number, number, number][]
  face: { x: number; y: number; s: number }
}

const round = (n: number) => Math.round(n * 100) / 100
const at = (p: Point) => `${round(p[0])} ${round(p[1])}`
const toward = (from: Point, to: Point, r: number): Point => {
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    len = Math.hypot(dx, dy)
  return [from[0] + (dx / len) * r, from[1] + (dy / len) * r]
}

/** A polygon with soft quadratic corners; r is how far each corner is cut back. */
function softPolygon(points: Point[], r: number) {
  return (
    points
      .map((p, i) => {
        const a = toward(p, points[(i - 1 + points.length) % points.length]!, r)
        const b = toward(p, points[(i + 1) % points.length]!, r)
        return `${i === 0 ? 'M' : 'L'}${at(a)} Q${at(p)} ${at(b)}`
      })
      .join(' ') + ' Z'
  )
}

function ring(n: number, radius: number, cx: number, cy: number, offset: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = offset + (i / n) * Math.PI * 2
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]
  })
}

/** A jelly bean: a capsule bent along an arc. Its spine passes through (cx, cy) bulging toward the angle
 * up (-π/2 is straight up), on a circle of radius bend, span radians either side; w is half its thickness. */
function bean(cx: number, cy: number, bend: number, span: number, w: number, up = -Math.PI / 2) {
  const ox = cx - Math.cos(up) * bend,
    oy = cy - Math.sin(up) * bend
  const p = (r: number, a: number) => at([ox + Math.cos(a) * r, oy + Math.sin(a) * r])
  const a0 = up - span,
    a1 = up + span,
    outer = bend + w,
    inner = bend - w
  return `M${p(outer, a0)} A${outer} ${outer} 0 0 1 ${p(outer, a1)} A${w} ${w} 0 0 1 ${p(inner, a1)} A${inner} ${inner} 0 0 0 ${p(inner, a0)} A${w} ${w} 0 0 1 ${p(outer, a0)} Z`
}

function star(n: number, outer: number, inner: number, cx: number, cy: number): Point[] {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n,
      r = i % 2 ? inner : outer
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}

function squircle(cx: number, cy: number, a: number, n = 4.6) {
  return (
    Array.from({ length: 72 }, (_, i) => {
      const t = (i / 72) * Math.PI * 2,
        c = Math.cos(t),
        s = Math.sin(t)
      const p: Point = [
        cx + a * Math.sign(c) * Math.abs(c) ** (2 / n),
        cy + a * Math.sign(s) * Math.abs(s) ** (2 / n),
      ]
      return `${i === 0 ? 'M' : 'L'}${at(p)}`
    }).join(' ') + ' Z'
  )
}

// Faces sit a little below each body's middle, which reads younger and friendlier.
export const botShapes = {
  circle: { circles: [[50, 51, 40]], face: { x: 50, y: 57, s: 1 } },
  squircle: { d: squircle(50, 51, 39), face: { x: 50, y: 57, s: 1 } },
  drop: {
    d: 'M50 9 C61 25 85 39 85 61 A35 35 0 1 1 15 61 C15 39 39 25 50 9 Z',
    face: { x: 50, y: 69, s: 1 },
  },
  cloud: {
    circles: [
      [37, 44, 21],
      [62, 40, 23],
      [27, 63, 19],
      [73, 62, 19],
      [50, 66, 23],
    ],
    face: { x: 50, y: 62, s: 1 },
  },
  flower: {
    circles: [
      ...ring(5, 23, 50, 52, -Math.PI / 2).map(([x, y]) => [x, y, 17] as [number, number, number]),
      [50, 52, 27],
    ],
    face: { x: 50, y: 59, s: 0.94 },
  },
  hex: { d: softPolygon(ring(6, 45, 50, 51, -Math.PI / 2), 13), face: { x: 50, y: 58, s: 1 } },
  tri: {
    d: softPolygon(
      [
        [50, 10],
        [93, 85],
        [7, 85],
      ],
      17
    ),
    face: { x: 50, y: 69, s: 0.92 },
  },
  tablet: {
    d: 'M10 51 C10 35 22 27 38 27 L62 27 C78 27 90 35 90 51 C90 67 78 75 62 75 L38 75 C22 75 10 67 10 51 Z',
    face: { x: 50, y: 57, s: 0.9 },
  },
  // Beyond Grok Bot's set.
  gumdrop: {
    d: 'M10 80 C10 44 28 24 50 24 C72 24 90 44 90 80 Q90 88 82 88 H18 Q10 88 10 80 Z',
    face: { x: 50, y: 62, s: 1 },
  },
  burst: {
    circles: [
      ...ring(12, 33, 50, 51, -Math.PI / 2).map(
        ([x, y]) => [x, y, 9.5] as [number, number, number]
      ),
      [50, 51, 35],
    ],
    face: { x: 50, y: 57, s: 0.95 },
  },
  star: { d: softPolygon(star(5, 46, 24, 50, 54), 7), face: { x: 50, y: 58, s: 0.85 } },
  // A jelly bean on its belly, the dent on top and its ends curling up.
  bean: { d: bean(50, 64, 50, 0.46, 24, Math.PI / 2), face: { x: 50, y: 63, s: 1 } },
  // A sheet ghost: a round head flaring gently out to a soft scalloped hem.
  ghost: {
    d: 'M50 14 C66 14 76 26 76 42 C76 58 80 70 85 82 C80 90 75 90 70 85 C65 90 57 92 50 86 C43 92 35 90 30 85 C25 90 20 90 15 82 C20 70 24 58 24 42 C24 26 34 14 50 14 Z',
    face: { x: 50, y: 50, s: 0.95 },
  },
  // A puffy heart: wide, full lobes over a shallow dip, and a blunt tip that sits on the ground.
  heart: {
    d: 'M50 25 C55 17 63 14 71 14 C85 14 94 25 94 41 C94 60 80 73 65 83.5 C59 88.5 55 91.5 50 91.5 C45 91.5 41 88.5 35 83.5 C20 73 6 60 6 41 C6 25 15 14 29 14 C37 14 45 17 50 25 Z',
    face: { x: 50, y: 54, s: 1 },
  },
} satisfies Record<BotShape, Body>

export const shapeIds = Object.keys(botShapes) as BotShape[]

// One palette with the accents: the five accent colours use the accent's exact dark-theme value,
// so a bot and an accent of the same name match. Coral, butter, mint and the greys are bot-only.
export const botColors = {
  accent: 'var(--bot-accent-body)',
  coral: 'oklch(0.74 0.16 32)',
  orange: 'oklch(0.772 0.13 60)',
  butter: 'oklch(0.86 0.13 95)',
  mint: 'oklch(0.80 0.13 158)',
  teal: 'oklch(0.772 0.105 185)',
  blue: 'oklch(0.772 0.11 255)',
  lilac: 'oklch(0.772 0.119 282.178)',
  rose: 'oklch(0.772 0.12 355)',
  cloud: 'oklch(0.933 0 0)',
  slate: 'oklch(0.772 0.015 260)',
} as const satisfies Record<BotColor, string>

export const colorIds = Object.keys(botColors) as BotColor[]

// In light mode each face takes its colour's deep ink (the accent's own
// for the five shared colours) and the eyes go light. Dark keeps botColors.
export const deepBotColors = {
  accent: 'var(--bot-accent-deep)',
  coral: 'oklch(0.52 0.16 32)',
  orange: 'oklch(0.49 0.13 50)',
  butter: 'oklch(0.52 0.10 90)',
  mint: 'oklch(0.52 0.12 158)',
  teal: 'oklch(0.49 0.085 185)',
  blue: 'oklch(0.50 0.17 255)',
  lilac: 'oklch(0.50 0.18 282.178)',
  rose: 'oklch(0.50 0.18 355)',
  cloud: 'oklch(0.25 0 0)',
  slate: 'oklch(0.50 0.015 260)',
} satisfies Record<BotColor, string>
