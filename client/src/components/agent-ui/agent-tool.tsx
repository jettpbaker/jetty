import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  CaretDownIcon,
  FileIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from '@phosphor-icons/react'
import { type ReactNode, useState } from 'react'

import { Shimmer } from '@/components/ai-elements/shimmer'

// Shared chrome for tool rows: sparse while running, expandable when done.
// Custom tools only supply icon/title/subtitle/body — not their own shells.

export type AgentToolStatus = 'pending' | 'running' | 'completed' | 'error'

export type AgentToolKind = 'read' | 'search' | 'edit' | 'shell' | 'generic'

const KIND_ICON = {
  read: FileIcon,
  search: MagnifyingGlassIcon,
  edit: PencilSimpleIcon,
  shell: TerminalWindowIcon,
  generic: WrenchIcon,
} as const

function isBusy(status: AgentToolStatus): boolean {
  return status === 'pending' || status === 'running'
}

export function AgentTool({
  kind = 'generic',
  status = 'completed',
  title,
  subtitle,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  className,
}: {
  kind?: AgentToolKind
  status?: AgentToolStatus
  title: string
  subtitle?: string
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  className?: string
}) {
  const busy = isBusy(status)
  const expandable = !busy && !!children && status !== 'error'
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen

  function setOpen(next: boolean) {
    if (!expandable) return
    if (openProp === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const Icon = KIND_ICON[kind]

  const titleNode = busy ? (
    <Shimmer as='span' className='truncate font-medium' duration={1.4}>
      {title}
    </Shimmer>
  ) : (
    <span className='truncate font-medium text-foreground'>{title}</span>
  )

  const row = (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-2 py-1 text-left text-sm',
        expandable && 'cursor-pointer hover:text-foreground',
        className
      )}
    >
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          status === 'error' ? 'text-destructive' : 'text-muted-foreground'
        )}
      />
      <div className='flex min-w-0 flex-1 items-baseline gap-2'>
        {titleNode}
        {!busy && subtitle ? (
          <span className='truncate font-mono text-xs text-muted-foreground'>{subtitle}</span>
        ) : null}
      </div>
      {expandable ? (
        <CaretDownIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      ) : null}
    </div>
  )

  if (!expandable) {
    return <div className='w-full'>{row}</div>
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='w-full'>
      <CollapsibleTrigger className='w-full outline-none'>{row}</CollapsibleTrigger>
      <CollapsibleContent className='overflow-hidden data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:animate-in data-starting-style:fade-in-0'>
        <div className='mt-1 mb-2 ml-[22px] rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground'>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
