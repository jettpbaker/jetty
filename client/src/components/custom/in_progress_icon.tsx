import type { SVGProps } from 'react'

type InProgressIconProps = SVGProps<SVGSVGElement> & { size?: number }

export function InProgressIcon({ size = 16, ...props }: InProgressIconProps) {
  return (
    <svg width={size} height={size} viewBox='0 0 16 16' fill='none' {...props}>
      <circle cx='8' cy='8' r='6.25' stroke='currentColor' strokeWidth='1.5' />
      <path d='M8 4a4 4 0 0 1 0 8V4Z' fill='currentColor' />
    </svg>
  )
}
