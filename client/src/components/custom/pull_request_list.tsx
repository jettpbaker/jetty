import type { PullRequestListItem, PullRequestListTab } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { pressProps } from '@/lib/press'
import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'
import { storage } from '@/platform'
import { usePrefetchPullRequest, usePullRequestList, useRefreshPullRequestList } from '@/state'
import { ArrowClockwiseIcon, CheckCircleIcon, XCircleIcon } from '@phosphor-icons/react'
import { ChevronRightIcon, EyeIcon, PersonIcon } from '@primer/octicons-react'
import { Link } from '@tanstack/react-router'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { InProgressIcon } from './in_progress_icon'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { prPresentation } from './thread_pull_request'
import './thread_details_layout.css'

type PullRequestState = PullRequestListItem['state']

const groupOrder: readonly PullRequestState[] = ['open', 'draft', 'merged', 'closed']

const scrollTops = new Map<PullRequestListTab, number>()

function collapsedKey(tab: PullRequestListTab) {
  return `jetty.pull-requests.collapsed.${tab}`
}

function loadCollapsed(tab: PullRequestListTab): ReadonlySet<PullRequestState> {
  try {
    const saved: unknown = JSON.parse(storage.get(collapsedKey(tab)) ?? '[]')
    return new Set(Array.isArray(saved) ? (saved as PullRequestState[]) : [])
  } catch {
    return new Set()
  }
}

const unavailableTitle = {
  unavailable: 'GitHub unavailable',
  rate_limited: 'GitHub rate limit reached',
}

export function PullRequestList({
  tab,
  onTabChange,
}: {
  tab: PullRequestListTab
  onTabChange: (tab: PullRequestListTab) => void
}) {
  const { list, refreshing } = usePullRequestList(tab)
  const refresh = useRefreshPullRequestList()
  const failure = list && list.status !== 'ready' && list.status !== 'loading'
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex h-(--app-tab-bar-height) shrink-0 items-center justify-between border-b border-border pl-(--page-header-inset) pr-4'>
        <div className='flex items-center gap-2'>
          <PageSidebarTrigger />
          <h1 className='text-sm font-medium'>Pull requests</h1>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              if (value === 'for-you' || value === 'created') onTabChange(value)
            }}
          >
            <TabsList variant='line' aria-label='Pull request lists' className='h-7 gap-1 p-0'>
              <TabsTrigger
                value='for-you'
                className="details-header-tab h-auto rounded-sm px-2 py-1 text-xs [&_svg:not([class*='size-'])]:size-3"
              >
                <EyeIcon data-icon='inline-start' />
                For you
              </TabsTrigger>
              <TabsTrigger
                value='created'
                className="details-header-tab h-auto rounded-sm px-2 py-1 text-xs [&_svg:not([class*='size-'])]:size-3"
              >
                <PersonIcon data-icon='inline-start' />
                Created
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
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
            <ArrowClockwiseIcon
              className={cn(
                refreshing && 'animate-spin [animation-duration:700ms] motion-reduce:animate-none'
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {failure && !refreshing ? `Couldn't refresh: ${list.error}` : 'Refresh'}
          </TooltipContent>
        </Tooltip>
      </header>
      {list?.items ? (
        list.items.length > 0 ? (
          <PullRequestGroups
            key={tab}
            tab={tab}
            items={list.items}
            truncated={list.truncated ?? false}
          />
        ) : (
          <div className='flex flex-1 items-center justify-center p-4'>
            <p className='text-sm text-muted-foreground'>No pull requests</p>
          </div>
        )
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
        <p className='p-4 text-xs text-muted-foreground'>Loading pull requests…</p>
      )}
    </div>
  )
}

