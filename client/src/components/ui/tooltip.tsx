import { cn } from '@/lib/utils'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

function TooltipProvider({ delay = 300, timeout = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot='tooltip-provider'
      delay={delay}
      timeout={timeout}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot='tooltip' {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot='tooltip-trigger' {...props} />
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-50'
      >
        <TooltipPrimitive.Popup
          data-slot='tooltip-content'
          className={cn(
            'z-50 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-sm border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm transition-opacity duration-100 ease-out data-starting-style:opacity-0 data-closed:opacity-0 data-closed:duration-0 data-instant:duration-0 motion-reduce:transition-none',
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
