import { ArrowOutOfBoxIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { threadBranch } from '@/lib/thread_worktree'
import { useOpenPullRequest, useProject, useThreadMeta } from '@/state'

import { BotTabStrip } from './bot_tab_strip'
import { environments } from './composer_environment'
import './thread_header.css'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { linkPresentation } from './thread_pull_request'
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
  const project = useProject(meta?.projectId)
  const openPull = useOpenPullRequest()
  const branch = meta && threadBranch(meta)
  const place = meta && environments[meta.environment]
  const pull = meta?.pullRequests?.[0]
  const look = linkPresentation(pull)
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
      className='details-chat-header @container/thread-header flex h-(--app-tab-bar-height) shrink-0 items-center gap-2 border-b border-border pr-[42px] pl-(--page-header-inset)'
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
      {meta && (
        <div className='thread-header-context flex max-w-1/2 min-w-0 shrink-0 items-center gap-3 text-13 text-muted-foreground'>
          {project && (
            <span
              className='max-w-36 truncate @max-[760px]/thread-header:hidden'
              title={project.title}
            >
              {project.title}
            </span>
          )}
          {place && (
            <span
              className='flex min-w-0 items-center gap-1.5'
              title={`${place.label}${branch ? ` · ${branch}` : ''}`}
            >
              <place.Icon aria-hidden='true' className='size-3.5 shrink-0' />
              <span className='truncate @max-[760px]/thread-header:sr-only'>{place.label}</span>
              {branch && (
                <span className='max-w-40 truncate font-mono @max-[760px]/thread-header:max-w-24'>
                  {branch}
                </span>
              )}
            </span>
          )}
          {pull && (
            <Button
              variant='ghost-text'
              size='sm'
              className={look.color}
              aria-label={`${look.label}: ${pull.title ?? `#${pull.number}`}`}
              onClick={() => openPull(threadId, pull)}
            >
              <look.icon />
              <span className='font-mono'>#{pull.number}</span>
            </Button>
          )}
        </div>
      )}
      {unarchive}
    </header>
  )
}
