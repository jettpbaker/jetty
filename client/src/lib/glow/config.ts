/**
 * Glow engine configuration. All distances are in CSS pixels (the engine
 * converts to device pixels internally, exactly once).
 *
 * Defaults are the values tuned during the first-principles glow study.
 */

export type Vec3 = [number, number, number]

export type GlowWave = {
  /** starting position, in LED-index space (0..ledCount) */
  center: number
  /** travel speed, LED indices per second (negative = counter-clockwise) */
  vel: number
  /** gaussian sigma, in LED indices */
  width: number
  /** peak brightness contribution */
  strength: number
}

export type GlowConfig = {
  /** master brightness meter, applied before tonemapping */
  exposure: number

  /** number of LEDs around the perimeter. Changing this rebuilds shaders. */
  ledCount: number

  /** ambient brightness of unlit LEDs */
  idleBase: number

  /** traveling brightness waves (the ambient animation) */
  waves: GlowWave[]

  /** white when idle, eases into the lobe colors while the input is focused */
  focusColorize: boolean

  /**
   * per-edge color lobes in LINEAR RGB, order: top, right, bottom, left.
   * (Linear values look wrong as hex on purpose — they are light, not paint.)
   */
  lobes: [Vec3, Vec3, Vec3, Vec3]

  /** falloff kernel: pow(d, -falloffPower) * exp(-d / absorptionPx) */
  kernel: {
    gain: number
    falloffPower: number
    /** where light effectively terminates */
    absorptionPx: number
    /** softens the power law's singularity; also hides LED seams */
    emitterRadiusPx: number
  }

  /** the incandescent band hugging the silhouette */
  rim: {
    enabled: boolean
    /** how strongly the edge re-emits arriving light */
    strength: number
    /** band width */
    bandPx: number
  }

  /** floor texture */
  grain: {
    enabled: boolean
    /** darkening of the darkest cells (0..1) */
    depth: number
    /** value-noise cell size */
    scalePx: number
    /** 0..1 blend of per-pixel sparkle over the soft weave */
    sparkle: number
  }

  /** far-field lens atmosphere (the blur pyramid) */
  bloom: {
    enabled: boolean
    weight: number
  }

  /** 'balanced' computes the light field at half resolution (visually
   *  equivalent for a smooth field); 'high' computes it at full resolution */
  quality: 'balanced' | 'high'

  /** frame cap — the ambient animation does not need ProMotion */
  maxFps: number
}

export const DEFAULT_GLOW_CONFIG: GlowConfig = {
  exposure: 0.064,
  ledCount: 192,
  idleBase: 0.03,
  waves: [
    { center: 12, vel: 12, width: 5, strength: 1.6 },
    { center: 60, vel: -8, width: 6.5, strength: 0.8 },
    { center: 33, vel: 5.5, width: 9, strength: 0.35 },
  ],
  focusColorize: true,
  lobes: [
    [0.896269, 0.027321, 0.051269], // top: red
    [0.75, 0.55, 0.02], // right: amber
    [0.0, 0.278894, 1.0], // bottom: blue
    [0.0, 0.40724, 0.048172], // left: green
  ],
  kernel: {
    gain: 22,
    falloffPower: 1.35,
    absorptionPx: 330,
    emitterRadiusPx: 6,
  },
  rim: {
    enabled: true,
    strength: 0.9,
    bandPx: 9,
  },
  grain: {
    enabled: true,
    depth: 0.22,
    scalePx: 2.6,
    sparkle: 0.35,
  },
  bloom: {
    enabled: true,
    weight: 0.06,
  },
  quality: 'balanced',
  maxFps: 60,
}

export type GlowConfigPatch = {
  [K in keyof GlowConfig]?: GlowConfig[K] extends object
    ? GlowConfig[K] extends unknown[]
      ? GlowConfig[K]
      : Partial<GlowConfig[K]>
    : GlowConfig[K]
}

export function mergeConfig(base: GlowConfig, patch: GlowConfigPatch): GlowConfig {
  const next: GlowConfig = { ...base }
  for (const key of Object.keys(patch) as (keyof GlowConfig)[]) {
    const value = patch[key]
    if (value === undefined) continue
    const current = next[key]
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof current === 'object'
    ) {
      // one-level object merge (kernel, rim, grain, bloom)
      ;(next as unknown as Record<string, unknown>)[key] = { ...current, ...value }
    } else {
      ;(next as unknown as Record<string, unknown>)[key] = value
    }
  }
  return next
}
