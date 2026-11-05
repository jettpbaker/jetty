import type { ThreadItem } from '@jetty/shared/items'

import {
  ChevronRightSmallIcon,
  ListBulletsIcon,
  ChangesIcon,
  PullRequestIcon,
} from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useNow } from '@/hooks/use-now'
import { formatDuration } from '@/lib/time'
import { storage } from '@/platform'
import {
  useOverviewItems,
  useRequestReveal,
  useRevealSection,
  useThreadDiff,
  useOpenSubagent,
  useSubagents,
  useThreadMeta,
  useProject,
  useModels,
  useThreadContext,
  type SubagentSummary,
} from '@/state'
import { catalogModelName } from '@jetty/shared/model-name'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ChildThreadList, type ChildThread } from './child_threads'
import { environments } from './composer_environment'
import { TodoList } from './composer_strip'
import { ContentEmpty } from './content_empty'
import { CopyButton } from './copy_button'
import { DiffCounts } from './diff/file_card'
import { CatalogModelLabel } from './model_label'
import { LinkPullRequestDialog } from './pull_request_link'
import { PullRequestRow } from './pull_request_row'
import { RunningTaskRow } from './running_task_row'
import { subagentGlyphLabel, subagentGlyphState } from './subagent_glyph'
import { threadSubagents } from './thread_rows'
import { StatusGlyph } from './thread_status'
import { WorkflowLineGrid } from './workflow_lines'
import { type Workflow } from './workflow_parts'

// The list's top padding, kept above a revealed section.
const sectionInset = 8

function threadWorkflows(items: readonly ThreadItem[]) {
  return items.filter((item): item is Workflow => item.kind === 'workflow')
}

export function useHasOverview(threadId: string, childThreads: readonly ChildThread[]) {
  const { items, todos } = useOverviewItems(threadId)
  const meta = useThreadMeta(threadId)
  const pullRequests = meta?.pullRequests
  const hasItems =
    (meta?.backgroundTasks?.length ?? 0) > 0 ||
    items.some((item) => item.kind === 'subagent' || item.kind === 'workflow') ||
    todos.length > 0
  return hasItems || childThreads.length > 0 || (pullRequests?.length ?? 0) > 0
}

function loadCollapsed(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(storage.get(key) ?? '[]')
    return Array.isArray(saved) ? (saved as string[]) : []
  } catch {
    return []
  }
}

