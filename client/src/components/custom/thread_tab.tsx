import type { ComponentProps, ReactElement } from 'react'

import { renderWorkingTitle } from '@/components/custom/subagent_row'
import { StatusGlyph, type ThreadStatus } from '@/components/custom/thread_status'
import { DitherAvatar } from '@/components/dither-kit/avatar'
import { TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { OverflowTitle } from './overflow_title'

const subagentGlyphColor: Record<ThreadStatus, string> = {
  working: 'text-primary',
  'needs-attention': 'text-primary',
  idle: 'text-status-success',
  ready: 'text-status-success',
  error: 'text-pr-closed',
}

type ThreadTabProps = Omit<ComponentProps<typeof TabsTrigger>, 'children' | 'title' | 'variant'> & {
  title: string
  status: ThreadStatus
  model?: string
  effort?: string
  agentType?: 'main' | 'subagent'
}

export function ThreadTab({
  title,
  status,
  model,
  effort,
  agentType = 'main',
  className,
  ...props
}: ThreadTabProps) {
  const isSubagent = agentType === 'subagent'
  const hasTooltip = isSubagent && Boolean(model || effort)
  const renderTab = (trigger?: ReactElement) => (
    <TabsTrigger
      data-overflow-hover
      variant='thread'
      render={trigger}
      className={cn(isSubagent && 'gap-2 px-3', className)}
      {...props}
    >
      {isSubagent && status !== 'needs-attention' ? (
        <span className={cn('flex shrink-0 items-center', subagentGlyphColor[status])}>
          <DitherAvatar
            key={status}
            name={String(props.value)}
            mirror='horizontal'
            animate={false}
            bloom='subtle'
            color='currentColor'
            className='size-glyph'
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
        <span>{[model, effort && `${effort} effort`].filter(Boolean).join(' · ')}</span>
      </TooltipContent>
    </Tooltip>
  )
}
