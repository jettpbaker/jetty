import type { PullRequestListItem, PullRequestListTab } from '@jetty/shared/wire'

import { Loading } from '@/components/custom/loading'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { whenIdle } from '@/lib/preload'
import { pressProps } from '@/lib/press'
import { useStoredState } from '@/lib/stored-state'
import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'
import { perf } from '@/perf'
import {
  usePrefetchPullRequest,
  usePrefetchPullRequestList,
  usePullRequestList,
  useRefreshPullRequestList,
} from '@/state'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, type ReactNode } from 'react'

import { ListFilterMenu, ListGroupMenu } from './grouped_list_controls'
import {
  GroupedTable,
  GroupedTableTitle,
  type GroupedColumn,
  type TableGroup,
} from './grouped_table'
import { Refresh01Icon } from './huge_icons'
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from './lucide_icons'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { PersonAvatar } from './person_avatar'
import {
  pullRequestGroupLabel,
  pullRequestGroupOrder,
  pullRequestIdentifier,
  type PullRequestGroup,
} from './pull_request_list_model'
import { linkPresentation } from './thread_pull_request'

type PullRequestListProps = {
  tab: PullRequestListTab
  onTabChange: (tab: PullRequestListTab) => void
}
const unavailableTitle = {
  unavailable: 'GitHub unavailable',
  rate_limited: 'GitHub rate limit reached',
}

const groupPresentation: Record<PullRequestGroup, { color: string; icon: ReactNode }> = {
  open: {
    color: 'var(--pr-open)',
    icon: <GitPullRequestIcon className='size-3 text-pr-open' />,
  },
  draft: {
    color: 'var(--muted-foreground)',
    icon: <GitPullRequestDraftIcon className='size-3 text-muted-foreground' />,
  },
  merged: { color: 'var(--pr-merged)', icon: <GitMergeIcon className='size-3 text-pr-merged' /> },
  closed: {
    color: 'var(--destructive)',
    icon: <GitPullRequestClosedIcon className='size-3 text-destructive' />,
  },
}

const compactLines = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 })

// Whole thousands from 10k keep the widest count ("+9999 −9999") inside its column.
function formatLines(lines: number | undefined) {
  if (lines === undefined) return '—'
  return lines < 10_000 ? String(lines) : compactLines.format(lines).toLowerCase()
}

