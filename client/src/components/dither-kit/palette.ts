export type Rgb = [number, number, number]

export type DitherColor = 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'red' | 'grey'

export type Seed = { fill: Rgb; line: Rgb; star: Rgb; inner?: Rgb }

// Each seed: the area-fill hue, the bright series line, and the star sparkle.
export const PALETTE: Record<DitherColor, Seed> = {
  green: { fill: [40, 210, 110], line: [150, 255, 180], star: [200, 255, 220] },
  blue: { fill: [53, 143, 243], line: [150, 200, 255], star: [205, 228, 255] },
  purple: {
    fill: [150, 110, 255],
    line: [200, 175, 255],
    star: [225, 210, 255],
  },
  pink: { fill: [240, 90, 190], line: [255, 170, 220], star: [255, 205, 235] },
  orange: {
    fill: [255, 150, 50],
    line: [255, 195, 130],
    star: [255, 220, 175],
  },
  red: { fill: [240, 70, 70], line: [255, 150, 140], star: [255, 195, 185] },
  // No-data: a muted grey so empty metrics read as "nothing here".
  grey: { fill: [92, 92, 100], line: [140, 140, 150], star: [165, 165, 175] },
}

export const rgb = ([r, g, b]: Rgb, k = 1, a = 1) =>
  `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${a})`

let cssProbe: CanvasRenderingContext2D | null | undefined

function cssProbeContext() {
  if (cssProbe !== undefined) return cssProbe
  if (typeof document === 'undefined') {
    cssProbe = null
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  cssProbe = canvas.getContext('2d', { willReadFrequently: true })
  return cssProbe
}

export function rgbFromCss(value: string): Rgb | undefined {
  const ctx = cssProbeContext()
  if (!ctx || !value) return undefined
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const data = ctx.getImageData(0, 0, 1, 1).data
  const r = data[0]
  const g = data[1]
  const b = data[2]
  const a = data[3]
  if (r === undefined || g === undefined || b === undefined || !a) return undefined
  return [r, g, b]
}

export const seedOfColor = (color: DitherColor | Seed): Seed =>
  typeof color === 'string' ? PALETTE[color] : color

export const isDitherColor = (value: unknown): value is DitherColor =>
  typeof value === 'string' && value in PALETTE
