import type { ContextUsage } from '@jetty/shared/events'

import { ArchiveArrowUpIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { pressProps } from '@/lib/press'

import { ContextRing } from './context_ring'
import { PageSidebarTrigger } from './page_sidebar_trigger'

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
    <header
      data-perf-region='thread-header'
      className='thread-conversation-header flex h-(--app-tab-bar-height) shrink-0 items-center justify-between border-b border-border pr-[42px] pl-(--page-header-inset)'
    >
      <div className='flex min-w-0 items-center gap-2'>
        <PageSidebarTrigger />
        {onUnarchive && (
          <Button variant='ghost-text' size='sm' {...pressProps(onUnarchive)}>
            <ArchiveArrowUpIcon />
            Unarchive
          </Button>
        )}
      </div>
      <div className='flex items-center gap-1'>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant='ghost' tone='muted' size='icon' aria-label={label} />}
          >
            <ContextRing context={context} />
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
