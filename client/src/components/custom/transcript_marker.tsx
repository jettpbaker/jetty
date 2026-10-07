import {
  Tick02Icon,
  Comment01Icon,
  Cancel01Icon,
  HistoryIcon,
  PauseIcon,
  Refresh01Icon,
} from '@/components/custom/huge_icons'
import { GitPullRequestIcon } from '@/components/custom/lucide_icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  useContinueThread,
  useContinuing,
  useOpenPullRequestTab,
  usePullRequestSummary,
} from '@/state'
import { RESTART_LIMIT, RESTART_WINDOW_MS, type PullRequestActivity } from '@jetty/shared/items'
import { Link, useNavigate } from '@tanstack/react-router'
import { use } from 'react'

import type { PullRequestItem } from './thread_rows'

import { ChatSeam, ChatSeamAction, SeamIcon } from './chat_seam'
import { Code } from './composer_strip'
import { approvalView, type ApprovalItem, type QuestionItem } from './composer_strip_model'
import { inlineLinkClass, LeadTitle, OpenPullLink, plainClick, shorten } from './entity_link'
import { SourceLabel } from './source_label'
import { prPresentation } from './thread_pull_request'

type Tone = 'allow' | 'deny' | 'answer' | 'dismiss'

const markerIcons: Record<Tone, typeof Tick02Icon> = {
  allow: Tick02Icon,
  deny: Cancel01Icon,
  answer: Comment01Icon,
  dismiss: Cancel01Icon,
}

function approvalMarker(item: ApprovalItem, projectPath: string | undefined) {
  const { target, always } = approvalView(item, projectPath)
  if (item.decision === 'always')
    return {
      tone: 'allow' as const,
      text: (
        <>
          <span className='shrink-0'>Always allowed</span>
          <Code>{always?.patterns.join(', ') ?? target}</Code>
        </>
      ),
    }
  if (item.decision === 'allow')
    return {
      tone: 'allow' as const,
      text: (
        <>
          <span className='shrink-0'>Allowed</span>
          <Code>{target}</Code>
        </>
      ),
    }
  return {
    tone: 'deny' as const,
    text: (
      <>
        <span className='shrink-0'>Denied</span>
        <Code className='max-w-60 shrink-0'>{target}</Code>
        {item.deniedReason && <span className='truncate'>— “{item.deniedReason}”</span>}
      </>
    ),
  }
}

function questionMarker(item: QuestionItem) {
  const { answers } = item
  if (!answers)
    return {
      tone: 'dismiss' as const,
      text: (
        <span className='truncate'>
          {item.dismissed ? 'Dismissed' : 'Skipped'} “{item.questions[0]?.question}”
        </span>
      ),
    }
  return {
    tone: 'answer' as const,
    text: (
      <span className='truncate'>
        Answered{' '}
        {item.questions.map((question, index) => (
          <span key={question.question}>
            {index > 0 && ' · '}
            {question.header || question.question}:{' '}
            <span className='text-foreground'>{answers[question.question]}</span>
          </span>
        ))}
      </span>
    ),
  }
}

export function TranscriptMarker({
  item,
  source,
  provider,
  projectPath,
}: {
  item: ApprovalItem | QuestionItem
  source?: string
  provider?: string
  projectPath?: string
}) {
  const { tone, text } =
    item.kind === 'approval' ? approvalMarker(item, projectPath) : questionMarker(item)
  const Icon = markerIcons[tone]
  return (
    <div
      data-marker={tone}
      className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'
    >
      <Icon className='size-3 shrink-0' />
      {source && (
        <>
          <SourceLabel provider={provider} className='shrink-0'>
            <span className='max-w-52 truncate'>{source}</span>
          </SourceLabel>
          <span aria-hidden='true'>·</span>
        </>
      )}
      <span className='flex min-w-0 items-center gap-1.5'>{text}</span>
    </div>
  )
}

export function CompactionSeam({ running }: { running: boolean }) {
  return (
    <ChatSeam>
      <SeamIcon icon={HistoryIcon} />
      {running ? <span className='shimmer'>Compacting</span> : 'Compacted'}
    </ChatSeam>
  )
}

export function RestartSeam({ label = 'Jetty restarted' }: { label?: string }) {
  return (
    <ChatSeam>
      <SeamIcon icon={Refresh01Icon} />
      <span className='truncate'>{label}</span>
    </ChatSeam>
  )
}

export function RestartLimitSeam({ threadId, resumed }: { threadId: string; resumed: boolean }) {
  const continuing = useContinuing(threadId)
  const continueThread = useContinueThread()
  const done = resumed || continuing
  return (
    <ChatSeam>
      <SeamIcon icon={done ? Tick02Icon : PauseIcon} />
      <span className='truncate'>
        {done ? 'Resumed' : 'Paused'} after {RESTART_LIMIT} restarts in {RESTART_WINDOW_MS / 60_000}{' '}
        minutes
      </span>
      {done ? null : (
        <ChatSeamAction onClick={() => continueThread(threadId)}>Resume</ChatSeamAction>
      )}
    </ChatSeam>
  )
}

