import { clampChroma, converter, formatCss } from 'culori'

import { notifyAccentChange } from './accent'

/**
 * Derives the app's primary accent from a wallpaper.
 *
 * 1. Downsample the source image to ~64px and convert every pixel to OKLCH.
 * 2. If almost nothing is colourful, treat it as monochrome and use the
 *    image's own "white" (near-white, faintly tinted; pure white for black).
 * 3. Otherwise keep the pixels that are neither too dark, too bright nor too
 *    grey, then keep only those close to the image's *own* peak saturation, and
 *    take the hue of the largest 15° bucket among them ("the most saturated
 *    thing in the picture, by area").
 * 4. Build tokens: light mode uses a fixed recipe; dark mode gets deeper and
 *    more saturated the more vivid the picked colour is, so a strong red lands
 *    on crimson instead of salmon.
 */

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
// How far the dark-mode accent may follow the wallpaper's saturation.
const hueStatsWindow = 25
const imageDarkLightnessMin = 0.64
const imageChromaMin = 0.1
const imageChromaMax = 0.2
// Below this share of clearly-coloured pixels the image is treated as monochrome.
const monoColorfulFraction = 0.02
const monoMaxChroma = 0.03
const monoLightTarget = 0.42
const monoDarkTarget = 0.96

export type OklchSample = { l: number; c: number; h: number }
export type AccentTokens = { light: string; dark: string }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function circularMean(
  samples: OklchSample[],
  weightOf: (sample: OklchSample) => number,
  minCount = minSamples
) {
  let sin = 0
  let cos = 0
  let weight = 0
  let count = 0
  for (const sample of samples) {
    const amount = weightOf(sample)
    if (amount <= 0) continue
    const radians = (sample.h * Math.PI) / 180
    sin += Math.sin(radians) * amount
    cos += Math.cos(radians) * amount
    weight += amount
    count += 1
  }
  if (count < minCount || weight === 0) return null
  const hue = Math.atan2(sin / weight, cos / weight) * (180 / Math.PI)
  return hue < 0 ? hue + 360 : hue
}

function hueBin(hue: number) {
  const wrapped = ((hue % 360) + 360) % 360
  return Math.min(binCount - 1, Math.floor(wrapped / binSize))
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function samplePixels(image: HTMLImageElement): OklchSample[] {
  const srcW = image.naturalWidth
  const srcH = image.naturalHeight
  if (!srcW || !srcH) return []
  const scale = sampleSize / Math.max(srcW, srcH)
  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(image, 0, 0, width, height)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, width, height).data
  } catch {
    return []
  }
  const samples: OklchSample[] = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 16) continue
    const color = toOklch({
      mode: 'rgb',
      r: data[i]! / 255,
      g: data[i + 1]! / 255,
      b: data[i + 2]! / 255,
    })
    if (!color || color.l == null || color.c == null) continue
    // Achromatic pixels have no hue; keep them so monochrome detection sees the whole image.
    samples.push({ l: color.l, c: color.c, h: color.h ?? 0 })
  }
  return samples
}

function filterSamples(samples: OklchSample[]) {
  return samples.filter(
    (sample) => sample.l >= minLightness && sample.l <= maxLightness && sample.c >= minChroma
  )
}

/** Hue of the largest 15° bucket among samples near the image's own peak chroma. */
function pickHue(samples: OklchSample[]) {
  if (samples.length === 0) return null
  const sorted = samples.map((sample) => sample.c).sort((a, b) => b - a)
  // 99th percentile rather than the max so a few stray pixels can't set the bar.
  const peak = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.01))]!
  const floor = Math.max(vividMinChroma, peak * relativeVividFraction)
  const vivid = samples.filter((sample) => sample.c >= floor)
  if (vivid.length < minSamples) return null
  const bins: OklchSample[][] = Array.from({ length: binCount }, () => [])
  for (const sample of vivid) bins[hueBin(sample.h)]!.push(sample)
  let best = 0
  for (let i = 1; i < binCount; i++) {
    if (bins[i]!.length > bins[best]!.length) best = i
  }
  if (bins[best]!.length === 0) return null
  return circularMean(bins[best]!, (sample) => sample.c, 1)
}

