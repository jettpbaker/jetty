import type { PullRequestData } from '@jetty/shared/pull-request'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { pressProps } from '@/lib/press'
import { formatAgo, formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  useLinkPullRequest,
  usePullRequest,
  useRefreshPullRequest,
  useUnlinkPullRequest,
  type PullRequestRef,
} from '@/state'
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  InfoIcon,
  LinkBreakIcon,
  MinusCircleIcon,
  UserPlusIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import {
  DiffIcon,
  GitMergeIcon,
  IssueOpenedIcon,
  PeopleIcon,
  WorkflowIcon,
} from '@primer/octicons-react'
import { Link } from '@tanstack/react-router'
import { lazy, Suspense, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { DisabledTooltip } from './disabled_tooltip'
import { InProgressIcon } from './in_progress_icon'
import { Markdown } from './markdown'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { PersonAvatar } from './person_avatar'
import {
  prActivity,
  pullRequestState,
  type ClosingIssueReference,
  type GitHubCheckRun,
  type GitHubCommit,
  type GitHubFile,
  type GitHubPullRequest,
  type GitHubReview,
  type GitHubUser,
  type MergeMethod,
  type PrActivityItem,
  type ReviewThread,
} from './pull_request_model'
import { prPresentation } from './thread_pull_request'
import './thread_details_layout.css'

const PullRequestDiff = lazy(async () => {
  const [{ FileChangesViewer }, { parseFileChanges }, { preloadHighlighter }] = await Promise.all([
    import('./file_changes_viewer'),
    import('./file_diff_model'),
    import('@pierre/diffs'),
  ])
  await preloadHighlighter({
    themes: ['pierre-dark-soft', 'pierre-light-soft'],
    langs: ['typescript', 'tsx'],
  })
  function PullRequestDiff({ files }: { files: readonly GitHubFile[] }) {
    const changes = useMemo(() => parseFileChanges(filesPatch(files)), [files])
    const notShown = files.filter((file) => file.patch === undefined && file.status !== 'renamed')
    return (
      <FileChangesViewer
        embedded
        layout='page'
        files={changes}
        footer={notShown.length > 0 && <NotShown paths={notShown.map((file) => file.filename)} />}
      />
    )
  }
  return { default: PullRequestDiff }
})

// GitHub returns one hunk-only patch per file; the viewer reads a git patch.
function filesPatch(files: readonly GitHubFile[]) {
  let patch = ''
  for (const file of files) {
    if (file.patch === undefined && file.status !== 'renamed') continue
    const before = file.previous_filename ?? file.filename
    const header = [`diff --git a/${before} b/${file.filename}`]
    if (file.status === 'added') header.push('new file mode 100644')
    if (file.status === 'removed') header.push('deleted file mode 100644')
    if (file.status === 'renamed')
      header.push(`rename from ${before}`, `rename to ${file.filename}`)
    if (file.patch !== undefined)
      header.push(
        `--- ${file.status === 'added' ? '/dev/null' : `a/${before}`}`,
        `+++ ${file.status === 'removed' ? '/dev/null' : `b/${file.filename}`}`,
        file.patch
      )
    patch += `${header.join('\n')}\n`
  }
  return patch
}

function NotShown({ paths }: { paths: readonly string[] }) {
  return (
    <p
      className='shrink-0 truncate border-t border-border px-3 py-2 text-xs text-muted-foreground'
      title={paths.join('\n')}
    >
      Not shown: {paths.join(', ')}
    </p>
  )
}

type PrPane = 'info' | 'diff'

function TimeAgo({ at }: { at: string }) {
  const now = useNow(60_000)
  return formatAgo(Date.parse(at), now)
}

function checkDuration(run: GitHubCheckRun) {
  if (run.status === 'queued') return 'Queued'
  if (run.status === 'in_progress' || !run.completed_at) return 'Running'
  const seconds = (Date.parse(run.completed_at) - Date.parse(run.started_at)) / 1000
  return Number.isNaN(seconds) ? '' : formatDuration(Math.max(0, seconds))
}

function failed(run: GitHubCheckRun) {
  return (
    run.conclusion === 'failure' ||
    run.conclusion === 'timed_out' ||
    run.conclusion === 'action_required'
  )
}

function checksSummary(runs: readonly GitHubCheckRun[]) {
  let failing = 0
  let passing = 0
  for (const run of runs) {
    if (failed(run)) failing += 1
    if (run.status === 'completed' && run.conclusion === 'success') passing += 1
  }
  if (failing > 0) return `${failing} failing`
  if (passing === runs.length) return `all ${runs.length} passing`
  return `${passing} of ${runs.length} passing`
}

type ReviewerState = GitHubReview['state'] | 'AWAITING'

function reviewerEntries(
  pull: GitHubPullRequest,
  reviews: readonly GitHubReview[]
): { user: GitHubUser; state: ReviewerState }[] {
  const latest = new Map<string, GitHubReview>()
  for (const review of reviews) {
    const current = latest.get(review.user.login)
    if (!current || Date.parse(review.submitted_at) >= Date.parse(current.submitted_at))
      latest.set(review.user.login, review)
  }
  const entries: { user: GitHubUser; state: ReviewerState }[] = []
  const seen = new Set<string>()
  for (const review of reviews) {
    if (seen.has(review.user.login) || review.user.login === pull.user.login) continue
    seen.add(review.user.login)
    const latestReview = latest.get(review.user.login)
    if (latestReview) entries.push({ user: latestReview.user, state: latestReview.state })
  }
  for (const user of pull.requested_reviewers) {
    if (seen.has(user.login)) continue
    seen.add(user.login)
    entries.push({ user, state: 'AWAITING' })
  }
  return entries
}

const conclusionLabel: Record<NonNullable<GitHubCheckRun['conclusion']>, string> = {
  success: 'Passed',
  failure: 'Failed',
  neutral: 'Neutral',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  timed_out: 'Timed out',
  action_required: 'Action required',
  stale: 'Stale',
  startup_failure: 'Startup failure',
}

function checkResult(run: GitHubCheckRun) {
  if (run.status === 'in_progress') return 'Running'
  if (run.status === 'queued' || !run.conclusion) return 'Queued'
  return conclusionLabel[run.conclusion]
}

function CheckStatusIcon({ run }: { run: GitHubCheckRun }) {
  if (run.status === 'in_progress')
    return <InProgressIcon className='shrink-0 text-status-working' />
  if (run.status === 'queued')
    return <CircleIcon className='size-4 shrink-0 text-muted-foreground' />
  if (run.conclusion === 'success')
    return <CheckCircleIcon weight='fill' className='size-4 shrink-0 text-tick-complete' />
  if (failed(run)) return <XCircleIcon weight='fill' className='size-4 shrink-0 text-pr-closed' />
  if (run.conclusion === 'cancelled' || run.conclusion === 'skipped')
    return <MinusCircleIcon className='size-4 shrink-0 text-pr-closed' />
  return <MinusCircleIcon className='size-4 shrink-0 text-muted-foreground' />
}

const reviewCopy: Partial<Record<GitHubReview['state'], { label: string; color: string }>> = {
  APPROVED: { label: 'approved', color: 'text-status-success' },
  CHANGES_REQUESTED: { label: 'requested changes', color: 'text-status-attention' },
  COMMENTED: { label: 'commented', color: 'text-muted-foreground' },
  DISMISSED: { label: 'dismissed', color: 'text-muted-foreground' },
}

function externalLink(href: string) {
  return ({ children, ...props }: ComponentProps<'a'>) => (
    <a {...props} href={href} target='_blank' rel='noreferrer'>
      {children}
    </a>
  )
}

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden='true' className='flex size-4 shrink-0 items-center justify-center'>
      {children}
    </span>
  )
}

