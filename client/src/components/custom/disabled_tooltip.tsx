import type { ComponentProps, ReactElement } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { cloneElement, useId } from 'react'

// Explains a visible-but-disabled control. Assistive tech never sees tooltips, so the reason
// doubles as the control's accessible description. Native disabled elements swallow pointer
// events, so those hang the tooltip off a `wrap` span instead of the control itself. With no
// reason there's no tooltip to mount: these wrap always-mounted controls, mostly enabled.
export function DisabledTooltip({
  reason,
  side,
  wrap,
  children,
}: {
  reason: string | undefined
  side?: ComponentProps<typeof TooltipContent>['side']
  wrap?: string
  children: ReactElement<{ 'aria-describedby'?: string }>
}) {
  const id = useId()
  if (!reason) return wrap === undefined ? children : <span className={wrap}>{children}</span>
  const control = cloneElement(children, { 'aria-describedby': id })
  return (
    <Tooltip>
      {wrap === undefined ? (
        <TooltipTrigger render={control} />
      ) : (
        <TooltipTrigger render={<span className={cn(wrap, 'cursor-not-allowed')} />}>
          {control}
        </TooltipTrigger>
      )}
      <TooltipContent side={side}>{reason}</TooltipContent>
      <span id={id} hidden>
        {reason}
      </span>
    </Tooltip>
  )
}
