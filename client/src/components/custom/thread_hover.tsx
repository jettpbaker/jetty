import type { ProjectIcon, ProviderId } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { useBranches, useBranchList } from '@/state/worktrees'
import { PreviewCard } from '@base-ui/react/preview-card'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { Alert02Icon, LaptopIcon } from './huge_icons'
import { FolderGit2Icon } from './lucide_icons'
import { OverflowTitle } from './overflow_title'
import { ProjectGlyph } from './project_glyph'
import { ProviderGlyph } from './provider_glyph'
import { PullRequestMark, pullRequestLabel, type ThreadPullRequest } from './thread_pull_request'
import { StatusGlyph, statusPresentation, type ThreadStatus } from './thread_status'
import './thread_hover.css'

export type ThreadDetails = {
  title: string
  project: string
  projectId: string
  projectIcon?: ProjectIcon
  provider?: ProviderId
  lastActivity: string
  pullRequest?: ThreadPullRequest
  environment: 'local' | 'worktree'
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

function EnvironmentLine({ worktree, branch }: { worktree: boolean; branch?: string }) {
  const Icon = worktree ? FolderGit2Icon : LaptopIcon
  return (
    <span
      className='flex min-w-0 items-center gap-1 text-muted-foreground'
      title={worktree ? 'Worktree' : 'Local checkout'}
    >
      <Icon aria-hidden='true' className='size-3 shrink-0' />
      <span className='sr-only'>{worktree ? 'Worktree' : 'Local checkout'}</span>
      {branch && (
        <OverflowTitle focusable={false} className='font-mono text-xs font-normal leading-normal'>
          {branch}
        </OverflowTitle>
      )}
    </span>
  )
}

// A project without a git checkout has no branch.
function useCheckout(projectId?: string) {
  const fetchBranches = useBranches()
  useEffect(() => {
    if (projectId) fetchBranches(projectId, true)
  }, [projectId, fetchBranches])
  const list = useBranchList(projectId, true)
  if (!list || list.git === 'error') return undefined
  return { branch: list.git === 'ok' ? list.currentBranch : undefined }
}

function ThreadHoverContent({
  details,
  model,
  effort,
  status,
  onOpenPullRequest,
}: ThreadHoverContentProps) {
  const local = details.environment === 'local'
  const checkout = useCheckout(local ? details.projectId : undefined)
  const branch = checkout ? checkout.branch : details.branch
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
          <OverflowTitle focusable={false} className='text-xs font-normal leading-normal'>
            {details.project}
          </OverflowTitle>
        </span>
      </div>
      <EnvironmentLine worktree={!local} branch={branch} />
      {details.startedOn && branch !== undefined && details.startedOn !== branch && (
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
