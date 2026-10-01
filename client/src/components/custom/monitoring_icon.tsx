import type { SVGProps } from 'react'

export function MonitoringIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width='16' height='16' viewBox='0 0 16 16' fill='none' {...props}>
      <circle
        cx='8'
        cy='8'
        r='6.25'
        stroke='currentColor'
        strokeWidth={4 / 3}
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  )
}
