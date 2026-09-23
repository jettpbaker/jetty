import type { ContextUsage } from '@jetty/shared/events'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BoxArrowUpIcon } from '@phosphor-icons/react'

import { PageSidebarTrigger } from './page_sidebar_trigger'

const radius = 90
const circumference = 2 * Math.PI * radius

export function ThreadHeader({
  context,
  onUnarchive,
}: {
  context: ContextUsage | null
  // set while the thread is archived
  onUnarchive?: () => void
}) {
  const fraction = context ? Math.max(0, Math.min(1, context.usedTokens / context.maxTokens)) : 0
  const label = context
    ? `Context window ${Math.round(fraction * 100)}% full`
    : 'Context usage unavailable'
  return (
    <header className='thread-conversation-header flex h-(--app-tab-bar-height) shrink-0 items-center justify-between border-b border-border pr-[42px] pl-(--page-header-inset)'>
      <div className='flex min-w-0 items-center gap-2'>
        <PageSidebarTrigger />
        {onUnarchive && (
          <Button variant='ghost-text' size='sm' onClick={onUnarchive}>
            <BoxArrowUpIcon />
            Unarchive
          </Button>
        )}
      </div>
      <div className='flex items-center gap-1'>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant='ghost' tone='muted' size='icon' aria-label={label} />}
          >
            <svg
              viewBox='0 0 256 256'
              aria-hidden='true'
              className={fraction >= 0.9 ? 'text-destructive' : undefined}
            >
              <circle
                cx='128'
                cy='128'
                r={radius}
                fill='none'
                strokeWidth='26'
                className='stroke-border'
              />
              {context && (
                <circle
                  cx='128'
                  cy='128'
                  r={radius}
                  fill='none'
                  strokeWidth='26'
                  stroke='currentColor'
                  strokeLinecap='round'
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - fraction)}
                  transform='rotate(-90 128 128)'
                />
              )}
            </svg>
          </TooltipTrigger>
          <TooltipContent>
            {context
              ? `${context.usedTokens.toLocaleString()} / ${context.maxTokens.toLocaleString()} context tokens`
              : 'No context reading yet'}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