// An overview's collapsed sections, remembered under `key`.
export function useCollapsedSections(key: string) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(key))
  useEffect(() => {
    storage.set(key, JSON.stringify(collapsed))
  }, [key, collapsed])
  function sectionProps(id: string) {
    return {
      id,
      open: !collapsed.includes(id),
      onOpenChange: (open: boolean) =>
        setCollapsed((current) =>
          open ? current.filter((entry) => entry !== id) : [...current, id]
        ),
    }
  }
  return { setCollapsed, sectionProps }
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
  const { items, todos } = useOverviewItems(threadId)
  const meta = useThreadMeta(threadId)
  const agents = useSubagents(threadId)
  const reveal = useRequestReveal()
  const { diff } = useThreadDiff(threadId)
  const { setCollapsed, sectionProps } = useCollapsedSections('jetty.overview.collapsed')
  const [revealing, clearReveal] = useRevealSection(threadId)
  const scroller = useRef<HTMLDivElement>(null)
  const [linking, setLinking] = useState(false)

  const subagentItems = threadSubagents(items)
  const workflows = threadWorkflows(items)
  const files = useMemo(() => (diff ? changedFiles(diff.diff) : []), [diff])
  const pullRequests = useMemo(
    () =>
      (meta?.pullRequests ?? []).toSorted(
        (a, b) => (b.updatedAt ?? b.linkedAt) - (a.updatedAt ?? a.linkedAt)
      ),
    [meta?.pullRequests]
  )
  const minuteNow = useNow(60_000)

  // A section only moves when something above it opens, so its header can be scrolled to before
  // it finishes opening.
  useLayoutEffect(() => {
    if (!revealing) return
    clearReveal()
    const sectionId = ['subagents', 'threads'].includes(revealing) ? 'activity' : revealing
    setCollapsed((current) => current.filter((entry) => entry !== sectionId))
    const element = scroller.current
    const section = element?.querySelector(`[data-section='${sectionId}']`)
    if (!element || !section) return
    element.scrollTop +=
      section.getBoundingClientRect().top - element.getBoundingClientRect().top - sectionInset
  }, [revealing, clearReveal, setCollapsed])

  const done = todos.filter((todo) => todo.status === 'done').length
  const running = meta?.backgroundTasks ?? []
  const empty =
    running.length === 0 &&
    todos.length === 0 &&
    subagentItems.length === 0 &&
    workflows.length === 0 &&
    childThreads.length === 0 &&
    pullRequests.length === 0 &&
    files.length === 0

  return (
    <div ref={scroller} className='scrollbar-subtle h-full overflow-auto'>
      <div className='flex min-h-full flex-col gap-5 p-2 text-13'>
        <ThreadProperties threadId={threadId} />
        {empty && (
          <ContentEmpty
            icon={ListBulletsIcon}
            title='No activity yet'
            description='Plans, subagents and linked pull requests will appear here as work progresses.'
            className='min-h-80'
          >
            <Button variant='outline' size='sm' onClick={() => setLinking(true)}>
              <PullRequestIcon data-icon='inline-start' />
              Link pull request
            </Button>
          </ContentEmpty>
        )}
        {running.length > 0 && (
          <Section label='Running' count={running.length} {...sectionProps('running')}>
            <div className='flex flex-col'>
              {running.map((task) => (
                <RunningTaskRow key={task.id} threadId={threadId} task={task} />
              ))}
            </div>
          </Section>
        )}
        {todos.length > 0 && (
          <Section label='Todos' count={`${done}/${todos.length}`} {...sectionProps('todos')}>
            <div className='px-2.5 py-1.5 [&_li>svg]:size-4'>
              <TodoList list={todos} />
            </div>
          </Section>
        )}
        {(subagentItems.length > 0 || childThreads.length > 0) && (
          <Section
            label='Activity'
            count={subagentItems.length + childThreads.length}
            {...sectionProps('activity')}
          >
            <SubagentList threadId={threadId} agents={agents} showType />
            <ChildThreadList threads={childThreads} className='p-0' showType />
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
        {pullRequests.length > 0 && (
          <Section label='Pull requests' count={pullRequests.length} {...sectionProps('pulls')}>
            <div className='flex flex-col'>
              {pullRequests.map((link) => (
                <PullRequestRow
                  key={`${link.repo}#${link.number}`}
                  threadId={threadId}
                  link={link}
                  now={minuteNow}
                />
              ))}
            </div>
          </Section>
        )}
        {files.length > 0 && (
          <Button
            variant='ghost'
            size='sm'
            data-section='changes'
            className='h-9 w-full justify-start gap-2 rounded-sm px-2.5 text-13 font-normal'
            onClick={onShowChanges}
          >
            <ChangesIcon />
            {files.length} {files.length === 1 ? 'file' : 'files'} changed
            <span className='ml-auto'>
              <DiffCounts
                files={files.map((file) => ({ additions: file.added, deletions: file.removed }))}
                hideZero
              />
            </span>
            <ChevronRightSmallIcon />
          </Button>
        )}
      </div>
      <LinkPullRequestDialog threadId={threadId} open={linking} onOpenChange={setLinking} />
    </div>
  )
}

function ThreadProperties({ threadId }: { threadId: string }) {
  const meta = useThreadMeta(threadId)
  const project = useProject(meta?.projectId)
  const models = useModels()
  const context = useThreadContext(threadId)
  const [expanded, setExpanded] = useState(false)
  if (!meta) return null
  const environment = environments[meta.environment]
  const branch = meta.git?.branch ?? meta.worktree?.branch
  const path = meta.workingPath ?? (meta.environment === 'local' ? project?.path : undefined)
  const model = catalogModelName(models, meta.provider, meta.model)
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Project', value: project?.title ?? 'Project unavailable' },
    { label: 'Environment', value: environment.label },
    ...(branch
      ? [{ label: 'Branch', value: <span className='font-mono wrap-anywhere'>{branch}</span> }]
      : []),
    ...(path
      ? [
          {
            label: 'Folder',
            value: (
              <span className='flex min-w-0 items-start gap-1'>
                <span className='min-w-0 flex-1 font-mono text-xs leading-5 wrap-anywhere'>
                  {path}
                </span>
                <CopyButton text={path} label='Copy working folder path' />
              </span>
            ),
          },
        ]
      : []),
    ...(model
      ? [
          {
            label: 'Model',
            value: (
              <>
                <CatalogModelLabel
                  catalog={models}
                  provider={meta.provider}
                  model={meta.model}
                  effort={meta.effort}
                />
              </>
            ),
          },
        ]
      : []),
    ...(context
      ? [
          {
            label: 'Context',
            value: (
              <span className='font-mono'>
                {Math.round((context.usedTokens / context.maxTokens) * 100)}%
              </span>
            ),
          },
        ]
      : []),
  ]
  return (
    <section aria-label='Thread properties' className='min-w-0 border-b border-border pb-2'>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          render={<Button variant='ghost' />}
          aria-label='Thread environment details'
          className='group/environment h-14 w-full min-w-0 justify-start gap-2.5 px-2.5 text-left font-normal'
        >
          <environment.Icon className='text-muted-foreground' />
          <span className='flex min-w-0 flex-1 flex-col gap-1'>
            <span className='truncate text-13 text-foreground'>
              {project?.title ?? 'Project unavailable'}
            </span>
            <span className='flex min-w-0 items-center gap-2 text-xs'>
              <span className='shrink-0 text-muted-foreground'>{environment.label}</span>
              {branch && (
                <span className='truncate font-mono text-foreground' title={branch}>
                  {branch}
                </span>
              )}
            </span>
          </span>
          <ChevronRightSmallIcon className='shrink-0 text-muted-foreground group-aria-expanded/environment:rotate-90' />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className='flex flex-col px-2.5 pt-2 pb-1'>
            {rows.map(({ label, value }) => (
              <div
                key={label}
                className='grid min-h-7 grid-cols-[96px_minmax(0,1fr)] items-start gap-3 py-1'
              >
                <dt className='text-xs leading-5 text-muted-foreground'>{label}</dt>
                <dd className='min-w-0 text-13 leading-5 text-foreground'>{value}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

export function SubagentList({
  threadId,
  agents,
  showType,
}: {
  threadId: string
  agents: readonly SubagentSummary[]
  showType?: boolean
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      {agents.map((agent) => (
        <SubagentRow key={agent.id} threadId={threadId} agent={agent} showType={showType} />
      ))}
    </div>
  )
}

function SubagentRow({
  threadId,
  agent,
  showType,
}: {
  threadId: string
  agent: SubagentSummary
  showType?: boolean
}) {
  const open = useOpenSubagent()
  const now = useNow(1000, agent.status === 'running')
  const state = subagentGlyphState(agent.status, agent.waiting)
  const status =
    agent.status === 'running'
      ? agent.waiting
        ? 'needs-attention'
        : 'working'
      : agent.status === 'completed'
        ? 'done'
        : agent.status === 'failed'
          ? 'error'
          : 'stopped'
  const endedAt = agent.completedAt ?? (agent.status === 'running' ? now : undefined)
  const durationMs =
    agent.durationMs ?? (endedAt === undefined ? undefined : Math.max(0, endedAt - agent.createdAt))
  return (
    <Button
      variant='ghost'
      size='sm'
      className='h-auto min-h-10 w-full justify-start gap-2 rounded-sm px-2.5 py-1 text-13 font-normal'
      onClick={() => open(threadId, agent.id)}
    >
      <StatusGlyph status={status} className='size-4 self-start mt-0.5' />
      <span className='flex min-w-0 flex-1 flex-col gap-0.5 text-left'>
        <span className='leading-5 wrap-anywhere whitespace-normal'>{agent.title}</span>
        <span className='text-xs text-muted-foreground'>
          {subagentGlyphLabel(state)}
          {durationMs !== undefined && (
            <>
              {' '}
              · <span className='font-mono'>{formatDuration(durationMs / 1000)}</span>
            </>
          )}
        </span>
      </span>
      {showType && (
        <span className='shrink-0 self-start pt-0.5 text-xs text-muted-foreground'>Subagent</span>
      )}
    </Button>
  )
}

export function Section({
  id,
  label,
  count,
  open,
  onOpenChange,
  children,
}: {
  id: string
  label: string
  count: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} data-section={id} className='min-w-0'>
      <CollapsibleTrigger
        render={<Button variant='ghost-text' />}
        className='group/section h-7 w-full justify-start gap-2 rounded-sm px-2.5 text-xs'
      >
        {label}
        <span className='font-mono font-normal text-muted-foreground tabular-nums'>{count}</span>
        <ChevronRightSmallIcon className='ml-auto text-muted-foreground transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/section:rotate-90 motion-reduce:transition-none' />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='pt-2'>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
