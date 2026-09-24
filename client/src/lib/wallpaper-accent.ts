import { clampChroma, converter, formatCss } from 'culori'

import { notifyAccentChange } from './accent'

const toOklch = converter('oklch')

const sampleSize = 64
const minLightness = 0.18
const maxLightness = 0.88
const minChroma = 0.045
const vividMinChroma = 0.08
const relativeVividFraction = 0.7
const minSamples = 24
const binCount = 24
const binSize = 360 / binCount
const lightTarget = { l: 0.5, c: 0.17 }
const darkTarget = { l: 0.772, c: 0.12 }
const hueStatsWindow = 25
const imageDarkLightnessMin = 0.64
const imageChromaMin = 0.1
const imageChromaMax = 0.2
const monoColorfulFraction = 0.02
const monoMaxChroma = 0.03
const monoLightTarget = 0.42
const monoDarkTarget = 0.96

// Greys take the wallpaper's hue at up to this chroma, scaled by how colourful it is.
const maxTint = 0.014
const tintFullColorfulness = 0.12

type OklchSample = { l: number; c: number; h: number }
type AccentTokens = { light: string; dark: string; tint: { c: number; h: number } }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function chromaWeightedHue(samples: OklchSample[]) {
  let sin = 0
  let cos = 0
  let weight = 0
  for (const sample of samples) {
    const radians = (sample.h * Math.PI) / 180
    sin += Math.sin(radians) * sample.c
    cos += Math.cos(radians) * sample.c
    weight += sample.c
  }
  const hue = Math.atan2(sin / weight, cos / weight) * (180 / Math.PI)
  return hue < 0 ? hue + 360 : hue
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function samplePixels(image: HTMLImageElement): OklchSample[] {
  const srcW = image.naturalWidth
  const srcH = image.naturalHeight
  if (!srcW || !srcH) return []
  const scale = sampleSize / Math.max(srcW, srcH)
  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)
  const samples: OklchSample[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 16) continue
    const color = toOklch({
      mode: 'rgb',
      r: data[i]! / 255,
      g: data[i + 1]! / 255,
      b: data[i + 2]! / 255,
    })
    // Achromatic pixels have no hue; keep them so monochrome detection sees the whole image.
    samples.push({ l: color.l, c: color.c, h: color.h ?? 0 })
  }
  return samples
}

function pickHue(samples: OklchSample[]) {
  if (samples.length === 0) return null
  const chromas = samples.map((sample) => sample.c).sort((a, b) => b - a)
  const p99Chroma = chromas[Math.min(chromas.length - 1, Math.floor(chromas.length * 0.01))]!
  const floor = Math.max(vividMinChroma, p99Chroma * relativeVividFraction)
  const vivid = samples.filter((sample) => sample.c >= floor)
  if (vivid.length < minSamples) return null
  const bins: OklchSample[][] = Array.from({ length: binCount }, () => [])
  for (const sample of vivid)
    bins[Math.min(binCount - 1, Math.floor(sample.h / binSize))]!.push(sample)
  const largest = bins.reduce((best, bin) => (bin.length > best.length ? bin : best))
  return chromaWeightedHue(largest)
}

function token(lightness: number, chroma: number, hue: number) {
  return formatCss(clampChroma({ mode: 'oklch', l: lightness, c: chroma, h: hue }, 'oklch', 'rgb'))
}

function hueToTokens(hue: number, samples: OklchSample[]): Omit<AccentTokens, 'tint'> {
  const nearby = samples.filter((sample) => hueDistance(sample.h, hue) <= hueStatsWindow)
  const weight = nearby.reduce((sum, sample) => sum + sample.c, 0)
  const chroma = nearby.reduce((sum, sample) => sum + sample.c * sample.c, 0) / weight
  const depth = clamp((chroma - imageChromaMin) / (imageChromaMax - imageChromaMin), 0, 1)
  return {
    light: token(lightTarget.l, lightTarget.c, hue),
    dark: token(
      darkTarget.l - depth * (darkTarget.l - imageDarkLightnessMin),
      clamp(chroma, darkTarget.c, imageChromaMax),
      hue
    ),
  }
}

function tintFor(hue: number, samples: OklchSample[]) {
  const colorfulness = samples.reduce((sum, sample) => sum + sample.c, 0) / samples.length
  // Low-chroma yellows and greens read as dirty rather than tinted.
  const damping = hue >= 70 && hue <= 160 ? 0.6 : 1
  return { h: hue, c: clamp(colorfulness / tintFullColorfulness, 0, 1) * maxTint * damping }
}

function monochromeTint(all: OklchSample[], kept: OklchSample[]) {
  const colorful = kept.filter((sample) => sample.c >= vividMinChroma).length
  if (colorful >= minSamples && colorful / all.length >= monoColorfulFraction) return null
  const brightest = [...all]
    .sort((a, b) => b.l - a.l)
    .slice(0, Math.max(8, Math.round(all.length * 0.05)))
  const c = Math.min(
    monoMaxChroma,
    brightest.reduce((sum, sample) => sum + sample.c, 0) / brightest.length
  )
  return c > 0.004 ? { c, h: chromaWeightedHue(brightest) } : { c: 0, h: 0 }
}

function pickAccent(all: OklchSample[]): AccentTokens | null {
  if (all.length === 0) return null
  const kept = all.filter(
    (sample) => sample.l >= minLightness && sample.l <= maxLightness && sample.c >= minChroma
  )
  const tint = monochromeTint(all, kept)
  if (tint)
    return {
      tint: { h: tint.h, c: Math.min(tint.c, maxTint) * 0.5 },
      light: token(monoLightTarget, tint.c, tint.h),
      dark: token(monoDarkTarget, tint.c, tint.h),
    }
  const hue = pickHue(kept)
  return hue === null ? null : { ...hueToTokens(hue, kept), tint: tintFor(hue, all) }
}

export function applyWallpaperAccent(image: HTMLImageElement) {
  const tokens = pickAccent(samplePixels(image))
  if (!tokens) return false
  const root = document.documentElement
  root.style.setProperty('--accent-primary-light', tokens.light)
  root.style.setProperty('--accent-primary-dark', tokens.dark)
  root.style.setProperty('--tint-h', String(tokens.tint.h))
  root.style.setProperty('--tint-c', String(tokens.tint.c))
  root.dataset.accentFrom = 'wallpaper'
  notifyAccentChange()
  return true
}
