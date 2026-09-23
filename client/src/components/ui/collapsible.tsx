import { cn } from '@/lib/utils'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot='collapsible' {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot='collapsible-trigger' {...props} />
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot='collapsible-content'
      className={cn(
        'h-(--collapsible-panel-height) overflow-hidden opacity-100 transition-[height,opacity] duration-(--motion-disclosure-open-duration) ease-(--motion-disclosure-ease) data-ending-style:duration-(--motion-disclosure-close-duration) data-starting-style:h-0 data-starting-style:opacity-60 data-ending-style:h-0 data-ending-style:opacity-0 motion-reduce:transition-none',
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
