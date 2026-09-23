import { useId, type SVGProps } from 'react'

type StatusIconProps = SVGProps<SVGSVGElement>

function CircleStatusIcon({
  symbol,
  ...props
}: StatusIconProps & { symbol: 'attention' | 'error' }) {
  const maskId = useId()
  return (
    <svg width={16} height={16} viewBox='0 0 14 14' fill='none' {...props}>
      <defs>
        <mask id={maskId}>
          <circle cx='7' cy='7' r='6.5' fill='white' />
          {symbol === 'attention' ? (
            <>
              <path d='M7 3.5v3.5' stroke='black' strokeWidth={2.2} strokeLinecap='round' />
              <circle cx='7' cy='10' r='1.15' fill='black' />
            </>
          ) : (
            <path
              d='m4.75 4.75 4.5 4.5m0-4.5-4.5 4.5'
              stroke='black'
              strokeWidth={1.75}
              strokeLinecap='round'
            />
          )}
        </mask>
      </defs>
      <circle cx='7' cy='7' r='6.5' fill='currentColor' mask={`url(#${maskId})`} />
    </svg>
  )
}

export function NeedsInputIcon(props: StatusIconProps) {
  return <CircleStatusIcon symbol='attention' {...props} />
}

export function ErrorStatusIcon(props: StatusIconProps) {
  return <CircleStatusIcon symbol='error' {...props} />
}
