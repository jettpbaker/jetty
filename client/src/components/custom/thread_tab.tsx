import type { ComponentProps, CSSProperties, ReactElement } from 'react'

import { renderWorkingTitle } from '@/components/custom/subagent_row'
import { StatusGlyph, type ThreadStatus } from '@/components/custom/thread_status'
import { DitherAvatar } from '@/components/dither-kit/avatar'
import { TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { OverflowTitle } from './overflow_title'
import './subagent_finish.css'

const subagentGlyphColor: Record<ThreadStatus, string> = {
  monitoring: 'text-muted-foreground',
  working: 'text-primary',
  'needs-attention': 'text-primary',
  idle: 'text-muted-foreground',
  ready: 'text-status-success',
  error: 'text-pr-closed',
}

type ThreadTabProps = Omit<ComponentProps<typeof TabsTrigger>, 'children' | 'title' | 'variant'> & {
  title: string
  status: ThreadStatus
  model?: string
  agentType?: 'main' | 'subagent'
  // A finished subagent's tab on its way out: it shrinks away with its title held at this width.
  leaving?: { titleWidth: number }
}

export function ThreadTab({
  title,
  status,
  model,
  agentType = 'main',
  leaving,
  className,
  ...props
}: ThreadTabProps) {
  const isSubagent = agentType === 'subagent'
  const hasTooltip = isSubagent && Boolean(model)
  const renderTab = (trigger?: ReactElement) => (
    <TabsTrigger
      data-overflow-hover
      variant='thread'
      render={trigger}
      className={cn(isSubagent && 'finish-tab gap-2 px-3', className)}
      data-exit={leaving ? 'shrink' : undefined}
      style={leaving ? ({ '--title-w': `${leaving.titleWidth}px` } as CSSProperties) : undefined}
      {...props}
    >
      {isSubagent && status !== 'needs-attention' ? (
        <span className={cn('flex shrink-0 items-center', subagentGlyphColor[status])}>
          <DitherAvatar
            name={String(props.value)}
            mirror='horizontal'
            animate={false}
            bloom='subtle'
            color='currentColor'
            className='finish-avatar size-glyph'
          />
          <span className='sr-only'>Subagent, {status}</span>
        </span>
      ) : (
        <StatusGlyph status={status} className='size-glyph' />
      )}
      <OverflowTitle
        renderText={isSubagent && status === 'working' ? renderWorkingTitle : undefined}
        focusable={false}
        className={cn(
          'text-left font-normal leading-normal',
          isSubagent && status === 'error' && 'text-status-error'
        )}
      >
        {title}
      </OverflowTitle>
      {model && <span className='sr-only'>{model}</span>}
    </TabsTrigger>
  )
  if (!hasTooltip) return renderTab()
  return (
    <Tooltip>
      {renderTab(<TooltipTrigger />)}
      <TooltipContent side='bottom'>
        <span>{model}</span>
      </TooltipContent>
    </Tooltip>
  )
}
