import type { PullRequestListItem, PullRequestListTab } from '@jetty/shared/wire'

import { Loading } from '@/components/custom/loading'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { whenIdle } from '@/lib/preload'
import { pressProps } from '@/lib/press'
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
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ListFilterMenu } from './grouped_list_controls'
import {
  GroupedTable,
  GroupedTableTitle,
  TableLabels,
  type GroupedColumn,
  type TableGroup,
} from './grouped_table'
import { RefreshIcon } from './huge_icons'
import { Clock01Icon, Tag01Icon, UserIcon, CheckListIcon, CancelCircleIcon } from './huge_icons'
import {
  Alert02Icon,
  ShieldCheckIcon,
  ShieldOffIcon,
  LeftToRightListBulletIcon,
} from './huge_icons'
import {
  GitPullRequestIcon,
  GitPullRequestDraftIcon,
  GitPullRequestClosedIcon,
  GitMergeIcon,
  DiffIcon,
} from './lucide_icons'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { PersonAvatar } from './person_avatar'
import {
  pullRequestGroupLabel,
  pullRequestGroupOrder,
  pullRequestIdentifier,
  pullRequestSignals,
  type PullRequestGroup,
} from './pull_request_list_model'

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
    icon: <GitPullRequestIcon className='size-3.5 text-pr-open' />,
  },
  draft: {
    color: 'var(--muted-foreground)',
    icon: <GitPullRequestDraftIcon className='size-3.5 text-muted-foreground' />,
  },
  merged: { color: 'var(--pr-merged)', icon: <GitMergeIcon className='size-3.5 text-pr-merged' /> },
  closed: {
    color: 'var(--destructive)',
    icon: <GitPullRequestClosedIcon className='size-3.5 text-destructive' />,
  },
}

