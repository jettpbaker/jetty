import type { ProviderId } from '@jetty/shared/wire'

import { PreviewCard } from '@base-ui/react/preview-card'
import { RepoIcon } from '@primer/octicons-react'
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react'

import { OverflowTitle } from './overflow_title'
import { ProviderGlyph } from './provider_glyph'
import { prPresentation, type ThreadPullRequest } from './thread_pull_request'
import { ThreadStatusGlyph, statusPresentation, type ThreadStatus } from './thread_status'
import './thread_hover.css'

export type ThreadDetails = {
  title: string
  project: string
  provider?: ProviderId
  lastActivity: string
  pullRequest?: ThreadPullRequest
}

type ThreadHoverContentProps = {
  details: ThreadDetails
  model?: string
  effort?: string
  status: ThreadStatus
}

type SharedPreview = {
  handle: ReturnType<typeof PreviewCard.createHandle<ReactElement>>
  open: boolean
}

const ThreadHoverContext = createContext<SharedPreview | null>(null)

export function ThreadHoverGroup({ children }: { children: ReactNode }) {
  const [handle] = useState(() => PreviewCard.createHandle<ReactElement>())
  const [open, setOpen] = useState(false)
  return (
    <ThreadHoverContext.Provider value={{ handle, open }}>
      {children}
      <PreviewCard.Root handle={handle} onOpenChange={setOpen}>
        {({ payload }) => (
          <PreviewCard.Portal>
            <PreviewCard.Positioner
              side='right'
              align='start'
              sideOffset={8}
              className='thread-hover-positioner z-50'
            >
              <PreviewCard.Popup className='thread-hover-shared'>
                <PreviewCard.Viewport className='thread-hover-viewport'>
                  {payload}
                </PreviewCard.Viewport>
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        )}
      </PreviewCard.Root>
    </ThreadHoverContext.Provider>
  )
}

export function ThreadHoverCard({
  children,
  ...content
}: ThreadHoverContentProps & { children: (trigger: ReactElement) => ReactNode }) {
  const group = useContext(ThreadHoverContext)!
  return children(
    <PreviewCard.Trigger
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the row rendering this trigger supplies its content
      render={<button />}
      handle={group.handle}
      payload={<ThreadHoverContent {...content} />}
      delay={group.open ? 0 : 500}
      closeDelay={100}
    />
  )
}

function ThreadHoverContent({ details, model, effort, status }: ThreadHoverContentProps) {
  const { pullRequest } = details
  const pr = pullRequest && prPresentation[pullRequest.state]
  return (
    <div
      data-overflow-hover
      className='thread-hover-card flex w-64 max-w-[calc(100vw-24px)] flex-col gap-1.5 rounded-sm border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md transition-opacity duration-100 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-0 motion-reduce:transition-none'
    >
      <div className='flex min-w-0 items-center gap-3'>
        <OverflowTitle>{details.title}</OverflowTitle>
      </div>
      <div className='flex min-w-0 items-center justify-between gap-3 text-muted-foreground'>
        <span className='flex shrink-0 items-center gap-1.5'>
          <span className='flex items-center gap-1'>
            <ThreadStatusGlyph status={status} iconClassName='size-3' />
            <span>{statusPresentation[status].label}</span>
          </span>
          <span aria-hidden='true'>·</span>
          <span
            className='shrink-0 font-mono'
            aria-label={`Last activity ${details.lastActivity === 'now' ? 'just now' : `${details.lastActivity} ago`}`}
          >
            {details.lastActivity}
          </span>
        </span>
        <span className='flex min-w-0 items-center gap-1'>
          <RepoIcon aria-hidden='true' className='icon-optical-down size-3 shrink-0' />
          <span className='truncate'>{details.project}</span>
        </span>
      </div>
      <div className='flex items-center gap-1'>
        {details.provider && (
          <ProviderGlyph provider={details.provider} className='size-3 text-primary' />
        )}
        <span className='flex items-center gap-1'>
          <span>{model ?? 'Model unavailable'}</span>
          {effort && <span className='text-muted-foreground'>{effort}</span>}
        </span>
        <span className='ml-auto shrink-0 pl-2'>
          {pullRequest && pr ? (
            <span
              className='flex items-center gap-1 text-muted-foreground'
              title={`${pr.label} PR #${pullRequest.number}`}
            >
              <pr.icon className={`size-3 ${pr.color}`} aria-hidden='true' />
              <span className='font-mono'>{`#${pullRequest.number}`}</span>
              <span className='sr-only'>{pr.label}</span>
            </span>
          ) : (
            <span className='text-muted-foreground'>No pull requests</span>
          )}
        </span>
      </div>
    </div>
  )
}
