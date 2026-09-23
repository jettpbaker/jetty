import type { ProviderId } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { modelKey } from '@/lib/loadout'
import { formatAge, formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useChrome, useThreadRowPrefetch, type Chrome } from '@/state'
import { ContainerIcon, DeviceDesktopIcon, WorkflowIcon } from '@primer/octicons-react'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'

import { OverflowTitle } from './overflow_title'
import { ProviderGlyph } from './provider_glyph'
import { renderWorkingTitle } from './subagent_row'
import {
  StatusGlyph,
  statusPresentation,
  threadStatus,
  type Status,
  type ThreadStatus,
} from './thread_status'
import { TwoLineRow } from './two_line_row'

// A child that has gone idle has finished its run.
type ChildStatus = Exclude<Status, 'idle' | 'stopped' | 'queued'>
type Environment = 'container' | 'local'

export type ChildThread = {
  id: string
  title: string
  provider?: ProviderId
  model?: string
  env: Environment
  status: ChildStatus
  updatedAt: number
  run?: { startedAt: number; endedAt?: number }
  archived: boolean
}

type Open = (child: ChildThread) => void

function childStatus(status: ThreadStatus): ChildStatus {
  return status === 'idle' ? 'done' : status
}

const statusOrder: ChildStatus[] = ['needs-attention', 'ready', 'working', 'error', 'done']

function childThreads(chrome: Chrome | undefined, parentId: string) {
  if (!chrome) return []
  const models = new Map(chrome.models?.map((model) => [modelKey(model), model.name]))
  return chrome.threads
    .filter((thread) => thread.parentThreadId === parentId)
    .map(
      (thread): ChildThread => ({
        id: thread.id,
        title: thread.title,
        provider: thread.provider,
        model:
          thread.provider && thread.model
            ? (models.get(modelKey({ provider: thread.provider, id: thread.model })) ??
              thread.model)
            : undefined,
        env: 'local',
        status: childStatus(threadStatus(thread.status, thread.readyForReview)),
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

export function useChildThreads(parentId: string) {
  const chrome = useChrome()
  return useMemo(() => childThreads(chrome, parentId), [chrome, parentId])
}

function useOpenThread(): Open {
  const navigate = useNavigate()
  return (child) => void navigate({ to: '/threads/$threadId', params: { threadId: child.id } })
}

const envLabel: Record<Environment, string> = {
  container: 'Runs in a container',
  local: 'Runs locally',
}

function ChildTitle({ child }: { child: ChildThread }) {
  return (
    <OverflowTitle
      focusable={false}
      renderText={child.status === 'working' ? renderWorkingTitle : undefined}
      className='font-normal leading-normal'
    >
      {child.title}
    </OverflowTitle>
  )
}

function EnvTag({ env }: { env: Environment }) {
  const Icon = env === 'container' ? ContainerIcon : DeviceDesktopIcon
  return <Icon aria-label={envLabel[env]} className='size-3 shrink-0' />
}

function AgentMeta({ child }: { child: ChildThread }) {
  return (
    <span className='flex min-w-0 items-center gap-1.5'>
      {child.provider && <ProviderGlyph provider={child.provider} className='size-3 shrink-0' />}
      <span className='truncate text-foreground/80'>{child.model}</span>
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
}: {
  threads: readonly ChildThread[]
  className?: string
}) {
  const open = useOpenThread()
  const prefetch = useThreadRowPrefetch()
  const sorted = threads.toSorted(
    (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
  )
  return (
    <div className={cn('flex flex-col p-2', className)}>
      {sorted.map((child) => (
        <OwnedThreadRow key={child.id} child={child} open={open} prefetch={prefetch} />
      ))}
    </div>
  )
}

function OwnedThreadRow({
  child,
  open,
  prefetch,
}: {
  child: ChildThread
  open: Open
  prefetch: ReturnType<typeof useThreadRowPrefetch>
}) {
  return (
    <TwoLineRow
      onClick={() => open(child)}
      onPointerEnter={() => prefetch.enter(child.id)}
      onPointerLeave={() => prefetch.leave(child.id)}
      heading={<ChildTitle child={child} />}
      glyph={<StatusGlyph status={child.status} />}
    >
      <AgentMeta child={child} />
      <span className='ml-auto mr-px flex shrink-0 items-center gap-2 pl-1.5'>
        <LastActivity child={child} />
        <EnvTag env={child.env} />
      </span>
    </TwoLineRow>
  )
}

function CreatedRow({
  child,
  open,
  prefetch,
}: {
  child: ChildThread
  open: Open
  prefetch: ReturnType<typeof useThreadRowPrefetch>
}) {
  return (
    <Button
      variant='ghost-text'
      data-overflow-hover
      onClick={() => open(child)}
      onPointerEnter={() => prefetch.enter(child.id)}
      onPointerLeave={() => prefetch.leave(child.id)}
      className='flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-2.5 text-left text-sm font-normal active:translate-y-0'
    >
      <span className='flex shrink-0 items-center gap-1.5 text-muted-foreground'>
        <WorkflowIcon className='size-3' />
        Created
      </span>
      <span className='min-w-0 flex-1 text-foreground'>
        <ChildTitle child={child} />
      </span>
      <span className='ml-2 flex shrink-0 items-center gap-3 text-xs text-muted-foreground'>
        <AgentMeta child={child} />
        <span className='mr-px flex items-center gap-2'>
          <LastActivity child={child} />
          <EnvTag env={child.env} />
        </span>
      </span>
      <StatusGlyph status={child.status} />
    </Button>
  )
}

export function CreatedThreads({ parentId, ids }: { parentId: string; ids: readonly string[] }) {
  const open = useOpenThread()
  const prefetch = useThreadRowPrefetch()
  const byId = new Map(useChildThreads(parentId).map((child) => [child.id, child]))
  return (
    <div className='flex flex-col'>
      {ids.map((id) => {
        const child = byId.get(id)
        return child && <CreatedRow key={id} child={child} open={open} prefetch={prefetch} />
      })}
    </div>
  )
}