/** Chroma-weighted mean lightness and chroma of the samples sharing the picked hue. */
function hueStats(samples: OklchSample[], hue: number) {
  let weight = 0
  let l = 0
  let c = 0
  for (const sample of samples) {
    if (hueDistance(sample.h, hue) > hueStatsWindow) continue
    weight += sample.c
    l += sample.l * sample.c
    c += sample.c * sample.c
  }
  if (weight === 0) return null
  return { l: l / weight, c: c / weight }
}

function token(lightness: number, chroma: number, hue: number) {
  return (
    formatCss(clampChroma({ mode: 'oklch', l: lightness, c: chroma, h: hue }, 'oklch', 'rgb')) ??
    `oklch(${lightness} ${chroma} ${hue})`
  )
}

export function hueToTokens(hue: number, samples: OklchSample[]): AccentTokens {
  const stats = hueStats(samples, hue)
  const light = token(lightTarget.l, lightTarget.c, hue)
  if (!stats) return { light, dark: token(darkTarget.l, darkTarget.c, hue) }
  // The more saturated the wallpaper's colour, the deeper the dark-mode accent
  // may go: a vivid red at the preset lightness reads as pink, a muted ochre
  // is fine where it is. Light mode already reads well at the fixed recipe.
  const depth = clamp((stats.c - imageChromaMin) / (imageChromaMax - imageChromaMin), 0, 1)
  return {
    light,
    dark: token(
      darkTarget.l - depth * (darkTarget.l - imageDarkLightnessMin),
      clamp(stats.c, darkTarget.c, imageChromaMax),
      hue
    ),
  }
}

/**
 * An image counts as monochrome when almost none of it clears the chroma
 * floor. The accent then becomes the image's own "white": the hue and (tiny)
 * chroma of its brightest pixels, pushed up to near-white. A pure black image
 * has no tint at all, so it lands on pure white.
 */
function monochromeTint(all: OklchSample[], kept: OklchSample[]) {
  if (all.length === 0) return null
  const colorful = kept.filter((sample) => sample.c >= vividMinChroma).length
  if (colorful >= minSamples && colorful / all.length >= monoColorfulFraction) return null
  const brightest = [...all]
    .sort((a, b) => b.l - a.l)
    .slice(0, Math.max(8, Math.round(all.length * 0.05)))
  const c = Math.min(
    monoMaxChroma,
    brightest.reduce((sum, sample) => sum + sample.c, 0) / brightest.length
  )
  const h = c > 0.004 ? circularMean(brightest, (sample) => sample.c, 1) : null
  return { c: h == null ? 0 : c, h: h ?? 0 }
}

export function tintToTokens(tint: { c: number; h: number }): AccentTokens {
  return {
    light: token(monoLightTarget, tint.c, tint.h),
    dark: token(monoDarkTarget, tint.c, tint.h),
  }
}

export function pickAccent(all: OklchSample[]): AccentTokens | null {
  const kept = filterSamples(all)
  const tint = monochromeTint(all, kept)
  if (tint) return tintToTokens(tint)
  const hue = pickHue(kept)
  if (hue == null) return null
  return hueToTokens(hue, kept)
}

export function applyTokens(tokens: AccentTokens) {
  const root = document.documentElement
  root.style.setProperty('--accent-primary-light', tokens.light)
  root.style.setProperty('--accent-primary-dark', tokens.dark)
  root.dataset.accentFrom = 'wallpaper'
  notifyAccentChange()
}

export function applyWallpaperAccent(image: HTMLImageElement) {
  const tokens = pickAccent(samplePixels(image))
  if (!tokens) return false
  applyTokens(tokens)
  return true
}

export function clearWallpaperAccent() {
  const root = document.documentElement
  root.style.removeProperty('--accent-primary-light')
  root.style.removeProperty('--accent-primary-dark')
  delete root.dataset.accentFrom
}
