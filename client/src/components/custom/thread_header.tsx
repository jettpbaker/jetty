import { ArchiveArrowUpIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'

import { PageSidebarTrigger } from './page_sidebar_trigger'

export function ThreadHeader({
  onUnarchive,
}: {
  // set while the thread is archived
  onUnarchive?: () => void
}) {
  return (
    <header
      data-perf-region='thread-header'
      className='thread-conversation-header flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 border-b border-border pr-[42px] pl-(--page-header-inset)'
    >
      <PageSidebarTrigger />
      {onUnarchive && (
        <Button variant='ghost-text' size='sm' {...pressProps(onUnarchive)}>
          <ArchiveArrowUpIcon />
          Unarchive
        </Button>
      )}
    </header>
  )
}