function describeActivity({ type, actor, count, detail }: PullRequestActivity) {
  switch (type) {
    case 'checks_failed':
      return detail ? `checks failed: ${detail}` : 'checks failed'
    case 'checks_passed':
      return 'checks passing'
    case 'changes_requested':
      return actor ? `changes requested by ${actor}` : 'changes requested'
    case 'approved':
      return actor ? `approved by ${actor}` : 'approved'
    case 'commented':
      if (count && count > 1) return actor ? `${count} comments from ${actor}` : `${count} comments`
      return actor ? `comment from ${actor}` : 'new comment'
    case 'conflict':
      return detail ? `merge conflict with ${detail}` : 'merge conflict'
    case 'ready':
      return 'ready to merge'
    case 'merged':
      return actor ? `merged by ${actor}` : 'merged'
    case 'closed':
      return 'closed'
  }
}

// One line shows the worst news only. The hover keeps the full list, names and checks included.
const activityRank: Record<PullRequestActivity['type'], number> = {
  merged: 0,
  closed: 1,
  checks_failed: 2,
  conflict: 3,
  changes_requested: 4,
  commented: 5,
  ready: 6,
  approved: 7,
  checks_passed: 8,
}

function worstActivity(activity: readonly PullRequestActivity[]) {
  let worst: PullRequestActivity | undefined
  for (const entry of activity) {
    if (!worst || activityRank[entry.type] < activityRank[worst.type]) worst = entry
  }
  return worst
}

function headline(entry: PullRequestActivity, activity: readonly PullRequestActivity[]) {
  switch (entry.type) {
    case 'checks_failed':
      return 'checks failed'
    case 'checks_passed':
      return 'checks passing'
    case 'changes_requested':
      return 'changes requested'
    case 'approved':
      return 'approved'
    case 'commented': {
      let count = 0
      for (const each of activity) if (each.type === 'commented') count += each.count ?? 1
      return count > 1 ? 'new comments' : 'new comment'
    }
    case 'conflict':
      return 'merge conflict'
    case 'ready':
      return 'ready to merge'
    case 'merged':
      return 'merged'
    case 'closed':
      return 'closed'
  }
}

// The glyph takes the PR's state once it's settled, else the colour of its worst news.
function pullRequestSeamLook(activity: readonly PullRequestActivity[]) {
  const types = new Set(activity.map((entry) => entry.type))
  if (types.has('merged'))
    return { icon: prPresentation.merged.icon, tone: prPresentation.merged.color }
  if (types.has('closed'))
    return { icon: prPresentation.closed.icon, tone: prPresentation.closed.color }
  if (types.has('checks_failed') || types.has('changes_requested') || types.has('conflict'))
    return { icon: GitPullRequestIcon, tone: 'text-status-error' }
  if (types.has('ready') || types.has('approved') || types.has('checks_passed'))
    return { icon: GitPullRequestIcon, tone: 'text-pr-open' }
  return { icon: GitPullRequestIcon }
}

function news(entry: PullRequestActivity, activity: readonly PullRequestActivity[]) {
  const { actor } = entry
  switch (entry.type) {
    case 'merged':
      return actor ? `${actor} merged` : 'Merged'
    case 'closed':
      return 'Closed'
    case 'checks_failed':
      return 'Checks failed on'
    case 'checks_passed':
      return 'Checks passing on'
    case 'changes_requested':
      return actor ? `${actor} requested changes on` : 'Changes requested on'
    case 'approved':
      return actor ? `${actor} approved` : 'Approved'
    case 'commented': {
      let count = 0
      for (const each of activity) if (each.type === 'commented') count += each.count ?? 1
      return count > 1 ? `${count} comments on` : actor ? `${actor} commented on` : 'New comment on'
    }
    case 'conflict':
      return 'Merge conflict on'
    case 'ready':
      return ''
  }
}

function PullRequestTitle({ item, menu = false }: { item: PullRequestItem; menu?: boolean }) {
  const summary = usePullRequestSummary({ repo: item.repo, number: item.number })
  const { icon: Icon, tone } = pullRequestSeamLook(item.activity)
  const title = summary ? shorten(summary.pull.title) : `#${item.number}`
  return menu ? (
    <span className='flex min-w-0 items-center gap-[3px] text-foreground'>
      <Icon aria-hidden='true' className={cn('size-3.5 shrink-0', tone)} />
      <span className='truncate'>{title}</span>
    </span>
  ) : (
    <LeadTitle
      icon={Icon}
      color={tone ?? 'text-muted-foreground'}
      label='Pull request'
      size='size-3'
      gap='mr-[3px]'
      text={title}
    />
  )
}

