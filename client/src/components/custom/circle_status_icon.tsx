import { useId, type SVGProps } from 'react'

type StatusIconProps = SVGProps<SVGSVGElement>

function CircleStatusIcon({
  symbol,
  ...props
}: StatusIconProps & { symbol: 'attention' | 'error' | 'success' }) {
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
          ) : symbol === 'success' ? (
            <path
              d='m4.4 7.2 1.8 1.8 3.4-3.6'
              stroke='black'
              strokeWidth={1.75}
              strokeLinecap='round'
              strokeLinejoin='round'
            />
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

export function SuccessStatusIcon(props: StatusIconProps) {
  return <CircleStatusIcon symbol='success' {...props} />
}

// Outlined where the filled glyphs ask for attention: the run is over and nothing waits on you.
export function DoneStatusIcon(props: StatusIconProps) {
  return (
    <svg width={16} height={16} viewBox='0 0 14 14' fill='none' {...props}>
      <circle cx='7' cy='7' r='5.9' stroke='currentColor' strokeWidth={1.2} />
      <path
        d='m4.6 7.1 1.6 1.6 3.2-3.3'
        stroke='currentColor'
        strokeWidth={1.4}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function QueuedStatusIcon(props: StatusIconProps) {
  return (
    <svg width={16} height={16} viewBox='0 0 14 14' fill='none' {...props}>
      <circle cx='7' cy='7' r='3.5' stroke='currentColor' />
    </svg>
  )
}
