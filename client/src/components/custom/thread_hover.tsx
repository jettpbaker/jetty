import type { ProjectIcon, ProviderId } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useBranches } from '@/state/worktrees'
import { PreviewCard } from '@base-ui/react/preview-card'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { FolderGit2Icon, FolderIcon } from './git_icons'
import { Alert02Icon } from './huge_icons'
import { OverflowTitle } from './overflow_title'
import { ProjectGlyph } from './project_glyph'
import { ProviderGlyph } from './provider_glyph'
import { PullRequestMark, pullRequestLabel, type ThreadPullRequest } from './thread_pull_request'
import { StatusGlyph, statusPresentation, type ThreadStatus } from './thread_status'
import './thread_hover.css'

export type ThreadDetails = {
  title: string
  project: string
  projectId?: string
  projectIcon?: ProjectIcon
  provider?: ProviderId
  lastActivity: string
  pullRequest?: ThreadPullRequest
  environment?: 'local' | 'worktree'
  branch?: string
  startedOn?: string
}

type ThreadHoverContentProps = {
  details: ThreadDetails
  onOpenPullRequest: () => void
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

function EnvironmentLine({ details }: { details: ThreadDetails }) {
  const worktree = details.environment === 'worktree'
  const Icon = worktree ? FolderGit2Icon : FolderIcon
  return (
    <span
      className='flex min-w-0 items-center gap-1 text-muted-foreground'
      title={worktree ? 'Worktree' : 'Local checkout'}
    >
      <Icon aria-hidden='true' className='size-3 shrink-0' />
      <span className='sr-only'>{worktree ? 'Worktree' : 'Local checkout'}</span>
      <span className='truncate font-mono'>{details.branch}</span>
    </span>
  )
}

function ThreadHoverContent({
  details,
  model,
  effort,
  status,
  onOpenPullRequest,
}: ThreadHoverContentProps) {
  const fetchBranches = useBranches()
  const [checkout, setCheckout] = useState<{ projectId: string; branch: string }>()
  const { projectId, environment } = details
  useEffect(() => {
    if (!projectId || environment !== 'local') return
    let active = true
    fetchBranches(projectId, true, (result) => {
      if (active) setCheckout({ projectId, branch: result.currentBranch })
    })
    return () => {
      active = false
    }
  }, [projectId, environment, fetchBranches])
  const branch =
    environment === 'local' && checkout && checkout.projectId === projectId
      ? checkout.branch
      : details.branch
  const { pullRequest } = details
  const prLabel = pullRequest && pullRequestLabel(pullRequest)
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
            <StatusGlyph status={status} className='size-3' />
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
          <ProjectGlyph icon={details.projectIcon} className='size-3' />
          <span className='truncate'>{details.project}</span>
        </span>
      </div>
      {details.environment && <EnvironmentLine details={{ ...details, branch }} />}
      {details.environment === 'local' &&
        details.startedOn &&
        branch &&
        details.startedOn !== branch && (
          <span className='flex items-start gap-1 text-foreground'>
            <Alert02Icon
              aria-hidden='true'
              className='mt-0.5 size-3 shrink-0 text-muted-foreground'
            />
            <span>
              Checkout moved from <span className='font-mono'>{details.startedOn}</span> since this
              thread started
            </span>
          </span>
        )}
      <div className='flex items-center gap-1'>
        {details.provider && (
          <ProviderGlyph provider={details.provider} className='size-3 text-primary' />
        )}
        <span className='flex items-center gap-1'>
          <span>{model ?? 'Model unavailable'}</span>
          {effort && <span className='text-muted-foreground'>{effort}</span>}
        </span>
        <span className='ml-auto shrink-0 pl-2'>
          {pullRequest && prLabel ? (
            <Button
              variant='ghost-text'
              className='h-auto gap-1 p-0 text-xs font-normal'
              title={prLabel.title}
              {...pressProps(onOpenPullRequest)}
            >
              <PullRequestMark pullRequest={pullRequest} />
            </Button>
          ) : (
            <span className='text-muted-foreground'>No pull requests</span>
          )}
        </span>
      </div>
    </div>
  )
}