function PullRequestLink({ item }: { item: PullRequestItem }) {
  const [owner = '', repo = ''] = item.repo.split('/')
  const paneThreadId = use(OpenPullLink)
  const openInPane = useOpenPullRequestTab()
  return (
    <Link
      to='/pull-requests/$owner/$repo/$number'
      params={{ owner, repo, number: String(item.number) }}
      title={`${item.repo}#${item.number}`}
      className={cn(inlineLinkClass, 'min-w-0 truncate')}
      onClick={(event) => {
        if (!paneThreadId || !plainClick(event)) return
        event.preventDefault()
        openInPane(paneThreadId, { repo: item.repo, number: item.number })
      }}
    >
      <PullRequestTitle item={item} />
    </Link>
  )
}

// What Jetty's PR watcher saw on one of the thread's PRs. The agent gets the details, if it woke.
export function PullRequestSeam({ item }: { item: PullRequestItem }) {
  const lead = worstActivity(item.activity)
  const summary = item.activity.map(describeActivity).join(' · ')
  const count = item.activity.length
  const line = (
    <span className='flex min-w-0 items-center gap-[5px] whitespace-nowrap'>
      {lead && (
        <>
          {count > 1 ? (
            <>
              <span className='truncate'>
                {headline(lead, item.activity).replace(/^./, (letter) => letter.toUpperCase())}
              </span>
              <span className='text-foreground'>and {count - 1} more</span>
              <span>on</span>
            </>
          ) : (
            lead.type !== 'ready' && <span className='truncate'>{news(lead, item.activity)}</span>
          )}
        </>
      )}
      <PullRequestLink item={item} />
      {lead?.type === 'ready' && count === 1 && <span>is ready to merge</span>}
      {item.held && <span>· not woken, too many wakes this hour</span>}
    </span>
  )
  return (
    <div className='flex min-w-0 justify-center py-0.5 text-xs leading-4 text-muted-foreground'>
      {summary ? (
        <Tooltip>
          <TooltipTrigger render={<span className='min-w-0' />}>{line}</TooltipTrigger>
          <TooltipContent className='max-w-sm'>
            <span className='text-left'>{summary}</span>
          </TooltipContent>
        </Tooltip>
      ) : (
        line
      )}
    </div>
  )
}

export function PullRequestGroupSeam({ items }: { items: PullRequestItem[] }) {
  const navigate = useNavigate()
  const paneThreadId = use(OpenPullLink)
  const openInPane = useOpenPullRequestTab()
  const looks = new Map<string, { look: ReturnType<typeof pullRequestSeamLook>; count: number }>()
  let total = 0
  for (const item of items) {
    total += item.activity.length
    const look = pullRequestSeamLook(item.activity)
    const key = `${look.tone}:${look.icon.displayName ?? look.icon.name}`
    looks.set(key, { look, count: (looks.get(key)?.count ?? 0) + 1 })
  }
  function open(item: PullRequestItem) {
    if (paneThreadId) openInPane(paneThreadId, { repo: item.repo, number: item.number })
    else {
      const [owner = '', repo = ''] = item.repo.split('/')
      void navigate({
        to: '/pull-requests/$owner/$repo/$number',
        params: { owner, repo, number: String(item.number) },
      })
    }
  }
  return (
    <div className='flex min-w-0 justify-center py-0.5 text-xs leading-4 text-muted-foreground'>
      <DropdownMenu>
        <DropdownMenuTrigger className='flex min-w-0 items-center gap-[5px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50'>
          <span className='text-foreground'>{total}</span> updates on{' '}
          <span className='text-foreground'>{items.length} PRs</span>
          {Array.from(looks.values(), ({ look, count }) => (
            <span
              key={`${look.tone}:${look.icon.displayName ?? look.icon.name}`}
              className='inline-flex items-center gap-[3px] font-mono text-muted-foreground'
            >
              <look.icon aria-hidden='true' className={cn('size-3', look.tone)} />
              {count}
            </span>
          ))}
          {items.some((item) => item.held) && <span>· not woken, too many wakes this hour</span>}
        </DropdownMenuTrigger>
        <DropdownMenuContent align='center' className='w-90 max-w-[calc(100vw-24px)]'>
          <DropdownMenuGroup>
            {items.map((item) => {
              const lead = worstActivity(item.activity)
              return (
                <DropdownMenuItem
                  key={`${item.repo}#${item.number}`}
                  onClick={() => open(item)}
                  className='justify-between gap-4'
                >
                  <PullRequestTitle item={item} menu />
                  <span className='shrink-0 text-muted-foreground'>
                    {lead && headline(lead, item.activity)}
                    {item.activity.length > 1 && ` +${item.activity.length - 1}`}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