function PullRequestGroups({
  tab,
  items,
  truncated,
}: {
  tab: PullRequestListTab
  items: readonly PullRequestListItem[]
  truncated: boolean
}) {
  const list = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(tab))
  const now = useNow(60_000)
  const showRepo = new Set(items.map((item) => item.repo)).size > 1
  const groups = groupOrder.flatMap((state) => {
    const members = items.filter((item) => item.state === state)
    return members.length ? [{ state, items: members }] : []
  })

  function moveFocus(event: KeyboardEvent<HTMLAnchorElement>) {
    const step = { ArrowDown: 1, ArrowUp: -1, j: 1, k: -1 }[event.key]
    if (step === undefined || !list.current) return
    const rows = Array.from(list.current.querySelectorAll<HTMLElement>('[data-pr-row]'))
    const index = rows.indexOf(document.activeElement as HTMLElement)
    const next =
      rows[
        index === -1
          ? step > 0
            ? 0
            : rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, index + step))
      ]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  function toggle(state: PullRequestState, open: boolean) {
    const next = new Set(collapsed)
    if (open) next.delete(state)
    else next.add(state)
    setCollapsed(next)
    storage.set(collapsedKey(tab), JSON.stringify([...next]))
  }

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = scrollTops.get(tab) ?? 0
  }, [tab])

  return (
    <div
      ref={list}
      onScroll={(event) => scrollTops.set(tab, event.currentTarget.scrollTop)}
      className='scroll-fade-b scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain'
    >
      {groups.map((group) => {
        const pr = prPresentation[group.state]
        return (
          <Collapsible
            key={group.state}
            open={!collapsed.has(group.state)}
            onOpenChange={(open) => toggle(group.state, open)}
            render={<section aria-label={pr.label} />}
          >
            <CollapsibleTrigger className='group/section sticky top-0 z-10 flex h-8 w-full items-center gap-1.5 bg-background px-4 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:bg-accent'>
              <ChevronRightIcon className='size-3 transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/section:rotate-90 motion-reduce:transition-none' />
              <pr.icon aria-hidden='true' className={cn('size-3.5', pr.color)} />
              <span className='font-medium text-foreground'>{pr.label}</span>
              <span
                className='font-mono tabular-nums'
                aria-label={`${group.items.length} pull request${group.items.length === 1 ? '' : 's'}`}
              >
                {group.items.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {group.items.map((item) => (
                <PullRequestListRow
                  key={`${item.repo}#${item.number}`}
                  item={item}
                  now={now}
                  showRepo={showRepo}
                  onKeyDown={moveFocus}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
      {truncated && (
        <p className='px-4 py-2 text-xs text-muted-foreground'>Showing latest {items.length}</p>
      )}
    </div>
  )
}

function PullRequestListRow({
  item,
  now,
  showRepo,
  onKeyDown,
}: {
  item: PullRequestListItem
  now: number
  showRepo: boolean
  onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void
}) {
  const prefetch = usePrefetchPullRequest()
  const [owner = '', repo = ''] = item.repo.split('/')
  const pr = prPresentation[item.state]
  const age = formatAge(item.updatedAt, now)
  return (
    <Link
      data-pr-row
      to='/pull-requests/$owner/$repo/$number'
      params={{ owner, repo, number: String(item.number) }}
      onPointerEnter={() => prefetch(item)}
      onKeyDown={onKeyDown}
      className='flex h-9 min-w-0 cursor-default items-center gap-2.5 px-4 text-sm outline-none hover:bg-accent/50 focus-visible:bg-accent'
    >
      <span className='w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums'>
        #{item.number}
      </span>
      <span className={cn('flex shrink-0 items-center', pr.color)} title={pr.label}>
        <pr.icon aria-hidden='true' className='size-3.5' />
        <span className='sr-only'>{pr.label}</span>
      </span>
      <span className='min-w-0 flex-1 truncate'>{item.title}</span>
      <span
        className={cn(
          'max-w-2/5 min-w-0 truncate text-xs text-muted-foreground',
          !showRepo && 'sr-only'
        )}
      >
        {item.repo}
      </span>
      <ChecksMark checks={item.checks} />
      <span
        className='w-8 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums'
        aria-label={age === 'now' ? 'Updated just now' : `Updated ${age} ago`}
      >
        {age}
      </span>
    </Link>
  )
}

const checksPresentation = {
  pending: { label: 'Checks running', color: 'text-status-working' },
  success: { label: 'Checks passing', color: 'text-tick-complete' },
  failure: { label: 'Checks failing', color: 'text-pr-closed' },
}

function ChecksMark({ checks }: { checks?: PullRequestListItem['checks'] }) {
  if (!checks) return <span aria-hidden='true' className='size-3.5 shrink-0' />
  const { label, color } = checksPresentation[checks]
  return (
    <span className={cn('flex shrink-0 items-center', color)} title={label}>
      {checks === 'pending' ? (
        <InProgressIcon aria-hidden='true' className='size-3.5' />
      ) : checks === 'success' ? (
        <CheckCircleIcon weight='fill' aria-hidden='true' className='size-3.5' />
      ) : (
        <XCircleIcon weight='fill' aria-hidden='true' className='size-3.5' />
      )}
      <span className='sr-only'>{label}</span>
    </span>
  )
}
