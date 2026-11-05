import type { ProviderId } from '@jetty/shared/wire'

import { useNow } from '@/hooks/use-now'
import { formatAge, formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useChildThreadMetas, useModels, useThreadRowPrefetch } from '@/state'
import { catalogModelName } from '@jetty/shared/model-name'
import { useNavigate } from '@tanstack/react-router'

import { ProviderGlyph } from './provider_glyph'
import { StatusGlyph, statusPresentation, threadStatus, type ThreadStatus } from './thread_status'
import { TwoLineRow } from './two_line_row'

export type ChildThread = {
  id: string
  title: string
  provider?: ProviderId
  model?: string
  status: ThreadStatus
  updatedAt: number
  run?: { startedAt: number; endedAt?: number }
  archived: boolean
}

type Open = (child: ChildThread) => void

const statusOrder: ThreadStatus[] = [
  'needs-attention',
  'ready',
  'working',
  'error',
  'monitoring',
  'idle',
]

export function useChildThreads(parentId: string) {
  const threads = useChildThreadMetas(parentId)
  const models = useModels()
  return threads.map(
    (thread): ChildThread => ({
      id: thread.id,
      title: thread.title,
      provider: thread.provider,
      model:
        thread.provider && thread.model
          ? catalogModelName(models, thread.provider, thread.model)
          : undefined,
      status: threadStatus(thread.status, thread.readyForReview),
      updatedAt: thread.updatedAt,
      run:
        thread.turnStartedAt === undefined ||
        (thread.status === 'starting' && thread.turnEndedAt !== undefined)
          ? undefined
          : { startedAt: thread.turnStartedAt, endedAt: thread.turnEndedAt },
      archived: thread.archived,
    })
  )
}

function useOpenThread(): Open {
  const navigate = useNavigate()
  return (child) => void navigate({ to: '/threads/$threadId', params: { threadId: child.id } })
}

function ChildTitle({ child }: { child: ChildThread }) {
  return (
    <span className='min-w-0 text-13 leading-5 wrap-anywhere whitespace-normal text-foreground'>
      {child.title}
    </span>
  )
}

function AgentMeta({ child }: { child: ChildThread }) {
  return (
    <span className='flex min-w-0 items-center gap-1.5'>
      {child.provider && <ProviderGlyph provider={child.provider} className='size-3 shrink-0' />}
      <span className='truncate text-muted-foreground'>{child.model}</span>
    </span>
  )
}

function LastActivity({ child }: { child: ChildThread }) {
  const running = child.status === 'working' || child.status === 'needs-attention'
  const now = useNow(child.run && child.run.endedAt === undefined ? 1000 : 60_000)
  const runDuration =
    child.run &&
    formatDuration(Math.max(0, ((child.run.endedAt ?? now) - child.run.startedAt) / 1000))
  const lastActivity = formatAge(child.updatedAt, now)
  const label = runDuration
    ? `${running ? 'running for' : 'last run'} ${runDuration}`
    : lastActivity === 'now'
      ? 'last activity just now'
      : `last activity ${lastActivity} ago`
  return (
    <span
      className='shrink-0 font-mono text-xs text-muted-foreground'
      aria-label={`${statusPresentation[child.status].label}, ${label}`}
    >
      {runDuration ?? lastActivity}
    </span>
  )
}

export function ChildThreadList({
  threads,
  className,
  showType,
}: {
  threads: readonly ChildThread[]
  className?: string
  showType?: boolean
}) {
  const open = useOpenThread()
  const prefetch = useThreadRowPrefetch()
  const sorted = threads.toSorted(
    (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  )
  return (
    <div className={cn('flex flex-col p-2', className)}>
      {sorted.map((child) => (
        <OwnedThreadRow
          key={child.id}
          child={child}
          open={open}
          prefetch={prefetch}
          showType={showType}
        />
      ))}
    </div>
  )
}

function OwnedThreadRow({
  child,
  open,
  prefetch,
  showType,
}: {
  child: ChildThread
  open: Open
  showType?: boolean
  prefetch: ReturnType<typeof useThreadRowPrefetch>
}) {
  return (
    <TwoLineRow
      onClick={() => open(child)}
      onPointerEnter={() => prefetch.enter(child.id)}
      onPointerLeave={() => prefetch.leave(child.id)}
      heading={
        <>
          <span className='min-w-0 flex-1'>
            <ChildTitle child={child} />
          </span>
          {showType && (
            <span className='shrink-0 pt-0.5 text-xs text-muted-foreground'>Thread</span>
          )}
        </>
      }
      glyph={<StatusGlyph status={child.status} />}
    >
      <AgentMeta child={child} />
      <span className='ml-auto mr-px flex shrink-0 items-center gap-2 pl-1.5'>
        <LastActivity child={child} />
      </span>
    </TwoLineRow>
  )
}
