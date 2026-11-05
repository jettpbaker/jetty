import { ArrowOutOfBoxIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useThreadMeta } from '@/state'

import { BotTabStrip } from './bot_tab_strip'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { StatusGlyph, threadStatus } from './thread_status'

export function ThreadHeader({
  onUnarchive,
  threadId,
  botId,
}: {
  // set while the thread is archived
  onUnarchive?: () => void
  threadId: string
  botId?: string
}) {
  const meta = useThreadMeta(threadId)
  const unarchive = onUnarchive && (
    <Button variant='ghost-text' size='sm' {...pressProps(onUnarchive)}>
      <ArrowOutOfBoxIcon />
      Unarchive
    </Button>
  )
  if (botId)
    return (
      <BotTabStrip key={botId} botId={botId} threadId={threadId}>
        {unarchive}
      </BotTabStrip>
    )
  return (
    <header
      data-perf-region='thread-header'
      className='details-chat-header flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 border-b border-border pr-[42px] pl-(--page-header-inset)'
    >
      <PageSidebarTrigger />
      {meta && (
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <StatusGlyph
            status={meta.archived ? 'archived' : threadStatus(meta.status, meta.readyForReview)}
          />
          <h1 className='truncate text-sm font-medium' title={meta.title}>
            {meta.title}
          </h1>
        </div>
      )}
      {unarchive}
    </header>
  )
}