function CommitRow({ commit, inset = false }: { commit: GitHubCommit; inset?: boolean }) {
  return (
    <li className='flex h-8 items-center gap-2 text-sm'>
      {inset ? <span className='w-4 shrink-0' aria-hidden /> : null}
      <RowIcon>
        <GitCommitIcon className='size-4 text-muted-foreground' />
      </RowIcon>
      <span className='min-w-0 flex-1 truncate'>{commit.commit.message.split('\n')[0]}</span>
      <span className='shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground'>
        {commit.sha.slice(0, 7)}
      </span>
    </li>
  )
}

function CommitGroup({ commits }: { commits: GitHubCommit[] }) {
  const first = commits[0]
  if (!first) return null
  if (commits.length === 1)
    return (
      <ol>
        <CommitRow commit={first} />
      </ol>
    )
  const author = first.author?.login ?? first.commit.author.name
  const last = commits.at(-1) ?? first
  return (
    <Collapsible className='flex flex-col'>
      <CollapsibleTrigger
        render={
          <Button
            variant='ghost-text'
            className='group/commits h-8 w-full justify-start gap-2 rounded-sm px-0 font-normal text-foreground'
          />
        }
      >
        <RowIcon>
          <CaretRightIcon className='size-3 text-muted-foreground transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/commits:rotate-90 motion-reduce:transition-none' />
        </RowIcon>
        <span className='min-w-0 flex-1 truncate text-left text-sm'>
          {author} added {commits.length} commits
        </span>
        <span className='shrink-0 text-right text-xs text-muted-foreground'>
          <TimeAgo at={last.commit.author.date} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className='flex flex-col'>
          {commits.map((commit) => (
            <CommitRow key={commit.sha} commit={commit} inset />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ReviewEvent({ review }: { review: GitHubReview }) {
  const copy = reviewCopy[review.state]
  if (!copy) return null
  const body = review.body.trim()
  return (
    <div className='flex gap-2'>
      <PersonAvatar
        login={review.user.login}
        src={review.user.avatar_url}
        className='size-5 shrink-0'
      />
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex min-h-5 items-baseline gap-2 text-xs'>
          <span className='font-medium'>{review.user.login}</span>
          <span className={copy.color}>{copy.label}</span>
          <span className='text-muted-foreground'>
            <TimeAgo at={review.submitted_at} />
          </span>
        </div>
        {body ? <Markdown>{body}</Markdown> : null}
      </div>
    </div>
  )
}

function MergedEvent({ user, at }: { user: GitHubUser; at: string }) {
  return (
    <div className='flex h-8 items-center gap-2 text-sm'>
      <RowIcon>
        <GitMergeIcon className='size-4 text-pr-merged' />
      </RowIcon>
      <span className='min-w-0 flex-1 truncate'>{user.login} merged</span>
      <span className='shrink-0 text-right text-xs text-muted-foreground'>
        <TimeAgo at={at} />
      </span>
    </div>
  )
}

function ActivityItem({ item }: { item: PrActivityItem }) {
  if (item.kind === 'commits') return <CommitGroup commits={item.commits} />
  if (item.kind === 'review') return <ReviewEvent review={item.review} />
  if (item.kind === 'thread') return <ReviewThreadCard thread={item.thread} />
  return <MergedEvent user={item.user} at={item.at} />
}

function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <Collapsible
      defaultOpen={!thread.resolved}
      className='flex flex-col overflow-hidden rounded-lg border border-border'
    >
      <CollapsibleTrigger
        render={
          <Button
            variant='ghost'
            className='group/thread h-8 w-full justify-start gap-2 rounded-b-none px-3 font-normal'
          />
        }
      >
        <CaretRightIcon className='size-3 shrink-0 text-muted-foreground transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/thread:rotate-90 motion-reduce:transition-none' />
        <span className='min-w-0 flex-1 truncate text-left font-mono text-xs'>
          {thread.path}
          {thread.line != null ? `:${thread.line}` : ''}
        </span>
        <span className='font-mono text-xs text-muted-foreground'>{thread.comments.length}</span>
        {thread.resolved && <Badge variant='secondary'>Resolved</Badge>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className='flex flex-col gap-3 border-t border-border p-3'>
          {thread.comments.map((comment) => (
            <li key={comment.id} className='flex gap-2'>
              <PersonAvatar
                login={comment.user.login}
                src={comment.user.avatar_url}
                className='size-5 shrink-0'
              />
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <div className='flex items-baseline gap-2 text-xs'>
                  <span className='font-medium'>{comment.user.login}</span>
                  <span className='text-muted-foreground'>
                    <TimeAgo at={comment.created_at} />
                  </span>
                </div>
                <Markdown>{comment.body}</Markdown>
              </div>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ClosingIssueLink({ issue }: { issue: ClosingIssueReference }) {
  return (
    <a
      href={issue.url}
      target='_blank'
      rel='noreferrer'
      className='min-w-0 truncate hover:underline'
    >
      {issue.title}
    </a>
  )
}

const mergeMethodOptions: { method: MergeMethod; label: string; description: string }[] = [
  {
    method: 'MERGE',
    label: 'Create a merge commit',
    description: 'Adds all commits via a merge commit',
  },
  {
    method: 'SQUASH',
    label: 'Squash & merge',
    description: 'Combines commits into one on the base branch',
  },
  {
    method: 'REBASE',
    label: 'Rebase & merge',
    description: 'Rebases commits onto the base branch',
  },
]

function allowedMergeOptions(data: PullRequestData) {
  const allowedByMethod: Record<MergeMethod, boolean> = {
    MERGE: data.mergeCommitAllowed,
    SQUASH: data.squashMergeAllowed,
    REBASE: data.rebaseMergeAllowed,
  }
  return mergeMethodOptions.filter((option) => allowedByMethod[option.method])
}

function MergeAction({
  data,
  state,
}: {
  data: PullRequestData
  state: ReturnType<typeof pullRequestState>
}) {
  const options = allowedMergeOptions(data)
  const [selected, setSelected] = useState<MergeMethod>(
    () =>
      options.find((option) => option.method === data.viewerDefaultMergeMethod)?.method ??
      options[0]?.method ??
      'SQUASH'
  )
  const current = options.find((option) => option.method === selected) ?? options[0]

  if (state === 'merged' || state === 'closed') {
    return (
      <Button size='sm' variant='outline' className='rounded-sm' disabled>
        {prPresentation[state].label}
      </Button>
    )
  }

  if (!current) {
    return (
      <DisabledTooltip reason='Coming soon' wrap='flex'>
        <Button size='sm' className='h-7 rounded-sm' disabled>
          Merge
        </Button>
      </DisabledTooltip>
    )
  }

  const primary = (
    <Button
      size='sm'
      className={cn('h-7 rounded-sm', options.length > 1 && 'rounded-r-none')}
      disabled
    >
      <GitMergeIcon data-icon='inline-start' />
      {current.label}
    </Button>
  )

  const soon = (
    <DisabledTooltip reason='Coming soon' wrap='flex'>
      {primary}
    </DisabledTooltip>
  )

  if (options.length === 1) return soon

  return (
    <div className='flex'>
      {soon}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size='sm'
              className='h-7 w-7 rounded-sm rounded-l-none border-l border-primary-foreground/20 px-0'
            />
          }
          aria-label='Select merge method'
        >
          <CaretDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-max min-w-56'>
          <DropdownMenuRadioGroup
            value={current.method}
            onValueChange={(value) => {
              if (value === 'MERGE' || value === 'SQUASH' || value === 'REBASE') setSelected(value)
            }}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.method}
                value={option.method}
                className='h-auto! py-2'
              >
                <span className='flex flex-col gap-0.5 pr-2'>
                  <span>
                    {option.label}
                    {option.method === data.viewerDefaultMergeMethod ? ' (repository default)' : ''}
                  </span>
                  <span className='whitespace-nowrap text-muted-foreground'>
                    {option.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

type LinkedThread = { id: string; title: string }

export function PullRequestView({
  data,
  repo,
  actions,
  threads = [],
}: {
  data: PullRequestData
  repo?: string
  actions?: ReactNode
  threads?: readonly LinkedThread[]
}) {
  const { pull, reviews, reviewComments, checkRuns, commits, files, closingIssuesReferences } = data
  const [pane, setPane] = useState<PrPane>('info')
  const [diffSeen, setDiffSeen] = useState(false)
  const state = pullRequestState(pull)
  const presentation = prPresentation[state]
  const Icon = presentation.icon
  const activity = prActivity({ pull, reviews, reviewComments, commits })
  const reviewers = reviewerEntries(pull, reviews)
  const body = pull.body.trim()

  return (
    <Tabs
      value={pane}
      onValueChange={(value) => {
        if (value === 'info' || value === 'diff') setPane(value)
        if (value === 'diff') setDiffSeen(true)
      }}
      render={<section aria-label={pull.title} />}
      className='relative h-full min-h-0 w-full gap-0'
    >
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 px-6 pt-4'>
        <div className='flex min-w-0 items-center gap-2'>
          <PageSidebarTrigger />
          {repo && (
            <p className='flex min-w-0 items-center gap-1.5 text-sm'>
              <span className='truncate font-medium' title={repo}>
                <span className='hidden sm:inline'>{repo.slice(0, repo.indexOf('/') + 1)}</span>
                {repo.slice(repo.indexOf('/') + 1)}
              </span>
              <span className='font-mono text-xs text-muted-foreground tabular-nums'>
                #{pull.number}
              </span>
            </p>
          )}
          <TabsList
            variant='line'
            aria-label='Pull request view'
            className='h-7 shrink-0 gap-1 p-0'
          >
            <TabsTrigger
              value='info'
              className="details-header-tab h-auto rounded-sm px-2 py-1 text-xs [&_svg:not([class*='size-'])]:size-3"
            >
              <InfoIcon data-icon='inline-start' />
              Info
            </TabsTrigger>
            <TabsTrigger
              value='diff'
              className="details-header-tab h-auto rounded-sm px-2 py-1 text-xs [&_svg:not([class*='size-'])]:size-3"
            >
              <DiffIcon data-icon='inline-start' />
              Diff
            </TabsTrigger>
          </TabsList>
        </div>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          <MergeAction key={pull.number} data={data} state={state} />
          <div className='flex items-center'>
            {actions}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    tone='muted'
                    size='icon'
                    className='h-7'
                    nativeButton={false}
                    aria-label='Open on GitHub'
                    render={externalLink(pull.html_url)}
                  />
                }
              >
                <ArrowSquareOutIcon />
              </TooltipTrigger>
              <TooltipContent>Open on GitHub</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      <TabsContent keepMounted value='info' className='min-h-0'>
        <div className='scroll-fade-y scrollbar-subtle [scrollbar-gutter:stable_both-edges] h-full overflow-y-auto overscroll-contain'>
          <h1 className='mx-auto w-full max-w-[708px] shrink-0 px-6 pt-4 text-base font-medium leading-normal'>
            {pull.title}
          </h1>
          <div className='mx-auto flex w-full max-w-[708px] flex-col px-6 pb-6 pt-2'>
            <dl className='grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-1 text-xs'>
              <dt className='flex min-h-7 items-center gap-1.5 text-muted-foreground'>
                <GitBranchIcon className='size-3 shrink-0' />
                Branch
              </dt>
              <dd className='m-0 flex min-h-7 min-w-0 flex-wrap items-center gap-2'>
                <span className='flex min-w-0 items-center gap-1 font-mono'>
                  <span className='truncate'>{pull.base.ref}</span>
                  <CaretLeftIcon className='icon-optical-down size-2.5 shrink-0 text-muted-foreground' />
                  <span className='truncate'>{pull.head.ref}</span>
                </span>
                <span className='shrink-0 font-mono tabular-nums'>
                  <span className='text-status-success'>+{pull.additions}</span>{' '}
                  <span className='text-status-error'>−{pull.deletions}</span>
                </span>
              </dd>
              <dt className='flex min-h-7 items-center gap-1.5 text-muted-foreground'>
                <GitPullRequestIcon className='size-3 shrink-0' />
                Status
              </dt>
              <dd className='m-0 flex min-h-7 items-center gap-1.5'>
                {state === 'merged' ? (
                  <>
                    <Icon className={cn('size-3', presentation.color)} />
                    {presentation.label}
                  </>
                ) : (
                  <DisabledTooltip reason='Coming soon'>
                    <span className='flex items-center gap-1.5'>
                      <Icon className={cn('size-3', presentation.color)} />
                      {presentation.label}
                    </span>
                  </DisabledTooltip>
                )}
              </dd>
              {closingIssuesReferences.length > 0 && (
                <>
                  <dt className='flex min-h-7 items-center gap-1.5 text-muted-foreground'>
                    <IssueOpenedIcon className='size-3 shrink-0' />
                    {closingIssuesReferences.length === 1 ? 'Issue' : 'Issues'}
                  </dt>
                  <dd className='m-0 flex min-h-7 min-w-0 flex-wrap items-center gap-x-4 gap-y-1'>
                    {closingIssuesReferences.map((issue) => (
                      <ClosingIssueLink key={issue.url} issue={issue} />
                    ))}
                  </dd>
                </>
              )}
              {threads.length > 0 && (
                <>
                  <dt className='flex min-h-7 items-center gap-1.5 text-muted-foreground'>
                    <WorkflowIcon className='size-3 shrink-0' />
                    {threads.length === 1 ? 'Thread' : 'Threads'}
                  </dt>
                  <dd className='m-0 flex min-h-7 min-w-0 flex-wrap items-center gap-x-4 gap-y-1'>
                    {threads.map((thread) => (
                      <Link
                        key={thread.id}
                        to='/threads/$threadId'
                        params={{ threadId: thread.id }}
                        className='min-w-0 truncate hover:underline'
                      >
                        {thread.title}
                      </Link>
                    ))}
                  </dd>
                </>
              )}
              <dt className='flex min-h-7 items-center gap-1.5 text-muted-foreground'>
                <PeopleIcon className='size-3 shrink-0' />
                Reviewers
              </dt>
              <dd className='m-0 flex min-h-7 min-w-0 flex-wrap items-center gap-1.5'>
                {reviewers.map((entry) => (
                  <Badge
                    key={entry.user.login}
                    variant='outline'
                    className='h-6 gap-1.5 pl-1 pr-2 font-normal [&>svg]:size-3.5!'
                  >
                    <PersonAvatar
                      login={entry.user.login}
                      src={entry.user.avatar_url}
                      className='size-4'
                    />
                    <span className='relative -top-px'>{entry.user.login}</span>
                    {entry.state === 'APPROVED' && (
                      <CheckIcon weight='bold' className='text-status-success' />
                    )}
                  </Badge>
                ))}
                <DisabledTooltip reason='Coming soon' wrap='flex'>
                  <Button
                    variant='ghost'
                    tone='muted'
                    size='icon'
                    className='h-7'
                    aria-label='Request review'
                    disabled
                  >
                    <UserPlusIcon />
                  </Button>
                </DisabledTooltip>
              </dd>
            </dl>

            <section className='flex flex-col gap-3 pt-6'>
              <h2 className='flex items-center justify-between text-xs font-medium text-muted-foreground'>
                Description
              </h2>
              {body ? (
                <Markdown>{body}</Markdown>
              ) : (
                <p className='text-sm text-muted-foreground'>No description.</p>
              )}
            </section>

            <section className='flex flex-col gap-3 pt-6'>
              <h2 className='flex items-center justify-between text-xs font-medium text-muted-foreground'>
                Activity
              </h2>
              {activity.length > 0 ? (
                <ol className='flex flex-col gap-3'>
                  {activity.map((item) => (
                    <li key={item.id}>
                      <ActivityItem item={item} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className='text-sm text-muted-foreground'>No activity yet.</p>
              )}
            </section>

            <section className='flex flex-col gap-3 pt-6'>
              <h2 className='flex items-center justify-between text-xs font-medium text-muted-foreground'>
                Checks
                {checkRuns.length > 0 && (
                  <span className='font-mono font-normal text-muted-foreground'>
                    {checksSummary(checkRuns)}
                  </span>
                )}
              </h2>
              {checkRuns.length > 0 ? (
                <ul className='flex flex-col'>
                  {checkRuns.map((run) => (
                    <li key={run.id} className='flex h-8 items-center gap-2 text-sm'>
                      <RowIcon>
                        <CheckStatusIcon run={run} />
                      </RowIcon>
                      <span className='min-w-0 flex-1 truncate'>
                        {run.name}
                        <span className='sr-only'>, {checkResult(run)}</span>
                      </span>
                      <span className='w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground'>
                        {checkDuration(run)}
                      </span>
                      <Button
                        variant='ghost-text'
                        size='sm'
                        className='px-0'
                        nativeButton={false}
                        aria-label={`${run.name} details`}
                        render={externalLink(run.html_url)}
                      >
                        Details
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-sm text-muted-foreground'>No checks.</p>
              )}
            </section>
          </div>
        </div>
      </TabsContent>
      <TabsContent keepMounted value='diff' className='min-h-0 overflow-hidden pt-4'>
        {diffSeen && (
          <Suspense
            fallback={<p className='p-4 text-xs text-muted-foreground'>Loading changes…</p>}
          >
            <PullRequestDiff files={files} />
          </Suspense>
        )}
      </TabsContent>
    </Tabs>
  )
}

const unavailableTitle = {
  unavailable: 'GitHub unavailable',
  not_found: 'Pull request not found',
  rate_limited: 'GitHub rate limit reached',
}

type PullRequestAddress = PullRequestRef & { url: string }

function RefreshButton({ link, error }: { link: PullRequestRef; error?: string }) {
  const refresh = useRefreshPullRequest()
  const { refreshing } = usePullRequest(link)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            tone='muted'
            size='icon'
            className={cn('h-7', error && !refreshing && 'text-destructive')}
            aria-label='Refresh'
            {...pressProps(() => refresh(link))}
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
        {error && !refreshing ? `Couldn't refresh: ${error}` : 'Refresh'}
      </TooltipContent>
    </Tooltip>
  )
}

function UnlinkButton({ threadId, link }: { threadId: string; link: PullRequestAddress }) {
  const unlink = useUnlinkPullRequest()
  const relink = useLinkPullRequest()
  function unlinkWithUndo() {
    unlink(threadId, link)
    toast('Pull request unlinked', {
      action: {
        label: 'Undo',
        onClick: () =>
          void relink(threadId, link.url).then((error) => {
            if (error) toast.error(error)
          }),
      },
    })
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            tone='muted'
            size='icon'
            className='h-7'
            aria-label='Unlink from thread'
            onClick={unlinkWithUndo}
          />
        }
      >
        <LinkBreakIcon />
      </TooltipTrigger>
      <TooltipContent>Unlink from thread</TooltipContent>
    </Tooltip>
  )
}

// The thread's details tab and the full page both show a PR through this.
export function LivePullRequestView({
  link,
  threadId,
  threads,
  standalone = false,
}: {
  link: PullRequestAddress
  threadId?: string
  threads?: readonly LinkedThread[]
  standalone?: boolean
}) {
  const { snapshot, refreshing } = usePullRequest(link)
  const refresh = useRefreshPullRequest()
  const failure = snapshot && snapshot.status !== 'ready' && snapshot.status !== 'loading'
  if (snapshot?.data)
    return (
      <PullRequestView
        data={snapshot.data}
        repo={standalone ? link.repo : undefined}
        threads={threads}
        actions={
          <>
            <RefreshButton link={link} error={failure ? snapshot.error : undefined} />
            {threadId && <UnlinkButton threadId={threadId} link={link} />}
          </>
        }
      />
    )
  if (!failure) return <p className='p-4 text-xs text-muted-foreground'>Loading pull request…</p>
  return (
    <PullRequestUnavailable
      title={unavailableTitle[snapshot.status]}
      detail={
        snapshot.status === 'unavailable' && snapshot.error
          ? snapshot.error
          : `${link.repo}#${link.number}`
      }
    >
      <Button variant='outline' size='sm' disabled={refreshing} onClick={() => refresh(link)}>
        Try again
      </Button>
      <Button variant='ghost' size='sm' nativeButton={false} render={externalLink(link.url)}>
        Open on GitHub
      </Button>
      {threadId && <UnlinkButton threadId={threadId} link={link} />}
    </PullRequestUnavailable>
  )
}

export function PullRequestUnavailable({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
      <div className='flex flex-col gap-1'>
        <p className='text-sm'>{title}</p>
        <p className='text-xs text-muted-foreground'>{detail}</p>
      </div>
      <div className='flex items-center gap-1'>{children}</div>
    </div>
  )
}
