import type { ComponentProps } from 'react'

import { ZapIcon } from '@primer/octicons-react'

type LightningIconProps = ComponentProps<'svg'> & { filled?: boolean }

export function LightningIcon({ filled = false, ...props }: LightningIconProps) {
  if (!filled) return <ZapIcon {...props} />
  return (
    <svg
      viewBox='0 0 16 16'
      width='16'
      height='16'
      fill='currentColor'
      aria-hidden='true'
      {...props}
    >
      <path d='M9.504.43a1.516 1.516 0 0 1 2.437 1.713L10.415 5.5h2.123c1.57 0 2.346 1.909 1.22 3.004l-7.34 7.142a1.249 1.249 0 0 1-.871.354h-.302a1.25 1.25 0 0 1-1.157-1.723L5.633 10.5H3.462c-1.57 0-2.346-1.909-1.22-3.004L9.503.429Z' />
    </svg>
  )
}
