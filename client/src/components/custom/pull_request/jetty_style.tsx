import { charmedSprite } from '@/components/custom/charmed_icons'
import {
  ErrorStatusIcon,
  SkippedStatusIcon,
  SuccessStatusIcon,
} from '@/components/custom/circle_status_icon'
import { ArrowTurnBackwardIcon, BubbleChatIcon, PlusSignIcon } from '@/components/custom/huge_icons'
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Copy01Icon,
  File01Icon,
  MoreVerticalIcon,
  Tick02Icon,
} from '@/components/custom/huge_icons'
import { InProgressIcon } from '@/components/custom/in_progress_icon'

import '../option_picker.css'
import { Loading } from '@/components/custom/loading'
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
} from '@/components/custom/lucide_icons'
import { markdownText } from '@/components/custom/markdown'
import { PersonAvatar } from '@/components/custom/person_avatar'
import { ReviewerPicker } from '@/components/custom/reviewer_picker'
import { prPresentation } from '@/components/custom/thread_pull_request'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { contentKey } from '@/lib/hash'
import { whenIdle } from '@/lib/preload'
import { pressProps } from '@/lib/press'
import { isBoolean, useStoredState } from '@/lib/stored-state'
import { cn } from '@/lib/utils'
import { perf } from '@/perf'
import {
  usePullRequestCommitFiles,
  usePullRequestDiffFileLoader,
  useSetReviewRequest,
} from '@/state/pull_requests'
import { Link } from '@tanstack/react-router'
import {
  cloneElement,
  memo,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import type {
  PrCheck,
  PrComment,
  PrCommit,
  PrStatusEvent,
  PrFile,
  PrMergeMethod,
  PrPull,
  PrReview,
  PrThread,
  PrUser,
} from './adapter'

import { syntaxTheme } from '../diff/cursor_themes'
import { DiffFileCard, DiffViewed } from '../diff/file_card'
import { DiffFileList } from '../diff/file_list'
import { byTreeOrder } from '../diff/model'
import { DiffToolbar, DiffToolbarButton, useDiffStyle, useDiffWrap } from '../diff/toolbar'
import { primeDiffHighlights, DiffWorkerPoolProvider } from '../diff_worker_pool'
import { parseFileChanges } from '../file_diff_model'
import { githubUser, prFile } from './adapter'
import { DescriptionEditor, DeferredMarkdownEditor } from './description_editor'
import {
  checkCounts,
  countLabel,
  duration,
  excerpt,
  filePatch,
  failed,
  DiffStyleContext,
  DiffWrapContext,
  mergeReason,
  personName,
  running,
  QuoteContext,
  repoName,
  repoPath,
} from './model'
import {
  usePrRuntime,
  PrDiffLoaderContext,
  PrDiffRevisionContext,
  PrPaintedContext,
} from './runtime'
import '@/components/custom/charmed_icons.css'

import { Ago, Body, Comment, Diff, Section } from './shared'

function Hint({
  text = 'Coming soon',
  children,
  className = 'inline-flex min-w-0',
}: {
  text?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}
function Action({
  children,
  label,
  className,
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  return (
    <Button
      disabled
      variant='ghost-text'
      size='sm'
      className={cn('h-7 px-0 font-normal', className)}
      aria-label={label}
    >
      {children}
    </Button>
  )
}
function Composer({
  author,
  reply = false,
  thread,
  quote,
  deferUntilFocus = false,
}: {
  deferUntilFocus?: boolean
  author?: PrUser
  reply?: boolean
  thread?: PrThread
  quote?: { markdown: string; id: number }
}) {
  const { actions } = usePrRuntime()
  return (
    <div className={cn('flex w-full items-start gap-2 py-2', reply ? 'px-3' : 'px-2.5')}>
      <PersonAvatar
        login={author?.login ?? 'ghost'}
        src={author?.avatarUrl || undefined}
        className='mt-1 size-5'
      />
      <div className='min-w-0 flex-1'>
        <DeferredMarkdownEditor
          deferUntilFocus={deferUntilFocus}
          initial=''
          label={reply ? 'Reply' : 'Comment'}
          placeholder={reply ? 'Leave a reply…' : 'Leave a comment…'}
          disabled={!author || (reply && (thread?.comments[0]?.id ?? 0) <= 0)}
          onSubmit={(body) => actions.comment(body, thread?.comments[0]?.id)}
          onUpload={actions.upload}
          quote={quote}
        />
      </div>
    </div>
  )
}
type Reviewer = { user: PrUser; state: string; team?: { codeOwner: boolean } }

// A reviewer's verdict as a glyph on their avatar's corner, after Linear, so there's no colour to
// learn: a check, ± (GitHub's file-diff mark), a clock or a speech bubble. Drawn on a 12-unit grid.
const verdictBadges: Record<string, { tone: string; glyph: ReactNode }> = {
  APPROVED: { tone: 'text-status-success', glyph: <path d='m3.6 6.2 1.6 1.6 3.2-3.4' /> },
  CHANGES_REQUESTED: { tone: 'text-status-error', glyph: <path d='M6 3v3M4.5 4.5h3M4.5 8.5h3' /> },
  COMMENTED: {
    tone: 'text-muted-foreground',
    glyph: (
      <path d='M3.4 4.6c0-.7.6-1.3 1.3-1.3h2.6c.7 0 1.3.6 1.3 1.3v1.6c0 .7-.6 1.3-1.3 1.3H5.4L3.9 8.8V7.3a1.3 1.3 0 0 1-.5-1.1Z' />
    ),
  },
  REQUESTED: {
    tone: 'text-status-attention',
    glyph: (
      <>
        <circle cx='6' cy='6' r='3' />
        <path d='M6 4.7V6l.9.7' />
      </>
    ),
  },
}
function VerdictBadge({ state }: { state: string }) {
  if (state === 'DISMISSED') return null
  const { tone, glyph } = verdictBadges[state] ?? verdictBadges.COMMENTED!
  return (
    <span aria-hidden className={cn('absolute -right-1 -bottom-0.5 z-10 size-3', tone)}>
      <svg
        viewBox='0 0 12 12'
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
        className='size-full'
      >
        {/* A page-coloured halo that also fills the bubble and clock, so the avatar never shows through. */}
        <g stroke='var(--background)' strokeWidth='4' fill='var(--background)'>
          {glyph}
        </g>
        <g stroke='currentColor' strokeWidth='1.4'>
          {glyph}
        </g>
      </svg>
    </span>
  )
}

// A review card's tag: the verdict in GitHub's timeline words, with the Reviewers row's glyph cropped
// to icon size. A review that only commented reads "Reviewed", as on GitHub.
const reviewWords: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Reviewed',
}
function VerdictGlyph({ state, className }: { state: string; className: string }) {
  const { tone, glyph } = verdictBadges[state] ?? verdictBadges.COMMENTED!
  return (
    <svg
      aria-hidden
      viewBox='2 2 8 8'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.333'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={cn('shrink-0 [&_*]:[vector-effect:non-scaling-stroke]', className, tone)}
    >
      {glyph}
    </svg>
  )
}
function ReviewTag({ state }: { state: string }) {
  return (
    <span className='inline-flex items-center gap-1 rounded-sm bg-accent px-2 py-0.5 text-muted-foreground'>
      <VerdictGlyph state={state} className='size-3' />
      {reviewWords[state] ?? 'Reviewed'}
    </span>
  )
}

// Popover-coloured surfaces: borders on and inside them (dividers, tables) take the raised border,
// drawn as hairlines.
const raised = 'bg-popover [--border:var(--border-raised)]'

// GitHub has no in-place replies to a review or a conversation comment; Quote reply puts it in the
// conversation's comment box instead. It shows while its card is hovered or it has focus, sized and
// muted like the page's other icon buttons; it pulls out by its own padding so its glyph, not its
// hover box, sits on the card's content edge, and overhangs the header row without growing it.
function QuoteReply({ body }: { body: string }) {
  const quote = useContext(QuoteContext)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            tone='muted'
            aria-label='Quote reply'
            className='-my-1 -mr-1.5 opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100'
            onClick={() => quote(body)}
          />
        }
      >
        <ArrowTurnBackwardIcon />
      </TooltipTrigger>
      <TooltipContent>Quote reply</TooltipContent>
    </Tooltip>
  )
}
function ResolveThread({
  onResolve,
  resolved,
  disabled,
}: {
  onResolve: () => void
  resolved: boolean
  disabled: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            tone='muted'
            disabled={disabled}
            aria-label={resolved ? 'Unresolve conversation' : 'Resolve conversation'}
            className='-my-1 -mr-1.5 opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100'
            onClick={onResolve}
          />
        }
      >
        <Tick02Icon />
      </TooltipTrigger>
      <TooltipContent>
        {resolved ? 'Unresolve conversation' : 'Resolve conversation'}
      </TooltipContent>
    </Tooltip>
  )
}
const quoted = (body: string) =>
  body
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

