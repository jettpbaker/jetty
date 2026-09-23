import type { ThreadItem } from '@jetty/shared/items'
import type { PullRequestLink } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useNow } from '@/hooks/use-now'
import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'
import { storage } from '@/platform'
import { useChrome, useRequestReveal, useThread, useThreadDiff, useThreadTab } from '@/state'
import { ChevronRightIcon } from '@primer/octicons-react'
import { useMemo, useState, type ReactNode } from 'react'

import { ChildThreadList, type ChildThread } from './child_threads'
import { TodoList } from './composer_strip'
import { currentTodos } from './composer_strip_model'
import { OverflowTitle } from './overflow_title'
import { SubagentRow } from './subagent_row'
import { prPresentation } from './thread_pull_request'
import { threadSubagents, toSubagent } from './thread_rows'
import { WorkflowLineGrid } from './workflow_lines'
import { type Workflow } from './workflow_parts'

type SectionId = 'todos' | 'subagents' | 'workflows' | 'threads' | 'pulls' | 'changes'

const collapsedKey = 'jetty.overview.collapsed'
const changedFileLimit = 8

function threadWorkflows(items: readonly ThreadItem[]) {
  return items.filter((item): item is Workflow => item.kind === 'workflow')
}

export function useHasOverview(threadId: string, childThreads: readonly ChildThread[]) {
  const items = useThread(threadId)?.items
  const pullRequests = useChrome()?.threads.find((thread) => thread.id === threadId)?.pullRequests
  const hasItems = useMemo(
    () =>
      (items ?? []).some((item) => item.kind === 'subagent' || item.kind === 'workflow') ||
      currentTodos(items ?? []).length > 0,
    [items]
  )
  return hasItems || childThreads.length > 0 || (pullRequests?.length ?? 0) > 0
}

function loadCollapsed(): SectionId[] {
  try {
    const saved: unknown = JSON.parse(storage.get(collapsedKey) ?? '[]')
    return Array.isArray(saved) ? (saved as SectionId[]) : []
  } catch {
    return []
  }
}

type ChangedFile = { path: string; added: number; removed: number }

function changedFiles(patch: string) {
  const files: ChangedFile[] = []
  let file: ChangedFile | undefined
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = { path: line.slice(line.lastIndexOf(' b/') + 3), added: 0, removed: 0 }
      files.push(file)
      inHunk = false
    } else if (line.startsWith('@@')) inHunk = true
    else if (file && inHunk && line.startsWith('+')) file.added++
    else if (file && inHunk && line.startsWith('-')) file.removed++
  }
  return files
}

