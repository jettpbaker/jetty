import type { ImageDitheringProps } from '@paper-design/shaders-react'

export type DitherSettings = Required<
  Pick<
    ImageDitheringProps,
    'type' | 'fit' | 'originalColors' | 'inverted' | 'scale' | 'size' | 'colorSteps'
  >
> & { drift: number }

export const initialDitherSettings: DitherSettings = {
  type: '4x4',
  fit: 'cover',
  originalColors: true,
  inverted: false,
  scale: 1,
  size: 2.5,
  colorSteps: 6,
  drift: 0.4,
}