// Capy names a reviewer's state in its picker, capitalised: Commented, Approved…
const capyWords: Record<string, string> = {
  DISMISSED: '',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Commented',
  REQUESTED: 'Requested',
}

// Capy's take: each reviewer as an avatar and name. The row opens the picker, which lists them first.
function ReviewerList({ people, children }: { people: Reviewer[]; children: ReactNode }) {
  const overflow = people.length > 3
  const shown = overflow ? people.slice(0, 3) : people
  const remaining = people.slice(3)
  return (
    <div className={cn('px-1', overflow && 'flex min-w-0 items-center gap-2 [&>span]:min-w-0')}>
      {isValidElement<{ trigger?: ReactElement; current?: unknown }>(children) &&
        cloneElement(children, {
          current: people.map(({ user, state, team }) => ({
            user: githubUser(user),
            label: personName(user),
            word: capyWords[state] ?? 'Requested',
            team: !!team,
          })),
          trigger: (
            <Button
              variant='ghost'
              size='sm'
              className={cn(
                '-mx-1 h-7 gap-3 px-0.75 font-normal',
                overflow && 'w-max min-w-0 shrink'
              )}
            >
              {shown.map(({ user, state, team }) => (
                <span
                  key={user.login}
                  className={cn('inline-flex items-center gap-2', overflow && 'min-w-0')}
                >
                  <span className='relative shrink-0'>
                    <PersonAvatar
                      login={personName(user)}
                      src={user.avatarUrl || undefined}
                      className={cn('size-4', team && 'rounded-menu-item [&>*]:rounded-menu-item')}
                    />
                    <VerdictBadge state={state} />
                  </span>
                  {overflow ? (
                    <span className='truncate'>{personName(user)}</span>
                  ) : (
                    personName(user)
                  )}
                </span>
              ))}
            </Button>
          ),
        })}
      {overflow && (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant='secondary'
                size='xs'
                className='rounded-full font-normal'
                aria-label={`${remaining.length} more reviewers`}
              />
            }
          >
            +{remaining.length}
          </PopoverTrigger>
          <PopoverContent align='start' className='w-64 max-w-[calc(100vw-24px)] gap-0 p-1'>
            <PopoverTitle className='sr-only'>More reviewers</PopoverTitle>
            <ul className='scrollbar-subtle max-h-64 overflow-y-auto'>
              {remaining.map(({ user, state, team }) => (
                <li key={user.login} className='flex h-7 min-w-0 items-center gap-2 px-2 text-xs'>
                  <span className='relative shrink-0'>
                    <PersonAvatar
                      login={personName(user)}
                      src={user.avatarUrl || undefined}
                      className={cn('size-4', team && 'rounded-menu-item [&>*]:rounded-menu-item')}
                    />
                    <VerdictBadge state={state} />
                  </span>
                  <span className='truncate'>{personName(user)}</span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// The trigger for the checks popover: one phrase for the state that matters. Any failure outranks
// checks still running, and skipped checks count as passed, as on GitHub. The popover lists every check.
function ChecksSummary({ pr }: { pr: PrPull }) {
  const c = checkCounts(pr)
  if (!pr.checks.length) return <span className='text-muted-foreground'>No checks</span>
  const summary = c.failed
    ? {
        tone: 'text-status-error',
        glyph: <ErrorStatusIcon className='size-3.5' />,
        text: `${c.failed} failing`,
      }
    : c.running
      ? {
          tone: 'text-status-working',
          // The ring draws inside a 16px box, so it needs 15px to match the 14px discs; the class also
          // keeps the trigger button from shrinking an unsized icon to 12px.
          glyph: <InProgressIcon className='size-3.75' />,
          text: `${c.running} running`,
        }
      : {
          tone: 'text-status-success',
          glyph: <SuccessStatusIcon className='size-3.5' />,
          text: 'All checks passed',
        }
  return (
    <span className='flex items-center gap-2 text-foreground tabular-nums'>
      <span className={cn('flex size-4 shrink-0 items-center justify-center', summary.tone)}>
        {summary.glyph}
      </span>
      {summary.text}
    </span>
  )
}

// One check's glyph and colour.
function checkTone(check: PrCheck) {
  return running(check)
    ? { tone: 'text-status-working', glyph: <InProgressIcon /> }
    : failed(check)
      ? { tone: 'text-status-error', glyph: <ErrorStatusIcon /> }
      : check.conclusion === 'success'
        ? { tone: 'text-status-success', glyph: <SuccessStatusIcon /> }
        : { tone: 'text-muted-foreground', glyph: <SkippedStatusIcon /> }
}

// The checks list, in the app's search-picker style (as the reviewer and branch pickers).
function ChecksPill({ pr }: { pr: PrPull }) {
  const [showSkipped, setShowSkipped] = useState(false)
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const visible = pr.checks.filter((check) =>
    `${check.workflow ?? check.app} ${check.name} ${check.event ?? ''} ${check.description ?? ''}`
      .toLowerCase()
      .includes(search)
  )
  const rank = (check: PrCheck) => (failed(check) ? 0 : running(check) ? 1 : 2)
  const ran = visible
    .filter((check) => check.conclusion !== 'skipped')
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const skipped = visible.filter((check) => check.conclusion === 'skipped')
  function row(check: PrCheck) {
    const multi =
      new Set(
        pr.checks
          .filter((c) => c.kind === 'run' && c.workflow === check.workflow)
          .map((c) => c.event)
      ).size > 1
    const { tone, glyph } = checkTone(check)
    return (
      <CommandItem
        key={check.id}
        value={`check:${check.id}`}
        onSelect={() => window.open(check.url, '_blank', 'noopener')}
      >
        <span className={cn('shrink-0', tone)}>{glyph}</span>
        <span className='min-w-0 truncate'>
          {check.kind === 'run' && (
            <span className='text-muted-foreground'>{check.workflow ?? check.app} / </span>
          )}
          {check.name}
          {multi && check.event && <span className='text-muted-foreground'> ({check.event})</span>}
          {check.kind === 'status' && check.description && (
            <span className='text-muted-foreground'> · {check.description}</span>
          )}
        </span>
        {/* Passing required checks say nothing: only one that's failing or still running holds the merge. */}
        {check.required && (failed(check) || running(check)) && (
          <span className='shrink-0 text-muted-foreground'>Required</span>
        )}
        <span
          data-slot='command-shortcut'
          className='ml-auto shrink-0 font-mono text-muted-foreground'
        >
          {duration(check)}
        </span>
      </CommandItem>
    )
  }
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return
        setQuery('')
        setShowSkipped(false)
      }}
    >
      <PopoverTrigger
        render={<Button variant='ghost' size='sm' className='rounded-sm px-0.75 font-normal' />}
      >
        <ChecksSummary pr={pr} />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        side='bottom'
        className='search-picker w-[440px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none'
      >
        <PopoverTitle className='sr-only'>Checks</PopoverTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder='Search checks'
            aria-label='Search checks'
            value={query}
            onValueChange={setQuery}
          />
          <Separator />
          <CommandList>
            <div className='picker-results'>
              {(
                [
                  ['Failing', ran.filter(failed)],
                  ['Running', ran.filter((check) => running(check) && !failed(check))],
                  ['Successful', ran.filter((check) => !running(check) && !failed(check))],
                ] as const
              ).map(
                ([heading, checks]) =>
                  !!checks.length && (
                    <CommandGroup
                      key={heading}
                      heading={
                        <span className='flex'>
                          {heading}
                          <span className='ml-auto font-mono font-normal tabular-nums'>
                            {checks.length}
                          </span>
                        </span>
                      }
                    >
                      {checks.map(row)}
                    </CommandGroup>
                  )
              )}
              {/* Skipped checks fold away, as on GitHub; a search shows them. */}
              {!!skipped.length && (
                <CommandGroup>
                  {showSkipped || search ? (
                    skipped.map(row)
                  ) : (
                    <CommandItem
                      value='show-skipped'
                      onSelect={() => setShowSkipped(true)}
                      className='text-muted-foreground'
                    >
                      <SkippedStatusIcon />
                      {countLabel(skipped.length, 'skipped check')}
                      <span
                        data-slot='command-shortcut'
                        className='ml-auto flex shrink-0 text-muted-foreground'
                      >
                        <ArrowDown01Icon className='size-3.5' />
                      </span>
                    </CommandItem>
                  )}
                </CommandGroup>
              )}
              {!visible.length && (
                <p className='px-3 py-2 text-xs text-muted-foreground'>No matches</p>
              )}
            </div>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
const StatusChange = createContext<(state: PrPull['state']) => void>(() => {})
const statusOptions = ['open', 'draft', 'closed'] as const

function StatusMenu({ pr }: { pr: PrPull }) {
  const change = useContext(StatusChange)
  if (pr.state === 'merged')
    return (
      <div className='flex h-7 items-center px-1'>
        <PropertyStatus pr={pr} />
      </div>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-7 rounded-sm px-0.75 font-normal'
            disabled={!pr.data.viewerCanUpdate}
            aria-label={`Status: ${prPresentation[pr.state].label}`}
          />
        }
      >
        <PropertyStatus pr={pr} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-44'>
        <DropdownMenuRadioGroup
          value={pr.state}
          onValueChange={(value) => change(value as PrPull['state'])}
        >
          {statusOptions.map((state) => {
            const option = prPresentation[state]
            return (
              <DropdownMenuRadioItem key={state} value={state}>
                <option.icon className={option.color} />
                {option.label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// GitHub's state pill, leading the byline. It only shows the state; the Status row changes it. When
// a merge lands, its colour crossfades from green to purple.
// The status pill on its own line above the title, beside the repo and number.
function StatusPill({ pr }: { pr: PrPull }) {
  const { icon: Icon, label } = prPresentation[pr.state]
  return (
    <span
      style={{ '--pill': `var(--pr-${pr.state})` } as CSSProperties}
      className='inline-flex h-7 items-center gap-1.5 rounded-full bg-[color-mix(in_oklch,var(--pill)_16%,transparent)] px-2.5 text-sm font-medium text-[color-mix(in_oklch,var(--pill)_70%,white)] transition-[background-color,color] duration-300'
    >
      <Icon className='size-3.5' />
      {label}
    </span>
  )
}

// GitHub's issue states: open is green, closed as completed is purple, closed as not planned is grey.
const issueStates = {
  open: { icon: CircleDotIcon, color: 'text-pr-open', label: 'Open' },
  completed: { icon: CircleCheckIcon, color: 'text-pr-merged', label: 'Closed as completed' },
  not_planned: {
    icon: CircleSlashIcon,
    color: 'text-muted-foreground',
    label: 'Closed as not planned',
  },
}
function IssueStateIcon({ state }: { state: keyof typeof issueStates }) {
  const { icon: Icon, color, label } = issueStates[state]
  return <Icon aria-label={label} className={cn('size-4 shrink-0', color)} />
}

type PrIssue = NonNullable<PrPull['issues']>[number]
// An issue in this repo is #123; another repo's names its repo.
function issueLabel(pr: PrPull, issue: PrIssue) {
  return `${repoPath(issue) === repoPath(pr) ? '' : repoName(issue)}#${issue.number}`
}

// The PR's first issue, then the rest behind "+N more". Titles only; the number is in the tooltip.
function Issues({ pr }: { pr: PrPull }) {
  const issues = pr.issues ?? []
  const first = issues[0]
  if (!first)
    return (
      <div className='px-0.75'>
        <Action className='gap-2'>
          <PlusSignIcon className='size-4' />
          Link issue
        </Action>
      </div>
    )
  return (
    <div className='flex min-w-0 items-center gap-1'>
      <Hint text={issueLabel(pr, first)} className='flex min-w-0'>
        <Button
          variant='ghost'
          size='sm'
          nativeButton={false}
          render={<a aria-label={first.title} href={first.url} target='_blank' rel='noreferrer' />}
          className='h-7 min-w-0 shrink gap-2 rounded-sm px-0.75 text-xs font-normal'
        >
          <IssueStateIcon state={first.state} />
          <span className='truncate'>{first.title}</span>
        </Button>
      </Hint>
      {issues.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='sm'
                className='h-7 shrink-0 rounded-sm px-1.5 text-xs font-normal text-muted-foreground'
              />
            }
          >
            +{issues.length - 1} more
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='w-80 max-w-[calc(100vw-24px)]'>
            {issues.map((issue) => (
              <DropdownMenuItem
                key={issue.url}
                render={
                  <a aria-label={issue.title} href={issue.url} target='_blank' rel='noreferrer' />
                }
              >
                <IssueStateIcon state={issue.state} />
                <span className='truncate'>{issue.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// Rows run in this order: where it stands, what gates the merge, then context. The branch is in the
// byline above.
const propertyRows = ['Status', 'Checks', 'Reviewers', 'Issues']
function Properties({ pr }: { pr: PrPull }) {
  const { ref, threads } = usePrRuntime()
  const setReviewRequest = useSetReviewRequest()
  const picker = (
    <ReviewerPicker
      repo={ref.repo}
      author={pr.author.login}
      requested={pr.data.pull.requested_reviewers}
      suggested={pr.data.suggestedReviewers}
      disabledReason={
        pr.data.viewerCanRequestReviews
          ? undefined
          : "You can't request reviewers for this pull request"
      }
      onToggle={(user, request) => setReviewRequest(ref, user, request)}
    />
  )
  const values: Record<string, ReactNode> = {
    Status: <StatusMenu pr={pr} />,
    Reviewers: pr.reviewers.length ? (
      <ReviewerList people={pr.reviewers}>{picker}</ReviewerList>
    ) : (
      <div className='px-0.75'>
        {cloneElement(picker, {
          trigger: (
            <Button variant='ghost-text' size='sm' className='h-7 gap-2 px-0 font-normal'>
              <PlusSignIcon className='size-4' />
              Add reviewers
            </Button>
          ),
        })}
      </div>
    ),
    Thread: (
      <div className='flex flex-wrap items-center gap-x-2'>
        {threads.map((thread) => (
          <Button
            key={thread.id}
            variant='ghost'
            size='sm'
            className='h-7 max-w-full gap-2 rounded-sm px-0.75 font-normal'
            nativeButton={false}
            render={<Link to='/threads/$threadId' params={{ threadId: thread.id }} />}
          >
            <BubbleChatIcon className='size-4' />
            <span className='truncate'>{thread.title}</span>
          </Button>
        ))}
      </div>
    ),
    Checks: <ChecksPill pr={pr} />,
    Issues: <Issues pr={pr} />,
  }
  return (
    <div className='space-y-1'>
      {[...propertyRows, ...(threads.length ? ['Thread'] : [])].map((label) => (
        <div key={label} className='grid min-h-7 grid-cols-[92px_minmax(0,1fr)] items-start gap-2'>
          {/* Top-aligned for values that run several lines; the padding centres it on the first. */}
          <div className='py-1.5 text-xs text-muted-foreground'>{label}</div>
          <div className='min-w-0 text-sm'>{values[label]}</div>
        </div>
      ))}
    </div>
  )
}

// GitHub emits empty reviews for each inline reply. Fold a consecutive run into
// its author's review, keeping their IDs so each thread lands on its review's card.
function reviewGroups(pr: PrPull) {
  const result: { review: PrReview; ids: number[]; end: string; threads: PrThread[] }[] = []
  for (const review of [...pr.reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    const last = result.at(-1)
    const interrupted =
      last &&
      pr.conversation.some((c) => c.createdAt > last.end && c.createdAt <= review.submittedAt)
    if (!review.body.trim() && last?.review.author.login === review.author.login && !interrupted) {
      last.end = review.submittedAt
      last.ids.push(review.id)
    } else result.push({ review, ids: [review.id], end: review.submittedAt, threads: [] })
  }
  for (const thread of pr.threads)
    result.find((group) => group.ids.includes(thread.reviewId))?.threads.push(thread)
  return result
}
// Like GitHub: adjacent commits fold into one "added N commits" run; any other event ends it.
function commitRuns<T extends { commit?: PrCommit }>(events: T[]) {
  const runs: (T | { commits: PrCommit[] })[] = []
  for (const event of events) {
    const last = runs.at(-1)
    if (!event.commit) runs.push(event)
    else if (last && 'commits' in last) last.commits.push(event.commit)
    else runs.push({ commits: [event.commit] })
  }
  return runs
}

// One-line activity event; when it carries commits, the count expands to list them.
function CommitsLine({
  icon,
  text,
  commits,
  at,
}: {
  icon: ReactNode
  text: string
  commits: PrCommit[]
  at: string
}) {
  return (
    <Collapsible className='text-xs text-muted-foreground'>
      <p className='flex items-center gap-2'>
        {icon}
        <span>
          {text}
          {!!commits.length && (
            <>
              {' '}
              <CollapsibleTrigger
                render={
                  <Button
                    variant='ghost-text'
                    size='sm'
                    className='h-auto px-0 align-baseline text-xs font-normal'
                  />
                }
              >
                {countLabel(commits.length, 'commit')}
              </CollapsibleTrigger>
            </>
          )}{' '}
          <Ago at={at} />
        </span>
      </p>
      {!!commits.length && (
        <CollapsibleContent fast>
          <ul className='space-y-1 pt-1 pl-5.5'>
            {commits.map((commit) => (
              <li key={commit.sha} className='flex min-w-0 items-center gap-2'>
                <GitCommitHorizontalIcon className='size-3.5 shrink-0' />
                <span className='shrink-0 font-mono'>{commit.sha.slice(0, 7)}</span>
                <span className='truncate text-foreground'>{commit.message.split('\n')[0]}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function CommitRun({ commits }: { commits: PrCommit[] }) {
  const authors = new Set(commits.map((commit) => commit.author))
  const latest = commits.at(-1)!
  return (
    <CommitsLine
      icon={<GitCommitHorizontalIcon className='size-3.5 shrink-0' />}
      text={authors.size === 1 ? `${latest.author} added` : 'Added'}
      commits={commits}
      at={latest.date}
    />
  )
}

const statusEventCopy: Record<PrStatusEvent['kind'], { state: PrPull['state']; text: string }> = {
  ready_for_review: { state: 'open', text: 'Marked ready for review' },
  converted_to_draft: { state: 'draft', text: 'Converted to draft' },
  closed: { state: 'closed', text: 'Closed' },
  reopened: { state: 'open', text: 'Reopened' },
}

// Property rows share one 16px glyph slot, an 8px gap (the reviewers row needs it for the verdict
// badge on the avatar's corner) and a 4px inset; a Button's 1px border counts towards that inset.
function PropertyStatus({ pr }: { pr: PrPull }) {
  const { icon: Icon, color, label } = prPresentation[pr.state]
  return (
    <span className='inline-flex items-center gap-2 text-xs'>
      <Icon className={cn('size-4 shrink-0', color)} />
      {label}
    </span>
  )
}

function StateGlyph({ state }: { state: PrPull['state'] }) {
  const { icon: Icon, color } = prPresentation[state]
  return <Icon className={`size-3.5 shrink-0 ${color}`} />
}

function Activity({ pr }: { pr: PrPull }) {
  const [quote, setQuote] = useState<{ markdown: string; id: number }>()
  const quoteReply = (body: string) => <QuoteReply body={body} />
  const events: { key: string; at: string; content?: ReactNode; commit?: PrCommit }[] = [
    // Commits from before the PR existed belong to the Opened line, not a later run.
    ...pr.commits
      .filter((commit) => commit.date > pr.createdAt)
      .map((commit) => ({ key: commit.sha, at: commit.date, commit })),
    ...pr.statusEvents.map((event) => ({
      key: `${event.kind}-${event.at}`,
      at: event.at,
      content: (
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <StateGlyph state={statusEventCopy[event.kind].state} />
          <span>
            {statusEventCopy[event.kind].text} by {personName(event.actor)} <Ago at={event.at} />
          </span>
        </div>
      ),
    })),
    ...pr.conversation.map((comment: PrComment) => ({
      key: `comment-${comment.id}`,
      at: comment.createdAt,
      content: (
        <div className={cn('group/comment rounded-md border-[0.5px] border-border px-3', raised)}>
          <Comment comment={comment} menu={quoteReply(comment.body)} />
        </div>
      ),
    })),
    ...reviewGroups(pr).map(({ review, threads }) => ({
      key: `review-${review.id}`,
      at: review.submittedAt,
      // A verdict with nothing written is a timeline event, as on GitHub; only words make a card.
      content:
        !review.body.trim() && !threads.length ? (
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            {review.state === 'APPROVED' ? (
              <SuccessStatusIcon className='size-3.5 shrink-0 text-status-success' />
            ) : (
              <VerdictGlyph state={review.state} className='size-3.5' />
            )}
            <span>
              {reviewWords[review.state] ?? 'Reviewed'} by {personName(review.author)}{' '}
              <Ago at={review.submittedAt} />
            </span>
          </div>
        ) : (
          <div
            className={cn(
              'group/comment overflow-hidden rounded-md border-[0.5px] border-border',
              raised
            )}
          >
            <div className='space-y-3 p-3'>
              <div className='flex items-center gap-2 text-xs'>
                <PersonAvatar
                  login={review.author.login}
                  src={review.author.avatarUrl || undefined}
                  className='size-5'
                />
                <span>{personName(review.author)}</span>
                <Ago at={review.submittedAt} raised />
                <ReviewTag state={review.state} />
                {review.body.trim() && <span className='ml-auto'>{quoteReply(review.body)}</span>}
              </div>
              {review.body.trim() && <Body body={review.body} />}
            </div>
            {!!threads.length && <ActivityThreads threads={threads} author={pr.viewer} />}
          </div>
        ),
    })),
    ...(pr.mergedAt
      ? [
          {
            key: 'merged',
            at: pr.mergedAt,
            content: (
              <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                <GitMergeIcon className='size-3.5 text-pr-merged' />
                <span>
                  Merged by {personName(pr.mergedBy ?? pr.author)} <Ago at={pr.mergedAt} />
                </span>
              </div>
            ),
          },
        ]
      : []),
  ]
  const initial = pr.commits.filter((commit) => commit.date <= pr.createdAt)
  return (
    <QuoteContext
      value={(body) => setQuote((last) => ({ markdown: quoted(body), id: (last?.id ?? 0) + 1 }))}
    >
      <div className='flex flex-1 flex-col space-y-4'>
        <CommitsLine
          icon={<StateGlyph state={pr.openedAsDraft ? 'draft' : 'open'} />}
          text={`Opened ${pr.openedAsDraft ? 'as draft ' : ''}by ${personName(pr.author)}${initial.length ? ' with' : ''}`}
          commits={initial}
          at={pr.createdAt}
        />
        {commitRuns(events.sort((a, b) => a.at.localeCompare(b.at))).map((e) =>
          'commits' in e ? (
            <CommitRun key={e.commits[0]!.sha} commits={e.commits} />
          ) : (
            <div key={e.key}>{e.content}</div>
          )
        )}
        {/* On a short PR the comment box docks to the bottom of the view, where the chat's composer sits. */}
        <div className={cn('mt-auto rounded-md shadow-xs', raised)}>
          <Composer author={pr.viewer} quote={quote} />
        </div>
      </div>
    </QuoteContext>
  )
}
function ActivityThreads({ threads, author }: { threads: PrThread[]; author?: PrUser }) {
  return (
    <div className='divide-y-[0.5px] divide-border border-t-[0.5px] border-border'>
      {threads.map((thread) => (
        <ActivityThread key={thread.id} thread={thread} author={author} />
      ))}
    </div>
  )
}

function ActivityThread({ thread, author }: { thread: PrThread; author?: PrUser }) {
  const { actions } = usePrRuntime()
  const [expanded, setExpanded] = useState(!thread.resolved)
  const trigger = useRef<HTMLButtonElement>(null)
  const place = thread.line === null ? thread.path : `${thread.path}:${thread.line}`
  const status = [thread.outdated && 'outdated', thread.resolved ? 'resolved' : 'open'].filter(
    Boolean
  )
  const label = `${expanded ? 'Collapse' : 'Expand'} ${place} conversation, ${status.join(', ')}`
  function resolve(resolved: boolean) {
    void actions.resolve(thread.id, resolved)
    setExpanded(!resolved)
    trigger.current?.focus()
  }
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger
        ref={trigger}
        render={<button aria-label={label} />}
        className='flex w-full flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
      >
        <span className='flex w-full items-center gap-2 text-xs'>
          <ArrowDown01Icon
            className={`size-3 shrink-0 text-muted-foreground ${expanded ? '' : '-rotate-90'}`}
          />
          <span
            className={`min-w-0 flex-1 truncate font-mono ${thread.resolved ? 'text-muted-foreground' : ''}`}
          >
            {place}
          </span>
          {thread.outdated && <span className='shrink-0 text-muted-foreground'>Outdated</span>}
          {thread.resolved ? (
            <SuccessStatusIcon
              className='size-3.5 shrink-0 text-status-success'
              aria-label='Resolved'
            />
          ) : (
            <span className='inline-flex shrink-0 items-center gap-1 text-foreground'>Open</span>
          )}
        </span>
        {!expanded && (
          <span className='flex w-full items-center gap-2 pl-5 text-xs text-muted-foreground'>
            <span className='min-w-0 flex-1 truncate'>
              {markdownText(thread.comments[0]?.body ?? '')}
            </span>
            <span
              className='inline-flex shrink-0 items-center gap-1 font-mono'
              aria-label={`${thread.comments.length} comments`}
            >
              <VerdictGlyph state='COMMENTED' className='size-3.5' />
              {thread.comments.length}
            </span>
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='overflow-hidden border-y-[0.5px] border-border bg-background'>
          <Diff
            file={{
              path: thread.path,
              status: 'modified',
              additions: 0,
              deletions: 0,
              binary: false,
              generated: false,
              changes: 0,
              viewed: false,
            }}
            patch={excerpt(thread)}
            snippet
          />
        </div>
        <div className='divide-y-[0.5px] divide-border *:px-3'>
          {thread.comments.map((comment, i) => (
            <Comment
              key={comment.id}
              comment={comment}
              thread={thread}
              reply={i > 0}
              menu={
                i === 0 && !thread.resolved ? (
                  <ResolveThread
                    disabled={thread.id.startsWith('comment:')}
                    resolved={thread.resolved}
                    onResolve={() => resolve(true)}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
        <div className='border-t-[0.5px] border-border'>
          {thread.resolved ? (
            <div className='flex justify-end px-3 py-1'>
              <Button
                variant='ghost-text'
                size='sm'
                className='px-0 font-normal'
                onClick={() => resolve(false)}
              >
                Reopen
              </Button>
            </div>
          ) : (
            author && (
              <Composer key={author.login} author={author} thread={thread} reply deferUntilFocus />
            )
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function InlineThreads({ threads, author }: { threads: PrThread[]; author?: PrUser }) {
  const { actions } = usePrRuntime()
  const isResolved = (thread: PrThread) => thread.resolved
  // Inside the resolved fold a thread drops its own card, so the fold reads as one card.
  function content(thread: PrThread, inFold = false) {
    return (
      <div
        key={thread.id}
        className={
          inFold
            ? undefined
            : cn('group/comment overflow-hidden rounded-md border-[0.5px] border-border', raised)
        }
      >
        <div className='divide-y-[0.5px] divide-border *:px-3'>
          {thread.comments.map((c, i) => (
            <Comment
              key={c.id}
              comment={c}
              thread={thread}
              reply={i > 0}
              menu={
                i === 0 ? (
                  <ResolveThread
                    disabled={thread.id.startsWith('comment:')}
                    resolved={thread.resolved}
                    onResolve={() => void actions.resolve(thread.id, !thread.resolved)}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
        {thread.outdated && (
          <p className='px-3 pb-2 text-xs text-muted-foreground'>Outdated discussion</p>
        )}
        <div className='border-t-[0.5px] border-border'>
          <Composer author={author} thread={thread} reply />
        </div>
      </div>
    )
  }
  const resolved = threads.filter(isResolved)
  const authors = [...new Set(resolved.flatMap((t) => t.comments.map((c) => personName(c.author))))]
  const count = resolved.reduce((n, t) => n + t.comments.length, 0)
  return (
    <div className='space-y-3'>
      {threads.filter((t) => !isResolved(t)).map((t) => content(t))}
      {!!resolved.length && (
        <Collapsible
          className={cn(
            'overflow-hidden rounded-md border-[0.5px] border-border [--motion-disclosure-open-duration:180ms] [--motion-disclosure-close-duration:140ms]',
            raised
          )}
        >
          <CollapsibleTrigger
            render={<Button variant='ghost-text' />}
            className='group/resolved flex h-auto w-full justify-start gap-2 rounded-none border-0 p-3 text-xs font-normal focus-visible:ring-inset'
          >
            <SuccessStatusIcon className='size-3.5 shrink-0 text-status-success' />
            {count} resolved comments from {authors.join(', ')}
            <ArrowDown01Icon className='ml-auto size-3.5 transition-transform duration-140 ease-(--motion-disclosure-ease) group-data-panel-open/resolved:rotate-180 group-data-panel-open/resolved:duration-180 motion-reduce:transition-none' />
          </CollapsibleTrigger>
          <CollapsibleContent className='data-starting-style:opacity-0 motion-reduce:transition-opacity motion-reduce:data-starting-style:h-(--collapsible-panel-height) motion-reduce:data-ending-style:h-(--collapsible-panel-height)'>
            <div className='divide-y-[0.5px] divide-border border-t-[0.5px] border-border'>
              {resolved.map((t) => content(t, true))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
async function primePrDiffs(files: PrFile[], revision: string) {
  const diffs = []
  let lines = 0
  for (const file of [...files].sort(byTreeOrder)) {
    if (lines >= 100) break
    if (file.binary || file.generated || !file.patch) continue
    const text = filePatch(file)
    const diff = parseFileChanges(text, `${revision}:${contentKey(text)}`)[0]?.diff
    if (!diff) continue
    diffs.push(diff)
    lines += diff.unifiedLineCount
  }
  await primeDiffHighlights(diffs, syntaxTheme)
}

// Diff one commit at a time, as on GitHub: the menu picks a commit or all of them, and while one is
// picked the arrows step through the rest.
function CommitPicker({
  commits,
  value,
  onChange,
}: {
  commits: PrCommit[]
  value: PrCommit | undefined
  onChange: (sha: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Search only earns its row on long histories; without it the list takes focus so arrows still work.
  const searchable = commits.length > 10
  const list = useRef<HTMLDivElement>(null)
  const index = value ? commits.indexOf(value) : -1
  const subject = (commit: PrCommit) => commit.message.split('\n')[0] ?? ''
  const results = commits.filter((commit) =>
    `${subject(commit)} ${commit.sha}`.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <div className='flex min-w-0 items-center gap-0.5'>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setQuery('')
        }}
      >
        <PopoverTrigger
          render={<DiffToolbarButton className={cn('min-w-0', value && 'text-foreground')} />}
        >
          {value && value.parents > 1 ? <GitMergeIcon /> : <GitCommitHorizontalIcon />}
          {value ? (
            <>
              <span className='font-mono text-muted-foreground'>{value.sha.slice(0, 7)}</span>
              <span className='max-w-64 truncate @max-[720px]:hidden'>{subject(value)}</span>
            </>
          ) : (
            <>
              Commits <span className='text-muted-foreground tabular-nums'>{commits.length}</span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='search-picker w-80 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0'
          initialFocus={searchable ? undefined : list}
        >
          <PopoverTitle className='sr-only'>Commits</PopoverTitle>
          <Command ref={list} tabIndex={-1} shouldFilter={false} className='outline-none'>
            {searchable && (
              <>
                <CommandInput
                  placeholder='Search commits…'
                  aria-label='Search commits'
                  value={query}
                  onValueChange={setQuery}
                />
                <Separator />
              </>
            )}
            <CommandList>
              <div className='picker-results'>
                <CommandGroup>
                  <CommandItem
                    value='All commits'
                    data-checked={!value}
                    onSelect={() => {
                      setOpen(false)
                      onChange(null)
                    }}
                  >
                    <GitCommitHorizontalIcon />
                    <span className='flex-1'>All commits</span>
                    <span className='text-muted-foreground tabular-nums'>{commits.length}</span>
                  </CommandItem>
                </CommandGroup>
                <Separator />
                <CommandGroup className='commit-picker-graph'>
                  {results.map((commit) => (
                    <CommandItem
                      key={commit.sha}
                      value={commit.sha}
                      keywords={[subject(commit)]}
                      data-checked={value?.sha === commit.sha}
                      onSelect={() => {
                        setOpen(false)
                        onChange(commit.sha)
                      }}
                    >
                      <span className='commit-picker-node relative flex shrink-0 items-center text-muted-foreground group-data-selected/command-item:text-current'>
                        {commit.parents > 1 ? <GitMergeIcon /> : <GitCommitHorizontalIcon />}
                      </span>
                      <span className='min-w-0 flex-1 truncate'>{subject(commit)}</span>
                      <span className='font-mono text-muted-foreground'>
                        {commit.sha.slice(0, 7)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <>
          <Hint text='Previous commit'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Previous commit'
              disabled={index === 0}
              {...pressProps(() => onChange(commits[index - 1]!.sha))}
            >
              <ArrowLeft01Icon />
            </Button>
          </Hint>
          <Hint text='Next commit'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Next commit'
              disabled={index === commits.length - 1}
              {...pressProps(() => onChange(commits[index + 1]!.sha))}
            >
              <ArrowRight01Icon />
            </Button>
          </Hint>
        </>
      )}
    </div>
  )
}
// A removed file only exists at the base; everything else opens at the PR's latest commit.
function FileMenu({ file, pr, at }: { file: PrFile; pr: PrPull; at?: string }) {
  const { ref: address } = usePrRuntime()
  const selected = usePullRequestCommitFiles(address.repo, at ?? null)
  const ref =
    file.status === 'removed'
      ? (selected.data?.parentSha ?? pr.data.pull.base.sha)
      : (at ?? pr.data.pull.head.sha)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='ghost-text' size='sm' className='h-7 px-0 font-normal' />}
        aria-label={`Actions for ${file.path}`}
      >
        <MoreVerticalIcon className='size-3.5' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-max'>
        <DropdownMenuItem
          onClick={() =>
            void navigator.clipboard.writeText(file.path).then(
              () => toast('Path copied', { description: file.path }),
              () => toast.error("Couldn't copy path")
            )
          }
        >
          <Copy01Icon />
          Copy path
        </DropdownMenuItem>

        <DropdownMenuItem disabled>
          <File01Icon />
          View file
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a
              aria-label='Open file in GitHub'
              href={`https://github.com/${repoPath(pr)}/blob/${ref}/${file.path.split('/').map(encodeURIComponent).join('/')}`}
              target='_blank'
              rel='noreferrer'
            />
          }
        >
          <ArrowUpRight01Icon />
          Open in GitHub
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
const noThreads: PrThread[] = []

function FileCard({
  file,
  pr,
  threads,
  deferHeader,
  initiallyNear,
  comments,
  viewed,
  onViewed,
  hideGenerated,
  commit,
}: {
  file: PrFile
  pr: PrPull
  threads: PrThread[]
  deferHeader: boolean
  initiallyNear: boolean
  comments: boolean
  viewed: boolean
  onViewed: (path: string, checked: boolean) => void
  hideGenerated: boolean
  commit?: PrCommit
}) {
  const [height] = useState(() =>
    Math.max(
      80,
      (file.patchDeferred
        ? file.additions + file.deletions + 4
        : (file.patch?.split('\n').length ?? 4)) *
        20 +
        32
    )
  )
  const [showGenerated, setShowGenerated] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const open = !viewed && !collapsed
  const openThreads = threads.filter((t) => !t.resolved).length
  const renderThreads = (threads: PrThread[]) => (
    <InlineThreads threads={threads} author={pr.viewer} />
  )
  return (
    <DiffFileCard
      file={file}
      deferHeader={deferHeader}
      initiallyNear={initiallyNear}
      open={open}
      collapsed={collapsed}
      onToggle={() => setCollapsed((value) => !value)}
      beforeCounts={
        !!openThreads && (
          <span className='inline-flex items-center gap-1 font-mono text-xs text-muted-foreground'>
            <VerdictGlyph state='COMMENTED' className='size-3.5' />
            {openThreads}
          </span>
        )
      }
      actions={
        <>
          {!commit && (
            <DiffViewed
              file={file}
              checked={viewed}
              onCheckedChange={(checked) => void onViewed(file.path, checked)}
            />
          )}
          <FileMenu file={file} pr={pr} at={commit?.sha} />
        </>
      }
      height={
        file.binary
          ? 164
          : file.generated && hideGenerated && !showGenerated
            ? 48
            : comments
              ? Math.max(
                  80,
                  threads.reduce((height, thread) => height + 120 + thread.comments.length * 100, 0)
                )
              : height
      }
    >
      {() => (
        <>
          {file.binary ? (
            <div className='flex flex-col items-center gap-4 py-12'>
              <div className='flex h-10 w-16 items-center justify-center rounded-sm border border-border bg-muted'>
                <File01Icon className='size-5 text-muted-foreground' />
              </div>
              <p className='font-mono text-xs text-muted-foreground'>
                Binary file · preview unavailable
              </p>
            </div>
          ) : file.generated && hideGenerated && !showGenerated ? (
            <div className='flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground'>
              Generated file · {file.additions + file.deletions} lines ·{' '}
              <Button
                variant='ghost-text'
                size='sm'
                className='px-0'
                onClick={() => setShowGenerated(true)}
              >
                Show
              </Button>
            </div>
          ) : comments ? (
            <div>
              {threads.map((thread) => {
                const patch = excerpt(thread)
                return (
                  <div key={thread.id}>
                    <Diff
                      file={file}
                      patch={patch}
                      threads={[thread]}
                      renderThreads={renderThreads}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <Diff file={file} threads={threads} renderThreads={renderThreads} />
          )}
          {file.binary && threads.length > 0 && (
            <div className='border-t border-border px-4 py-3'>{renderThreads(threads)}</div>
          )}
        </>
      )}
    </DiffFileCard>
  )
}

const MemoizedFileCard = memo(FileCard)

// Plain text edited in place, on one line. GitHub requires a title, so an empty one snaps back.
// The title edits in place without changing its heading typography.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
function TitleEditor({
  title,
  onSave,
  disabled,
}: {
  title: string
  onSave: (title: string) => void
  disabled: boolean
}) {
  return (
    <span
      key={title}
      tabIndex={disabled ? -1 : 0}
      role='textbox'
      aria-label='Pull request title'
      contentEditable={disabled ? false : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck={false}
      className='outline-none'
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.currentTarget.textContent = title
          e.currentTarget.blur()
        }
      }}
      onPaste={(e) => {
        e.preventDefault()
        document.execCommand(
          'insertText',
          false,
          e.clipboardData.getData('text/plain').replace(/\s+/g, ' ')
        )
      }}
      onBlur={(e) => {
        const next = e.currentTarget.textContent.replace(/\s+/g, ' ').trim() || title
        e.currentTarget.textContent = next
        if (next !== title) onSave(next)
      }}
    >
      {title}
    </span>
  )
}

/* oxlint-enable jsx-a11y/prefer-tag-over-role */
const mergeMethodOptions: { method: PrMergeMethod; label: string; description: string }[] = [
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
// Merging wears the open-PR green, as on GitHub; dark text, as on Jetty's lilac primary.
const mergeTone = 'bg-pr-open not-disabled:hover:bg-pr-open/80 aria-expanded:bg-pr-open/80'

// GitHub's split merge button: it merges by the picked method, and its caret, there when the repo
// allows more than one, picks another. A blocked merge dims both halves, but the caret still picks.
function MergeButton({
  pr,
  reason,
  onMerge,
}: {
  pr: PrPull
  reason: string
  onMerge: (method: PrMergeMethod) => Promise<boolean>
}) {
  const options = mergeMethodOptions.filter((option) => pr.mergeMethods.includes(option.method))
  const [method, setMethod] = useState(pr.viewerDefaultMergeMethod)
  const [merging, setMerging] = useState(false)
  const current =
    options.find((option) => option.method === method) ?? options[0] ?? mergeMethodOptions[0]!
  const split = options.length > 1
  const edge = split && 'rounded-r-none'
  const primary = reason ? (
    <Hint text={reason}>
      <Button disabled size='sm' className={cn('rounded-sm', edge, mergeTone)}>
        <GitMergeIcon className='size-3.5' />
        {current.label}
      </Button>
    </Hint>
  ) : (
    <Button
      size='sm'
      className={cn('rounded-sm', edge, mergeTone, merging && 'pointer-events-none')}
      aria-busy={merging}
      onClick={() => {
        if (merging) return
        setMerging(true)
        void onMerge(current.method).finally(() => setMerging(false))
      }}
    >
      {/* Busy stays at full colour, and both labels share one grid cell, so the button keeps the
          wider one's width rather than shrinking. */}
      <span className='grid justify-items-center'>
        <span
          className={cn('col-start-1 row-start-1 flex items-center gap-1', merging && 'invisible')}
        >
          <GitMergeIcon className='size-3.5' />
          {current.label}
        </span>
        <span
          className={cn('col-start-1 row-start-1 flex items-center gap-1', !merging && 'invisible')}
        >
          {merging ? <Spinner className='size-3.5' /> : <span className='size-3.5' />}
          Merging
        </span>
      </span>
    </Button>
  )
  if (!split) return primary
  return (
    <div className='flex'>
      {primary}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size='icon-sm'
              className={cn(
                'rounded-sm rounded-l-none border-l-0',
                mergeTone,
                reason && 'opacity-50',
                merging && 'pointer-events-none'
              )}
            />
          }
          aria-label='Select merge method'
        >
          <ArrowDown01Icon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-max min-w-56'>
          <DropdownMenuRadioGroup
            value={current.method}
            onValueChange={(value) => {
              const picked = options.find((option) => option.method === value)
              if (picked) setMethod(picked.method)
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
                    {option.method === pr.viewerDefaultMergeMethod ? ' (last used)' : ''}
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

const MemoizedActivity = memo(Activity)

export function JettyStyle({ pr: original }: { pr: PrPull }) {
  const pr = original
  const { actions, ref, more, sidebar } = usePrRuntime()
  useNow(60_000)
  const setState = (state: PrPull['state']) => {
    if (state !== 'merged') void actions.state(state)
  }
  const [tab, setTab] = useState('overview')
  const painted = useContext(PrPaintedContext)
  const [diffSeen, setDiffSeen] = useState(false)
  if (tab === 'diff' && !diffSeen) setDiffSeen(true)
  const [mode, setMode] = useState('all')
  const [pane, setPane] = useState(true)
  const [filter, setFilter] = useState('')
  const [hideGenerated, setHideGenerated] = useStoredState(
    'jetty.diff.hideGenerated',
    true,
    isBoolean
  )
  const view = useRef<HTMLDivElement>(null)
  const [wrap, setWrapChoice] = useDiffWrap(view)
  const [hideViewed, setHideViewed] = useStoredState('jetty.diff.hideViewed', false, isBoolean)
  const viewed = useMemo(
    () => new Set(pr.files.filter((file) => file.viewed).map((file) => file.path)),
    [pr.files]
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [commitSha, setCommitSha] = useState<string | null>(null)
  // The file at the top of the diff as it scrolls; the tree's selection follows it.
  const [scrolledTo, setInView] = useState<string | null>(null)
  const inViewRef = useRef<string | null>(null)
  const commit = pr.commits.find((c) => c.sha === commitSha)
  if (commitSha && !commit) setCommitSha(null)
  const [diffStyle, setDiffStyle] = useDiffStyle()
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest('input, textarea, [role=dialog]')))
      )
        return
      if (e.key === '1' || e.key === '2') {
        e.preventDefault()
        setTab(e.key === '1' ? 'overview' : 'diff')
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])
  useEffect(() => {
    if (selected)
      view.current
        ?.querySelector<HTMLElement>(`section[id="${CSS.escape(`linear-file-${selected}`)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const commitFiles = usePullRequestCommitFiles(ref.repo, commit?.sha ?? null)
  const loadFile = usePullRequestDiffFileLoader(
    ref.repo,
    commit ? (commitFiles.data?.parentSha ?? undefined) : pr.data.pull.base.sha,
    commit?.sha ?? pr.data.pull.head.sha
  )
  const threadsByPath = useMemo(() => {
    const grouped = new Map<string, PrThread[]>()
    for (const thread of pr.threads) {
      const threads = grouped.get(thread.path)
      if (threads) threads.push(thread)
      else grouped.set(thread.path, [thread])
    }
    return grouped
  }, [pr.threads])
  const commentCounts = useMemo(
    () =>
      Object.fromEntries(
        [...threadsByPath].map(([path, threads]) => [
          path,
          threads.filter((thread) => !thread.resolved).length,
        ])
      ),
    [threadsByPath]
  )
  const changed = useMemo(() => {
    if (commit) return commitFiles.data?.files.map(prFile) ?? []
    if (mode !== 'comments') return pr.files
    const paths = new Set(pr.files.map((file) => file.path))
    return [
      ...pr.files,
      ...[...threadsByPath.keys()]
        .filter((path) => !paths.has(path))
        .map(
          (path): PrFile => ({
            path,
            status: 'modified',
            additions: 0,
            deletions: 0,
            changes: 0,
            binary: false,
            generated: false,
            viewed: false,
          })
        ),
    ]
  }, [commit, commitFiles.data, mode, pr.files, threadsByPath])
  const revision = `${ref.repo}:${commit?.sha ?? pr.data.pull.head.sha}:${commitFiles.data?.parentSha ?? pr.data.pull.base.sha}`
  useEffect(() => {
    if (painted)
      return whenIdle(() => {
        const files = commitSha ? (commitFiles.data?.files.map(prFile) ?? []) : pr.files
        void primePrDiffs(files, revision).catch(() => {})
      })
  }, [painted, pr.files, revision, commitSha, commitFiles.data])
  useLayoutEffect(() => {
    if (tab === 'diff') perf.rendered('pr.diff')
  }, [tab])
  const files = useMemo(
    () =>
      [...changed]
        .sort(byTreeOrder)
        .filter(
          (file) =>
            (commit || mode === 'all' || threadsByPath.has(file.path)) &&
            (!hideViewed || !viewed.has(file.path)) &&
            file.path.toLowerCase().includes(filter.toLowerCase())
        ),
    [changed, commit, mode, threadsByPath, hideViewed, viewed, filter]
  )
  const FileCardComponent = pr.files.length > 100 ? MemoizedFileCard : FileCard
  const inView = files.some((f) => f.path === scrolledTo) ? scrolledTo : (files[0]?.path ?? null)
  inViewRef.current = inView
  const reason = mergeReason(pr)
  const [attachSlot, setAttachSlot] = useState<HTMLDivElement | null>(null)
  const byline = (pr.state === 'merged' && pr.mergedBy) || pr.author
  return (
    <StatusChange value={setState}>
      <DiffStyleContext value={diffStyle}>
        <DiffWrapContext value={wrap}>
          <PrDiffRevisionContext value={revision}>
            <PrDiffLoaderContext value={loadFile}>
              <DiffWorkerPoolProvider themes={syntaxTheme}>
                <div
                  ref={view}
                  data-perf-region='pr-panel'
                  className='@container flex h-full min-h-0 flex-col bg-background text-sm outline-none'
                >
                  <div className='flex shrink-0 items-center justify-between px-4 pt-3 pb-2'>
                    {sidebar}
                    <nav aria-label='Pull request view' className='flex gap-1'>
                      {(['overview', 'diff'] as const).map((value) => (
                        <Hint key={value} text={value === 'overview' ? 'Overview · 1' : 'Diff · 2'}>
                          <Button
                            variant='ghost'
                            tone='muted'
                            size='sm'
                            aria-pressed={tab === value}
                            className='rounded-sm font-normal aria-pressed:bg-accent'
                            {...pressProps(() => {
                              if (value === 'diff') perf.start('pr.diff')
                              setTab(value)
                            })}
                          >
                            {value === 'overview' ? 'Overview' : 'Diff'}
                          </Button>
                        </Hint>
                      ))}
                    </nav>
                    <div className='ml-auto flex items-center gap-1'>
                      {pr.state === 'draft' ? (
                        <Button
                          size='sm'
                          className='rounded-sm'
                          disabled={!pr.data.viewerCanUpdate}
                          onClick={() => setState('open')}
                        >
                          Ready for review
                        </Button>
                      ) : pr.state === 'open' ? (
                        <MergeButton
                          pr={pr}
                          reason={reason}
                          onMerge={(method) => actions.merge(method, pr.data.pull.head.sha)}
                        />
                      ) : null}
                      {more}
                    </div>
                  </div>
                  {
                    // The chat's top edge: a fade over blur layers that ramp in as it scrolls.
                    <div
                      className={cn(
                        'conversation-scroll relative flex min-h-0 flex-1 flex-col',
                        tab !== 'overview' && 'hidden'
                      )}
                    >
                      <div className='scrollbar-subtle scroll-fade-y min-h-0 flex-1 overflow-auto [scroll-timeline:--conversation_y]'>
                        <main className='flex min-h-full min-w-0 flex-col px-7 py-7'>
                          <div className='mx-auto flex w-full max-w-[760px] flex-1 flex-col space-y-9'>
                            <div className='space-y-1'>
                              <div className='flex flex-wrap items-center gap-2.5'>
                                <StatusPill pr={pr} />
                                <Hint text='Opens in GitHub'>
                                  <a
                                    href={pr.url}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='inline-flex items-center gap-1 font-mono text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
                                  >
                                    {repoName(pr)} #{pr.number}
                                    <ArrowUpRight01Icon className='size-3.5' />
                                  </a>
                                </Hint>
                              </div>
                              <h2 className='text-2xl font-medium'>
                                <TitleEditor
                                  title={pr.title}
                                  disabled={!pr.data.viewerCanUpdate}
                                  onSave={(next) => void actions.title(next)}
                                />
                              </h2>
                              <div className='flex flex-wrap items-center gap-1 text-xs'>
                                <PersonAvatar
                                  login={byline.login}
                                  src={byline.avatarUrl || undefined}
                                  className='size-5.5'
                                />
                                {/* GitHub's header sentence; once merged, it names whoever merged. Branches wear the inline-code
                        chip at the size table code uses. */}
                                <span className='min-w-0'>
                                  {personName(byline)}{' '}
                                  <span className='text-muted-foreground'>
                                    {pr.state === 'merged' ? 'merged into' : 'wants to merge into'}
                                  </span>{' '}
                                  <code className='inline-code rounded px-1 py-px font-mono text-xs wrap-anywhere'>
                                    {pr.base}
                                  </code>{' '}
                                  <span className='text-muted-foreground'>from</span>{' '}
                                  <code className='inline-code rounded px-1 py-px font-mono text-xs wrap-anywhere'>
                                    {pr.head}
                                  </code>{' '}
                                  <Ago
                                    at={(pr.state === 'merged' && pr.mergedAt) || pr.createdAt}
                                  />
                                </span>
                              </div>
                            </div>
                            <Properties pr={pr} />
                            <Section
                              title='Description'
                              className='group/description'
                              action={<div ref={setAttachSlot} className='flex' />}
                            >
                              <DescriptionEditor
                                attachSlot={attachSlot}
                                identity={`${ref.repo}#${ref.number}`}
                                onSave={
                                  pr.data.viewerCanUpdate ? (body) => actions.body(body) : undefined
                                }
                                onUpload={pr.data.viewerCanUpdate ? actions.upload : undefined}
                                disabled={!pr.data.viewerCanUpdate}
                                body={pr.body}
                                references={{
                                  repo: repoPath(pr),
                                  issues: [...(pr.issues ?? []), ...(pr.references ?? [])],
                                }}
                              />
                            </Section>
                            <Section title='Activity' className='flex flex-1 flex-col'>
                              <MemoizedActivity pr={pr} />
                            </Section>
                          </div>
                        </main>
                      </div>
                      <div aria-hidden='true' className='conversation-top-blur'>
                        {Array.from({ length: 8 }, (_, layer) => (
                          <div key={layer} />
                        ))}
                      </div>
                    </div>
                  }
                  {diffSeen && (
                    <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'diff' && 'hidden')}>
                      <DiffToolbar
                        files={files}
                        total={changed.length}
                        pane={pane}
                        paneId='linear-file-pane'
                        onPaneChange={setPane}
                        filter={filter}
                        onFilter={setFilter}
                        inView={inView}
                        onSelect={(path) => {
                          setSelected(path)
                          setInView(path)
                          view.current
                            ?.querySelector<HTMLElement>(
                              `section[id="${CSS.escape(`linear-file-${path}`)}"]`
                            )
                            ?.scrollIntoView({ block: 'start' })
                        }}
                        diffStyle={diffStyle}
                        onDiffStyleChange={setDiffStyle}
                        toggles={[
                          ['Hide generated', hideGenerated, setHideGenerated],
                          ['Hide viewed', hideViewed, setHideViewed],
                          ['Wrap lines', wrap, setWrapChoice],
                        ]}
                        filters={
                          <>
                            {['all', 'comments'].map((value) => (
                              <Button
                                key={value}
                                variant='ghost-text'
                                size='sm'
                                aria-pressed={mode === value}
                                disabled={!!commit && value === 'comments'}
                                className='px-2 font-normal'
                                onClick={() => {
                                  setMode(value)
                                  setSelected(null)
                                }}
                              >
                                {value === 'all' ? (
                                  'All'
                                ) : (
                                  <>
                                    Comments
                                    <span className='text-muted-foreground tabular-nums'>
                                      {pr.threads.filter((t) => !t.resolved).length}
                                    </span>
                                  </>
                                )}
                              </Button>
                            ))}
                          </>
                        }
                      >
                        <CommitPicker
                          commits={pr.commits}
                          value={commit}
                          onChange={(sha) => {
                            setCommitSha(sha)
                            setSelected(null)
                            if (sha) setMode('all')
                          }}
                        />
                      </DiffToolbar>
                      <DiffFileList
                        files={files}
                        pane={pane}
                        paneId='linear-file-pane'
                        treeKey={commitSha ?? ''}
                        filter={filter}
                        onFilter={setFilter}
                        selected={selected}
                        inView={inView}
                        onInView={setInView}
                        onSelect={(path) => {
                          if (path === inViewRef.current) return
                          setSelected(path)
                          setInView(path)
                          view.current
                            ?.querySelector<HTMLElement>(
                              `section[id="${CSS.escape(`linear-file-${path}`)}"]`
                            )
                            ?.scrollIntoView({ block: 'start' })
                        }}
                        comments={commit ? undefined : commentCounts}
                      >
                        {files.map((f, index) => (
                          <FileCardComponent
                            key={`${commitSha}-${f.path}`}
                            file={f}
                            deferHeader={files.length > 100}
                            initiallyNear={files.length > 100 && index < 8}
                            pr={pr}
                            threads={commit ? noThreads : (threadsByPath.get(f.path) ?? noThreads)}
                            commit={commit}
                            comments={mode === 'comments'}
                            hideGenerated={hideGenerated}
                            viewed={viewed.has(f.path)}
                            onViewed={actions.viewed}
                          />
                        ))}
                        {commit && !commitFiles.data && (
                          <div className='text-xs text-muted-foreground'>
                            {commitFiles.failed ? (
                              <Button variant='ghost-text' size='sm' onClick={commitFiles.retry}>
                                Couldn't load commit files · Retry
                              </Button>
                            ) : (
                              <Loading label='Loading commit files…' />
                            )}
                          </div>
                        )}
                        {!files.length && (!commit || !!commitFiles.data) && (
                          <p className='p-6 text-xs text-muted-foreground'>
                            No files match this view
                          </p>
                        )}
                      </DiffFileList>
                    </div>
                  )}

                  {(painted || diffSeen) && (
                    <svg
                      aria-hidden='true'
                      className='absolute size-0 overflow-hidden'
                      dangerouslySetInnerHTML={{ __html: charmedSprite }}
                    />
                  )}
                </div>
              </DiffWorkerPoolProvider>
            </PrDiffLoaderContext>
          </PrDiffRevisionContext>
        </DiffWrapContext>
      </DiffStyleContext>
    </StatusChange>
  )
}
