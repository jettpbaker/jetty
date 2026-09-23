import {
  DitheringTypes,
  defaultObjectSizing,
  getShaderColorFromString,
  imageDitheringFragmentShader,
  ShaderFitOptions,
} from '@paper-design/shaders'
import { ShaderMount, type ImageDitheringProps } from '@paper-design/shaders-react'

export type DriftingDitherProps = ImageDitheringProps & {
  drift?: number
}

const defaultSize = 2

function patchImageDitheringShader(source: string) {
  const replacements: [string, string][] = [
    [
      'uniform float u_colorSteps;',
      'uniform float u_colorSteps;\nuniform float u_time;\nuniform float u_drift;',
    ],
    [
      'float getBayerValue(vec2 uv, int size) {\n  ivec2 pos = ivec2(fract(uv / float(size)) * float(size));',
      'float getBayerValue(vec2 uv, int size) {\n  uv += floor(u_time * u_drift);\n  ivec2 pos = ivec2(fract(uv / float(size)) * float(size));',
    ],
    [
      'dithering = step(hash21(ditheringNoiseUV), lum);',
      'dithering = step(hash21(ditheringNoiseUV + floor(u_time * u_drift)), lum);',
    ],
  ]

  let next = source
  for (const [from, to] of replacements) {
    if (!next.includes(from)) {
      throw new Error(
        `DriftingDither: imageDitheringFragmentShader no longer contains ${JSON.stringify(from)}`
      )
    }
    next = next.replace(from, to)
  }
  return next
}

const driftingDitherFragmentShader = patchImageDitheringShader(imageDitheringFragmentShader)

export function DriftingDither({
  frame = 0,
  colorFront = '#94ffaf',
  colorBack = '#000c38',
  colorHighlight = '#eaff94',
  image = '',
  type = '8x8',
  colorSteps = 2,
  originalColors = false,
  inverted = false,
  pxSize,
  size = pxSize === undefined ? defaultSize : pxSize,
  fit = 'cover',
  scale = defaultObjectSizing.scale,
  rotation = defaultObjectSizing.rotation,
  originX = defaultObjectSizing.originX,
  originY = defaultObjectSizing.originY,
  offsetX = defaultObjectSizing.offsetX,
  offsetY = defaultObjectSizing.offsetY,
  worldWidth = defaultObjectSizing.worldWidth,
  worldHeight = defaultObjectSizing.worldHeight,
  drift = 0,
  ...props
}: DriftingDitherProps) {
  const uniforms = {
    u_image: image,
    u_colorFront: getShaderColorFromString(colorFront),
    u_colorBack: getShaderColorFromString(colorBack),
    u_colorHighlight: getShaderColorFromString(colorHighlight),
    u_type: DitheringTypes[type],
    u_pxSize: size,
    u_colorSteps: colorSteps,
    u_originalColors: originalColors,
    u_inverted: inverted,
    u_drift: drift,
    u_fit: ShaderFitOptions[fit],
    u_rotation: rotation,
    u_scale: scale,
    u_offsetX: offsetX,
    u_offsetY: offsetY,
    u_originX: originX,
    u_originY: originY,
    u_worldWidth: worldWidth,
    u_worldHeight: worldHeight,
  }

  return (
    <ShaderMount
      {...props}
      speed={drift > 0 ? 1 : 0}
      frame={frame}
      fragmentShader={driftingDitherFragmentShader}
      uniforms={uniforms}
    />
  )
}