const openedRows: Partial<Record<PullRequestListTab, string>> = {}

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
  const [opened, setOpened] = useState(() => ({ ...openedRows }))
  const now = useNow(60_000)
  const pulls = list?.items ?? []
  const failure = list && list.status !== 'ready' && list.status !== 'loading'
  function onSelect(pull: PullRequestListItem) {
    perf.start('pr.open', { pr: pull.number })
    openedRows[tab] = pull.url
    setOpened({ ...openedRows })
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
  const [included, setIncluded] = useState(pullRequestGroupOrder)
  const rows = pulls
    .filter((pull) => included.includes(pull.state))
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
  const groups: TableGroup<PullRequestListItem>[] = pullRequestGroupOrder
    .map((group) => ({
      id: group,
      label: pullRequestGroupLabel[group],
      ...groupPresentation[group],
      rows: rows.filter((pull) => pull.state === group),
      defaultCollapsed: group === 'closed' || group === 'merged',
    }))
    .filter((group) => group.rows.length)
  const columns: GroupedColumn<PullRequestListItem>[] = [
    {
      id: 'state',
      label: 'State',
      icon: <GitPullRequestIcon />,
      priority: 100,
      width: 26,
      essential: true,
      render: (pull) => <PullRequestStateGlyph pull={pull} />,
    },
    {
      id: 'identifier',
      label: 'Repository and number',
      icon: <span className='text-xs'>#</span>,
      priority: 30,
      width: 122,
      render: (pull) => (
        <span
          className='truncate font-mono text-xs text-muted-foreground'
          title={`${pull.repo}#${pull.number}`}
        >
          {pullRequestIdentifier(pull)}
        </span>
      ),
    },
    {
      id: 'author',
      label: 'Creator',
      icon: <UserIcon />,
      priority: 100,
      width: 28,
      essential: true,
      render: (pull) => (
        <span title={`Created by ${pull.author?.name ?? pull.author?.login ?? 'Unknown'}`}>
          <PersonAvatar
            login={pull.author?.login ?? 'Unknown'}
            src={pull.author?.avatar_url}
            className='size-4'
          />
          <span className='sr-only'>{pull.author?.name ?? pull.author?.login ?? 'Unknown'}</span>
        </span>
      ),
    },
    {
      id: 'title',
      label: 'Title',
      icon: <LeftToRightListBulletIcon />,
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
      id: 'labels',
      label: 'Labels',
      icon: <Tag01Icon />,
      priority: 10,
      width: 150,
      render: (pull) => (
        <TableLabels
          labels={(pull.labels ?? []).map((label) => ({ ...label, color: `#${label.color}` }))}
        />
      ),
    },
    {
      id: 'checks',
      label: 'Checks',
      icon: <CheckListIcon />,
      priority: 70,
      width: 28,
      render: (pull) => <PullRequestChecksGlyph pull={pull} />,
    },
    {
      id: 'review',
      label: 'Review',
      icon: <ShieldCheckIcon />,
      priority: 60,
      width: 28,
      render: (pull) => <PullRequestReviewGlyph pull={pull} />,
    },
    {
      id: 'diff',
      label: 'Additions and deletions',
      icon: <DiffIcon />,
      priority: 20,
      width: 98,
      render: (pull) => (
        <span className='flex gap-2 font-mono text-xs tabular-nums'>
          <span className='text-pr-open'>+{pull.additions ?? '—'}</span>
          <span className='text-destructive'>−{pull.deletions ?? '—'}</span>
        </span>
      ),
    },
    {
      id: 'age',
      label: 'Updated',
      icon: <Clock01Icon />,
      priority: 40,
      width: 48,
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
                size='sm'
                aria-pressed={tab === value}
                className='rounded-sm font-normal'
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
              <RefreshIcon
                className={cn(
                  refreshing && 'animate-spin [animation-duration:700ms] motion-reduce:animate-none'
                )}
              />
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
                ...pullRequestSignals(pull),
              ].join(', ')
            }
            onSelect={onSelect}
            onRowHover={onRowHover}
            selectedKey={opened[tab]}
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

function PullRequestStateGlyph({ pull }: { pull: PullRequestListItem }) {
  const Icon =
    pull.state === 'draft'
      ? GitPullRequestDraftIcon
      : pull.state === 'merged'
        ? GitMergeIcon
        : pull.state === 'closed'
          ? GitPullRequestClosedIcon
          : GitPullRequestIcon
  const color =
    pull.state === 'draft'
      ? 'text-muted-foreground'
      : pull.state === 'merged'
        ? 'text-pr-merged'
        : pull.state === 'closed'
          ? 'text-destructive'
          : 'text-pr-open'
  return <Icon className={`size-3.5 ${color}`} aria-label={pull.state} />
}

function PullRequestChecksGlyph({ pull }: { pull: PullRequestListItem }) {
  if (pull.checks !== 'failure' && pull.checks !== 'pending') return null
  const failing = pull.checks === 'failure'
  const Icon = failing ? CancelCircleIcon : Clock01Icon
  return (
    <span
      title={failing ? 'Checks failing' : 'Checks running'}
      className={failing ? 'text-destructive' : 'text-status-attention'}
    >
      <Icon className='size-3.5' />
      <span className='sr-only'>{failing ? 'Checks failing' : 'Checks running'}</span>
    </span>
  )
}

function PullRequestReviewGlyph({ pull }: { pull: PullRequestListItem }) {
  if (pull.mergeable === 'CONFLICTING' && pull.state === 'open')
    return (
      <span title='Merge conflicts' className='text-destructive'>
        <Alert02Icon className='size-3.5' />
        <span className='sr-only'>Merge conflicts</span>
      </span>
    )
  if (!pull.reviewDecision || pull.reviewDecision === 'REVIEW_REQUIRED') return null
  const approved = pull.reviewDecision === 'APPROVED'
  const Icon = approved ? ShieldCheckIcon : ShieldOffIcon
  return (
    <span
      title={approved ? 'Approved' : 'Changes requested'}
      className={approved ? 'text-pr-open' : 'text-destructive'}
    >
      <Icon className='size-3.5' />
      <span className='sr-only'>{approved ? 'Approved' : 'Changes requested'}</span>
    </span>
  )
}
