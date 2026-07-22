import type { ReactElement } from 'react'

export function UsageMeter({
  label,
  pct,
  dim,
  resets,
}: {
  label: string
  pct: number
  dim?: boolean
  resets?: string
}): ReactElement {
  return (
    <div>
      <div className='flex items-baseline justify-between font-mono text-[11px] text-muted-foreground'>
        <span>{label}</span>
        <span className='text-code-foreground'>{pct}%</span>
      </div>
      <div className='relative mt-1.5 h-5 overflow-hidden bg-muted/50'>
        {/* the code chip smeared into a ramp: its warm ground rising to full
            ember at the leading edge, so the frontier is always the hot spot */}
        <div
          className='absolute inset-y-0 left-0'
          style={{
            width: `${pct}%`,
            opacity: dim ? 0.55 : 1,
            backgroundImage: 'linear-gradient(to right, var(--code), var(--code-foreground))',
          }}
        />
      </div>
      {resets && (
        <p className='mt-1.5 font-mono text-[11px] text-muted-foreground/60'>resets {resets}</p>
      )}
    </div>
  )
}