export function PullRequestList({ tab, onTabChange }: PullRequestListProps) {
  const { list, refreshing } = usePullRequestList(tab)
  const refresh = useRefreshPullRequestList()
  const prefetch = usePrefetchPullRequest()
  const prefetchList = usePrefetchPullRequestList()
  const warmed = useRef(new Set<PullRequestListTab>())
  useEffect(() => {
    if (list?.status !== 'ready' || warmed.current.has(tab)) return
    return whenIdle(() => {
      warmed.current.add(tab)
      prefetchList(tab)
    })
  }, [list?.status, tab, prefetchList])
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null)
  const now = useNow(60_000)
  const pulls = list?.items ?? []
  const failure = list && list.status !== 'ready' && list.status !== 'loading'
  function onSelect(pull: PullRequestListItem) {
    perf.start('pr.open', { pr: pull.number })
  }
  function onRowHover(pull: PullRequestListItem | null) {
    if (hover.current !== null) clearTimeout(hover.current)
    hover.current = pull
      ? setTimeout(() => {
          hover.current = null
          prefetch(pull)
        }, 50)
      : null
  }
  useEffect(
    () => () => {
      if (hover.current !== null) clearTimeout(hover.current)
      hover.current = null
    },
    [tab, prefetch]
  )
  const [included, setIncluded] = useStoredState(
    'jetty.pullRequests.states',
    pullRequestGroupOrder,
    (value): value is PullRequestGroup[] =>
      Array.isArray(value) && value.every((state) => pullRequestGroupOrder.includes(state))
  )
  const [groupBy, setGroupBy] = useStoredState<'state' | 'repo'>(
    'jetty.pullRequests.groupBy',
    'state',
    (value): value is 'state' | 'repo' => value === 'state' || value === 'repo'
  )
  const rows = pulls
    .filter((pull) => included.includes(pull.state))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
  const groups: TableGroup<PullRequestListItem>[] =
    groupBy === 'repo'
      ? [...new Set(rows.map((pull) => pull.repo))].map((repo) => ({
          id: repo,
          label: repo.split('/').at(-1) ?? repo,
          color: 'var(--muted-foreground)',
          rows: rows.filter((pull) => pull.repo === repo),
        }))
      : pullRequestGroupOrder
          .map((group) => ({
            id: group,
            label: pullRequestGroupLabel[group],
            ...groupPresentation[group],
            labelColor: groupPresentation[group].color,
            rows: rows.filter((pull) => pull.state === group),
            defaultCollapsed: group === 'closed' || group === 'merged',
          }))
          .filter((group) => group.rows.length)
  const columns: GroupedColumn<PullRequestListItem>[] = [
    {
      id: 'state',
      priority: 100,
      width: 26,
      essential: true,
      render: (pull) => <PullRequestStateGlyph pull={pull} />,
    },
    {
      id: 'identifier',
      priority: 30,
      width: groupBy === 'repo' ? 56 : 122,
      render: (pull) => (
        <span
          className='truncate font-mono text-xs text-muted-foreground'
          title={`${pull.repo}#${pull.number}`}
        >
          {groupBy === 'repo' ? `#${pull.number}` : pullRequestIdentifier(pull)}
        </span>
      ),
    },
    {
      id: 'title',
      priority: 100,
      width: 280,
      title: true,
      render: (pull, { collapsed }) => (
        <GroupedTableTitle
          title={pull.title}
          secondary={pullRequestIdentifier(pull)}
          tucked={collapsed.has('identifier')}
        />
      ),
    },
    {
      id: 'diff',
      priority: 20,
      width: 100,
      render: (pull) => (
        <span
          className='ml-auto flex gap-2 font-mono text-xs tabular-nums'
          title={`+${pull.additions ?? '—'} −${pull.deletions ?? '—'}`}
        >
          <span className='text-pr-open'>+{formatLines(pull.additions)}</span>
          <span className='text-destructive'>−{formatLines(pull.deletions)}</span>
        </span>
      ),
    },
    {
      id: 'author',
      visible: tab !== 'created',
      priority: 100,
      width: 30,
      essential: true,
      render: (pull) => (
        <span title={`Created by ${pull.author?.name ?? pull.author?.login ?? 'Unknown'}`}>
          <PersonAvatar
            login={pull.author?.login ?? 'Unknown'}
            src={pull.author?.avatar_url}
            className='size-4.5 after:hidden'
          />
          <span className='sr-only'>{pull.author?.name ?? pull.author?.login ?? 'Unknown'}</span>
        </span>
      ),
    },
    {
      id: 'age',
      priority: 40,
      width: 30,
      render: (pull) => (
        <span
          className='font-mono text-xs text-muted-foreground tabular-nums'
          title={new Date(pull.updatedAt).toLocaleString()}
        >
          {formatAge(pull.updatedAt, now)}
        </span>
      ),
    },
  ]
  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col'>
      <header className='flex h-(--app-tab-bar-height,42px) shrink-0 items-center justify-between gap-2 border-b border-border pl-(--page-header-inset,16px) pr-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <PageSidebarTrigger />
          <h1 className='truncate text-sm font-medium'>Pull requests</h1>
          <nav aria-label='Pull requests' className='flex gap-1'>
            {(['for-you', 'created'] as const).map((value) => (
              <Button
                key={value}
                variant='ghost'
                tone='muted'
                size='sm'
                aria-pressed={tab === value}
                className='rounded-sm font-normal aria-pressed:bg-accent'
                {...pressProps(() => onTabChange(value))}
              >
                {value === 'for-you' ? 'For you' : 'Created'}
              </Button>
            ))}
          </nav>
        </div>
        <div className='flex items-center gap-1'>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  tone='muted'
                  size='icon'
                  className={cn('h-7', failure && !refreshing && 'text-destructive')}
                  aria-label='Refresh'
                  {...pressProps(() => refresh(tab))}
                />
              }
            >
              {refreshing ? <Spinner /> : <Refresh01Icon />}
            </TooltipTrigger>
            <TooltipContent>
              {failure && !refreshing ? `Couldn't refresh: ${list.error}` : 'Refresh'}
            </TooltipContent>
          </Tooltip>
          <ListFilterMenu
            label='State'
            choices={pullRequestGroupOrder.map((value) => ({
              value,
              label: pullRequestGroupLabel[value],
            }))}
            selected={included}
            onChange={(value, checked) =>
              setIncluded((current) =>
                checked ? [...current, value] : current.filter((group) => group !== value)
              )
            }
          />
          <ListGroupMenu
            choices={[
              { value: 'state', label: 'Status' },
              { value: 'repo', label: 'Repository' },
            ]}
            value={groupBy}
            onChange={setGroupBy}
          />
        </div>
      </header>
      {list?.items ? (
        <>
          <GroupedTable
            label='Pull requests'
            columns={columns}
            groups={groups}
            rowKey={(pull) => pull.url}
            rowLabel={(pull) =>
              [
                pullRequestIdentifier(pull),
                pull.title,
                `by ${pull.author?.name ?? pull.author?.login ?? 'Unknown'}`,
                linkPresentation(pull).label,
              ].join(', ')
            }
            onSelect={onSelect}
            onRowHover={onRowHover}
            renderRow={(pull) => {
              const [owner = '', repo = ''] = pull.repo.split('/')
              return (
                <Link
                  to='/pull-requests/$owner/$repo/$number'
                  params={{ owner, repo, number: String(pull.number) }}
                />
              )
            }}
            empty={pulls.length ? 'No pull requests match these filters.' : 'No pull requests'}
          />
          {list.truncated && (
            <p className='px-4 py-2 text-xs text-muted-foreground'>Showing latest {pulls.length}</p>
          )}
        </>
      ) : failure ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center'>
          <div className='flex flex-col gap-1'>
            <p className='text-sm'>{unavailableTitle[list.status]}</p>
            {list.error && <p className='text-xs text-muted-foreground'>{list.error}</p>}
          </div>
          <Button variant='outline' size='sm' disabled={refreshing} onClick={() => refresh(tab)}>
            Try again
          </Button>
        </div>
      ) : (
        <Loading label='Loading pull requests…' />
      )}
    </div>
  )
}

// The list draws draft muted and closed destructive; an open PR takes its readiness colour.
const listColor = {
  draft: 'text-muted-foreground',
  merged: 'text-pr-merged',
  closed: 'text-destructive',
}

function PullRequestStateGlyph({ pull }: { pull: PullRequestListItem }) {
  const { icon: Icon, color, label } = linkPresentation(pull)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn('flex', pull.state === 'open' ? color : listColor[pull.state])} />
        }
      >
        <Icon aria-hidden='true' className='size-3.5' />
        <span className='sr-only'>{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