export function ThreadOverview({
  threadId,
  childThreads,
  onShowChat,
  onShowChanges,
}: {
  threadId: string
  childThreads: readonly ChildThread[]
  onShowChat: () => void
  onShowChanges: () => void
}) {
  const items = useThread(threadId)?.items
  const meta = useChrome()?.threads.find((thread) => thread.id === threadId)
  const [tab, setTab] = useThreadTab(threadId)
  const reveal = useRequestReveal()
  const { diff } = useThreadDiff(threadId)
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  const todos = useMemo(() => currentTodos(items ?? []), [items])
  const subagentItems = useMemo(() => threadSubagents(items ?? []), [items])
  const workflows = useMemo(() => threadWorkflows(items ?? []), [items])
  const files = useMemo(() => (diff ? changedFiles(diff.diff) : []), [diff])
  const pullRequests = useMemo(
    () =>
      (meta?.pullRequests ?? []).toSorted(
        (a, b) => (b.updatedAt ?? b.linkedAt) - (a.updatedAt ?? a.linkedAt)
      ),
    [meta?.pullRequests]
  )
  const now = useNow(
    1000,
    subagentItems.some((agent) => agent.status === 'running')
  )
  const minuteNow = useNow(60_000)

  function sectionProps(id: SectionId) {
    return {
      open: !collapsed.includes(id),
      onOpenChange: (open: boolean) => {
        const next = open ? collapsed.filter((entry) => entry !== id) : [...collapsed, id]
        setCollapsed(next)
        storage.set(collapsedKey, JSON.stringify(next))
      },
    }
  }

  const done = todos.filter((todo) => todo.status === 'done').length
  const empty =
    todos.length === 0 &&
    subagentItems.length === 0 &&
    workflows.length === 0 &&
    childThreads.length === 0 &&
    pullRequests.length === 0 &&
    files.length === 0

  if (empty)
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-sm text-muted-foreground'>Nothing yet</p>
      </div>
    )

  return (
    <div className='scrollbar-subtle h-full overflow-auto'>
      <div className='flex flex-col gap-3 p-2 text-sm'>
        {todos.length > 0 && (
          <Section label='Todos' count={`${done}/${todos.length}`} {...sectionProps('todos')}>
            <div className='px-2.5 py-1.5'>
              <TodoList list={todos} />
            </div>
          </Section>
        )}
        {subagentItems.length > 0 && (
          <Section label='Subagents' count={subagentItems.length} {...sectionProps('subagents')}>
            <div className='flex flex-col gap-0.5'>
              {subagentItems.map((item) => (
                <SubagentRow
                  key={item.id}
                  agent={toSubagent(item, now)}
                  selected={tab === item.id}
                  onSelect={() => {
                    setTab(item.id)
                    onShowChat()
                  }}
                />
              ))}
            </div>
          </Section>
        )}
        {workflows.length > 0 && (
          <Section label='Workflows' count={workflows.length} {...sectionProps('workflows')}>
            <WorkflowLineGrid
              threadId={threadId}
              workflows={workflows}
              lineClassName='px-2.5'
              onOpen={(workflow) => {
                reveal(threadId, workflow.id)
                onShowChat()
              }}
            />
          </Section>
        )}
        {childThreads.length > 0 && (
          <Section label='Threads' count={childThreads.length} {...sectionProps('threads')}>
            <ChildThreadList threads={childThreads} className='p-0' />
          </Section>
        )}
        {pullRequests.length > 0 && (
          <Section label='Pull requests' count={pullRequests.length} {...sectionProps('pulls')}>
            <div className='flex flex-col'>
              {pullRequests.map((link) => (
                <PullRequestRow key={`${link.repo}#${link.number}`} link={link} now={minuteNow} />
              ))}
            </div>
          </Section>
        )}
        {files.length > 0 && (
          <Section label='Changes' count={files.length} {...sectionProps('changes')}>
            <div className='flex flex-col'>
              {files.slice(0, changedFileLimit).map((file) => (
                <ChangedFileRow key={file.path} file={file} onOpen={onShowChanges} />
              ))}
              {files.length > changedFileLimit && (
                <Button
                  variant='ghost-text'
                  size='sm'
                  className='w-fit rounded-sm px-2.5 font-normal'
                  onClick={onShowChanges}
                >
                  +{files.length - changedFileLimit} more
                </Button>
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({
  label,
  count,
  open,
  onOpenChange,
  children,
}: {
  label: string
  count: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className='min-w-0'>
      <CollapsibleTrigger
        render={<Button variant='secondary' size='sm' />}
        className='group/section w-full justify-start gap-2 rounded-sm px-2.5 active:translate-y-0'
      >
        {label}
        <span className='font-mono font-normal text-muted-foreground tabular-nums'>{count}</span>
        <ChevronRightIcon className='ml-auto text-muted-foreground transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/section:rotate-90 motion-reduce:transition-none' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='pt-1'>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PullRequestRow({ link, now }: { link: PullRequestLink; now: number }) {
  const pr = prPresentation[link.state ?? 'open']
  const age = formatAge(link.updatedAt ?? link.linkedAt, now)
  return (
    <Button
      variant='ghost'
      data-overflow-hover
      onClick={() => window.open(link.url, '_blank', 'noopener')}
      className='h-auto w-full min-w-0 flex-col items-stretch gap-1.5 rounded-sm px-2.5 py-1.5 text-left font-normal active:translate-y-0'
    >
      <span className='flex min-w-0 items-center justify-between gap-3 text-foreground'>
        <OverflowTitle focusable={false} className='font-normal leading-normal'>
          {link.title ?? `${link.repo}#${link.number}`}
        </OverflowTitle>
        <span className={cn('flex shrink-0 items-center', pr.color)} title={pr.label}>
          <pr.icon aria-hidden='true' className='size-3.5' />
          <span className='sr-only'>{pr.label}</span>
        </span>
      </span>
      <span className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
        <span className='truncate'>{link.repo}</span>
        <span className='shrink-0 font-mono'>#{link.number}</span>
        <span
          className='ml-auto mr-px shrink-0 font-mono'
          aria-label={age === 'now' ? 'Updated just now' : `Updated ${age} ago`}
        >
          {age}
        </span>
      </span>
    </Button>
  )
}

function ChangedFileRow({ file, onOpen }: { file: ChangedFile; onOpen: () => void }) {
  const slash = file.path.lastIndexOf('/')
  return (
    <Button
      variant='ghost'
      onClick={onOpen}
      title={file.path}
      className='h-7 w-full min-w-0 justify-start gap-2 rounded-sm px-2.5 text-left font-normal active:translate-y-0'
    >
      <span className='shrink-0 text-foreground'>{file.path.slice(slash + 1)}</span>
      <span className='min-w-0 truncate text-xs text-muted-foreground'>
        {file.path.slice(0, slash + 1)}
      </span>
      <span className='ml-auto flex shrink-0 gap-1.5 font-mono text-xs tabular-nums'>
        <span className='text-status-success'>+{file.added}</span>
        <span className='text-status-error'>−{file.removed}</span>
      </span>
    </Button>
  )
}
