import { useId, type SVGProps } from 'react'

type StatusIconProps = SVGProps<SVGSVGElement>

const symbols = {
  attention: (
    <>
      <path d='M7 3.5v3.5' stroke='black' strokeWidth={2.2} strokeLinecap='round' />
      <circle cx='7' cy='10' r='1.15' fill='black' />
    </>
  ),
  success: (
    <path
      d='m4.4 7.2 1.8 1.8 3.4-3.6'
      stroke='black'
      strokeWidth={1.75}
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  ),
  error: (
    <path
      d='m4.75 4.75 4.5 4.5m0-4.5-4.5 4.5'
      stroke='black'
      strokeWidth={1.75}
      strokeLinecap='round'
    />
  ),
  // Hands at 12 and 4. All their weight sits above and right of the pivot, so it sits 0.4 down-left.
  waiting: (
    <path
      d='M6.6 4v3.4l2.3 1.33'
      stroke='black'
      strokeWidth={1.75}
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  ),
}

function CircleStatusIcon({
  symbol,
  ...props
}: StatusIconProps & { symbol: keyof typeof symbols }) {
  const maskId = useId()
  return (
    <svg width={16} height={16} viewBox='0 0 14 14' fill='none' {...props}>
      <defs>
        <mask id={maskId}>
          <circle cx='7' cy='7' r='6.5' fill='white' />
          {symbols[symbol]}
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

export function WaitingStatusIcon(props: StatusIconProps) {
  return <CircleStatusIcon symbol='waiting' {...props} />
}

// Outlined where the filled glyphs ask for attention: the run is over and nothing waits on you.
export function QueuedStatusIcon(props: StatusIconProps) {
  return (
    <svg width={16} height={16} viewBox='0 0 14 14' fill='none' {...props}>
      <circle cx='7' cy='7' r='3.5' stroke='currentColor' />
    </svg>
  )
}

// The idle ring at the discs' size, for counts that sit beside them.
export function SkippedStatusIcon(props: StatusIconProps) {
  return (
    <svg width={16} height={16} viewBox='0 0 14 14' fill='none' {...props}>
      <circle cx='7' cy='7' r='5.75' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  )
}
