import { ChangedFilesTree } from '@/components/custom/changed_files_tree'
import {
  charmedExtensions,
  charmedFileNames,
  charmedSprite,
} from '@/components/custom/charmed_icons'
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
  SidebarLeftIcon,
  Tick02Icon,
} from '@/components/custom/huge_icons'
import { InProgressIcon } from '@/components/custom/in_progress_icon'
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  Settings2Icon,
} from '@/components/custom/lucide_icons'
import { PersonAvatar } from '@/components/custom/person_avatar'
import { ReviewerPicker } from '@/components/custom/reviewer_picker'
import { prPresentation } from '@/components/custom/thread_pull_request'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { contentKey } from '@/lib/hash'
import { whenIdle } from '@/lib/preload'
import { pressProps } from '@/lib/press'
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

import { primeDiffHighlights, DiffWorkerPoolProvider } from '../diff_worker_pool'
import { parseFileChanges } from '../file_diff_model'
import { githubUser, prFile } from './adapter'
import { syntaxTheme } from './cursor_themes'
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

import './file_card.css'
import { Ago, Body, Comment, Counts, Diff, Section } from './shared'

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
}: {
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
// File icons are Charmed Icons' Soft palette, drawn from the sprite JettyStyle renders once, scaled up
// from their native 16px to 20.
function FileGlyph({ file }: { file: PrFile }) {
  return (
    <span data-charmed='soft' className='inline-flex size-5 shrink-0'>
      <CharmedFileIcon path={file.path} />
    </span>
  )
}
function CharmedFileIcon({ path }: { path: string }) {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  let icon = Object.hasOwn(charmedFileNames, name) ? charmedFileNames[name] : undefined
  if (!icon) {
    const parts = name.split('.')
    for (let i = 1; i < parts.length; i++) {
      const extension = parts.slice(i).join('.')
      if (Object.hasOwn(charmedExtensions, extension)) {
        icon = charmedExtensions[extension]
        break
      }
    }
  }
  return (
    <svg aria-hidden='true' className='size-full'>
      <use href={`#ci-${icon ?? '_file'}`} />
    </svg>
  )
}
const basename = (path: string) => path.split('/').at(-1) ?? path
function Filename({ file, rename = false }: { file: PrFile; rename?: boolean }) {
  const name = basename(file.path)
  const directory = file.path.slice(0, -name.length)
  const old = file.previousPath && basename(file.previousPath)
  let suffix = 0
  if (old)
    while (
      suffix < Math.min(old.length, name.length) &&
      old.at(-suffix - 1) === name.at(-suffix - 1)
    )
      suffix++
  // One line, never two: the folder path wraps onto a clipped second line, so it shows whole or not at all.
  return (
    <span
      className='flex h-[1lh] min-w-0 flex-1 flex-wrap overflow-hidden font-mono text-xs'
      title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
    >
      {rename && old ? (
        <span className='max-w-full truncate'>
          <span className='bg-status-error/10 text-status-error'>
            {old.slice(0, old.length - suffix)}
          </span>
          {old.slice(old.length - suffix)}
          <span className='text-muted-foreground'> → </span>
          <span className='bg-status-success/10 text-status-success'>
            {name.slice(0, name.length - suffix)}
          </span>
          {name.slice(name.length - suffix)}
        </span>
      ) : (
        <span
          className={cn(
            'max-w-full truncate',
            file.status === 'added' && 'text-status-success',
            file.status === 'removed' && 'text-muted-foreground line-through'
          )}
        >
          {name}
        </span>
      )}
      {directory && (
        <span className='ml-2 text-muted-foreground @max-[720px]:hidden'>{directory}</span>
      )}
    </span>
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
  return (
    <div className='px-1'>
      {isValidElement<{ trigger?: ReactElement; current?: unknown }>(children) &&
        cloneElement(children, {
          current: people.map(({ user, state, team }) => ({
            user: githubUser(user),
            label: personName(user),
            word: capyWords[state] ?? 'Requested',
            team: !!team,
          })),
          trigger: (
            <Button variant='ghost' size='sm' className='-mx-1 h-7 gap-3 px-0.75 font-normal'>
              {people.map(({ user, state, team }) => (
                <span key={user.login} className='inline-flex items-center gap-2'>
                  <span className='relative'>
                    <PersonAvatar
                      login={personName(user)}
                      src={user.avatarUrl || undefined}
                      className={cn('size-4', team && 'rounded-menu-item [&>*]:rounded-menu-item')}
                    />
                    <VerdictBadge state={state} />
                  </span>
                  {personName(user)}
                </span>
              ))}
            </Button>
          ),
        })}
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

// One check's glyph and colour; the picker colours a wrapper, since its stylesheet mutes icons.
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
        <span className={cn('picker-glyph shrink-0', tone)}>{glyph}</span>
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
                      <span className='picker-glyph shrink-0'>
                        <SkippedStatusIcon />
                      </span>
                      {countLabel(skipped.length, 'skipped check')}
                      <span data-slot='command-shortcut' className='ml-auto flex shrink-0'>
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
// its author's review, keeping its thread IDs so later reviews aren't double-counted.
function reviewGroups(pr: PrPull) {
  const result: { review: PrReview; end: string; threads: PrThread[] }[] = []
  for (const review of [...pr.reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    const last = result.at(-1)
    const interrupted =
      last &&
      pr.conversation.some((c) => c.createdAt > last.end && c.createdAt <= review.submittedAt)
    if (!review.body.trim() && last?.review.author.login === review.author.login && !interrupted)
      last.end = review.submittedAt
    else result.push({ review, end: review.submittedAt, threads: [] })
  }
  for (const thread of pr.threads) {
    const first = thread.comments[0]
    if (!first) continue
    const candidates = result.filter((g) => g.review.author.login === first.author.login)
    const group =
      candidates.find((g) => first.createdAt >= g.review.submittedAt && first.createdAt <= g.end) ??
      candidates.filter((g) => g.review.submittedAt <= first.createdAt).at(-1)
    group?.threads.push(thread)
  }
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

function Activity({ pr, onComments }: { pr: PrPull; onComments: () => void }) {
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
              {!!threads.length && (
                <Button
                  variant='ghost-text'
                  size='sm'
                  className='h-auto px-0 font-normal'
                  onClick={onComments}
                >
                  ↪ {threads.filter((t) => t.resolved).length} of {threads.length} code comments
                  resolved
                </Button>
              )}
            </div>
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
        <details
          className={cn('group overflow-hidden rounded-md border-[0.5px] border-border', raised)}
        >
          <summary className='flex cursor-pointer list-none items-center gap-2 p-3 text-xs text-muted-foreground'>
            <SuccessStatusIcon className='size-3.5 shrink-0 text-status-success' />
            {count} resolved comments from {authors.join(', ')}
            <ArrowDown01Icon className='ml-auto size-3.5 group-open:rotate-180' />
          </summary>
          <div className='divide-y-[0.5px] divide-border border-t-[0.5px] border-border'>
            {resolved.map((t) => content(t, true))}
          </div>
        </details>
      )}
    </div>
  )
}
// The file tree's order (folders before files at each level, then by name), so the diffs read in the
// order the tree lists them.
function byTreeOrder(a: PrFile, b: PrFile) {
  if (a.path === b.path) return 0
  const x = a.path.split('/')
  const y = b.path.split('/')
  for (let i = 0; ; i++) {
    if (x[i] === y[i]) continue
    const xFolder = i < x.length - 1
    const yFolder = i < y.length - 1
    if (xFolder !== yFolder) return xFolder ? -1 : 1
    return x[i]!.localeCompare(y[i]!, undefined, { sensitivity: 'base', numeric: true })
  }
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

// On a narrow view (the PR in the thread's side panel) the file tree becomes Capy's file menu: the
// Files button opens a filterable tree with each file's line counts, and picking one scrolls to it.
// The tree merges a folder whose only child is a folder into one row ("services / notifications").
function treeRows(paths: string[]) {
  const children = new Map<string, Set<string>>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      children.set(parent, (children.get(parent) ?? new Set()).add(parts.slice(0, i + 1).join('/')))
    }
  }
  const files = new Set(paths)
  const folders = [...children.values()].filter(
    (kids) => kids.size > 1 || files.has([...kids][0]!)
  ).length
  return paths.length + folders
}

function FilesMenu({
  files,
  total,
  filter,
  onFilter,
  inView,
  onSelect,
}: {
  files: PrFile[]
  total: number
  filter: string
  onFilter: (filter: string) => void
  inView: string | null
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='rounded-sm font-normal @min-[720px]:hidden'
          />
        }
      >
        Files {files.length === total ? total : `${files.length} of ${total}`}
        <ArrowDown01Icon className='size-3.5 text-muted-foreground' />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='search-picker w-80 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none'
      >
        <PopoverTitle className='sr-only'>Files</PopoverTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder='Search files'
            aria-label='Search files'
            value={filter}
            onValueChange={onFilter}
          />
        </Command>
        <Separator />
        {/* The tree scrolls inside a fixed height: a row per file and per folder, capped. */}
        <div
          style={{
            height: Math.min(360, treeRows(files.map((f) => f.path)) * 28 + 8),
          }}
        >
          <ChangedFilesTree
            key={files.map((f) => f.path).join()}
            icons='charmed'
            markers='names'
            files={files.map((f) => ({
              path: f.path,
              status: f.status === 'removed' ? 'deleted' : f.status,
            }))}
            counts={Object.fromEntries(
              files.map((f) => [f.path, { additions: f.additions, deletions: f.deletions }])
            )}
            selected={inView}
            onSelect={(path) => {
              setOpen(false)
              onSelect(path)
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
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
  const index = value ? commits.indexOf(value) : -1
  const subject = (commit: PrCommit) => commit.message.split('\n')[0]
  return (
    <div className='flex min-w-0 items-center gap-0.5'>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              size='sm'
              className={cn('min-w-0 rounded-sm font-normal', value && 'bg-accent')}
            />
          }
        >
          {value && value.parents > 1 ? (
            <GitMergeIcon className='size-3.5' />
          ) : (
            <GitCommitHorizontalIcon className='size-3.5' />
          )}
          {value ? (
            <>
              <span className='font-mono text-muted-foreground'>{value.sha.slice(0, 7)}</span>
              <span className='max-w-64 truncate'>{subject(value)}</span>
            </>
          ) : (
            `Commits ${commits.length}`
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' className='w-80 max-w-[calc(100vw-24px)]'>
          <DropdownMenuRadioGroup
            value={value?.sha ?? 'all'}
            onValueChange={(sha) => onChange(sha === 'all' ? null : sha)}
          >
            <DropdownMenuRadioItem value='all' className='h-auto! py-2'>
              <span className='flex flex-col gap-0.5'>
                All commits
                <span className='text-muted-foreground'>
                  {countLabel(commits.length, 'commit')}
                </span>
              </span>
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {commits.map((commit) => (
              <DropdownMenuRadioItem
                key={commit.sha}
                value={commit.sha}
                className='h-auto! items-start py-2'
              >
                {commit.parents > 1 ? (
                  <GitMergeIcon className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
                ) : (
                  <GitCommitHorizontalIcon className='mt-0.5 size-3.5 shrink-0 text-muted-foreground' />
                )}
                <span className='flex min-w-0 flex-col gap-0.5'>
                  <span className='truncate'>{subject(commit)}</span>
                  <span className='flex gap-2 text-muted-foreground'>
                    <span className='font-mono'>{commit.sha.slice(0, 7)}</span>
                    {commit.author}
                    <Ago at={commit.date} raised />
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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
function FileCard({
  file,
  pr,
  comments,
  viewed,
  onViewed,
  hideGenerated,
  commit,
}: {
  file: PrFile
  pr: PrPull
  comments: boolean
  viewed: boolean
  onViewed: (checked: boolean) => void
  hideGenerated: boolean
  commit?: PrCommit
}) {
  const card = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  const [height] = useState(() => Math.max(80, (file.patch?.split('\n').length ?? 4) * 20 + 32))
  useEffect(() => {
    const element = card.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setNear((near) => near || entry!.isIntersecting),
      { root: element.closest('[aria-label="File diffs"]'), rootMargin: '800px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [showGenerated, setShowGenerated] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const open = !viewed && !collapsed
  // Review threads sit on the PR's latest code, so a single commit's diff shows none of them.
  const threads = commit ? [] : pr.threads.filter((t) => t.path === file.path)
  const openThreads = threads.filter((t) => !t.resolved).length
  const renderThreads = (threads: PrThread[]) => (
    <InlineThreads threads={threads} author={pr.viewer} />
  )
  return (
    <section
      ref={card}
      id={`linear-file-${file.path}`}
      data-open={open || undefined}
      className='file-card relative scroll-mt-3 overflow-clip rounded-md'
    >
      {/* Sticky while its file scrolls by. The card's border is drawn by its header and body, so a stuck
          header still reads as the top of a card; the page-coloured backing fills its rounded corners so
          code scrolling under can't show there. The card clips to its rounded outline, which rounds a
          header pushed off by the card's end (file_card.css). */}
      <div className='sticky top-0 z-10 bg-background'>
        <header
          className={cn(
            'file-card-header flex min-h-11 items-center gap-2 border border-border bg-muted/30 px-3 py-2',
            open ? 'rounded-t-md' : 'rounded-md'
          )}
        >
          {/* The file's icon turns into its collapse chevron on hover, as in the Changes view. */}
          <Button
            variant='ghost-text'
            size='icon-sm'
            className='group/collapse relative -my-1 -ml-1'
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <span className='absolute inline-flex group-hover/collapse:opacity-0 group-focus-visible/collapse:opacity-0'>
              <FileGlyph file={file} />
            </span>
            {collapsed ? (
              <ArrowRight01Icon className='absolute opacity-0 group-hover/collapse:opacity-100 group-focus-visible/collapse:opacity-100' />
            ) : (
              <ArrowDown01Icon className='absolute opacity-0 group-hover/collapse:opacity-100 group-focus-visible/collapse:opacity-100' />
            )}
          </Button>
          <Filename file={file} rename />
          <div className='ml-auto flex shrink-0 items-center gap-3'>
            {!!openThreads && (
              <span className='inline-flex items-center gap-1 font-mono text-xs text-muted-foreground'>
                <VerdictGlyph state='COMMENTED' className='size-3.5' />
                {openThreads}
              </span>
            )}
            {file.binary ? (
              <span className='font-mono text-xs text-muted-foreground'>Binary</span>
            ) : (
              <Counts files={[file]} />
            )}
            {!commit && (
              <label
                htmlFor={`viewed-${file.path}`}
                className='flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground'
              >
                <Checkbox
                  id={`viewed-${file.path}`}
                  aria-label={`Mark ${file.path} viewed`}
                  checked={viewed}
                  onCheckedChange={onViewed}
                />
                <span className='@max-[400px]:hidden'>Viewed</span>
              </label>
            )}
            <FileMenu file={file} pr={pr} at={commit?.sha} />
          </div>
        </header>
      </div>
      {open && (
        <div className='file-card-body overflow-clip border border-t-0 border-border'>
          {!near ? (
            <div
              aria-hidden='true'
              style={{
                height: file.binary
                  ? 164
                  : file.generated && hideGenerated && !showGenerated
                    ? 48
                    : comments
                      ? Math.max(
                          80,
                          threads.reduce(
                            (height, thread) => height + 120 + thread.comments.length * 100,
                            0
                          )
                        )
                      : height,
              }}
            />
          ) : file.binary ? (
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
          {near && file.binary && threads.length > 0 && (
            <div className='border-t border-border px-4 py-3'>{renderThreads(threads)}</div>
          )}
        </div>
      )}
      <div aria-hidden='true' className='file-card-tail' />
    </section>
  )
}

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
          <Spinner className='size-3.5' />
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
  const [hideGenerated, setHideGenerated] = useState(true)
  // Narrow (the right sidebar) wraps long lines unless the menu says otherwise; same breakpoint as the
  // file tree's switch to a dropdown.
  const view = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [wrapChoice, setWrapChoice] = useState<boolean | null>(null)
  const wrap = wrapChoice ?? narrow
  useLayoutEffect(() => {
    const element = view.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry!.contentRect.width < 720))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [hideViewed, setHideViewed] = useState(false)
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
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
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
      document.getElementById(`linear-file-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const commitFiles = usePullRequestCommitFiles(ref.repo, commit?.sha ?? null)
  const loadFile = usePullRequestDiffFileLoader(
    ref.repo,
    commit ? (commitFiles.data?.parentSha ?? undefined) : pr.data.pull.base.sha,
    commit?.sha ?? pr.data.pull.head.sha
  )
  const missingPaths = [...new Set(pr.threads.map((thread) => thread.path))].filter(
    (path) => !pr.files.some((file) => file.path === path)
  )
  const changed = commit
    ? (commitFiles.data?.files.map(prFile) ?? [])
    : [
        ...pr.files,
        ...(mode === 'comments'
          ? missingPaths.map(
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
            )
          : []),
      ]
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
  const files = [...changed]
    .sort(byTreeOrder)
    .filter(
      (f) =>
        (commit || mode === 'all' || pr.threads.some((t) => t.path === f.path)) &&
        (!hideViewed || !viewed.has(f.path)) &&
        f.path.toLowerCase().includes(filter.toLowerCase())
    )
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
                            size='sm'
                            aria-pressed={tab === value}
                            className={cn(
                              'rounded-sm font-normal',
                              tab === value ? 'bg-accent text-foreground' : 'text-muted-foreground'
                            )}
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
                                  <code className='rounded bg-muted px-1 py-px font-mono text-xs wrap-anywhere'>
                                    {pr.base}
                                  </code>{' '}
                                  <span className='text-muted-foreground'>from</span>{' '}
                                  <code className='rounded bg-muted px-1 py-px font-mono text-xs wrap-anywhere'>
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
                              <Activity
                                pr={pr}
                                onComments={() => {
                                  setMode('comments')
                                  setFilter('')
                                  setHideViewed(false)
                                  setSelected(null)
                                  setTab('diff')
                                }}
                              />
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
                      <div className='mx-4 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5'>
                        <Button
                          variant='ghost'
                          size='sm'
                          className={`rounded-sm font-normal @max-[720px]:hidden ${pane ? 'bg-accent' : ''}`}
                          aria-expanded={pane}
                          aria-controls='linear-file-pane'
                          {...pressProps(() => setPane(!pane))}
                        >
                          <SidebarLeftIcon className='size-3.5' />
                          Files{' '}
                          {files.length === changed.length
                            ? files.length
                            : `${files.length} of ${changed.length}`}
                        </Button>
                        <FilesMenu
                          files={files}
                          total={changed.length}
                          filter={filter}
                          onFilter={setFilter}
                          inView={inView}
                          onSelect={(path) => {
                            setSelected(path)
                            setInView(path)
                            document
                              .getElementById(`linear-file-${path}`)
                              ?.scrollIntoView({ block: 'start' })
                          }}
                        />
                        <CommitPicker
                          commits={pr.commits}
                          value={commit}
                          onChange={(sha) => {
                            setCommitSha(sha)
                            setSelected(null)
                            if (sha) setMode('all')
                          }}
                        />
                        <div className='ml-auto flex items-center gap-1' aria-label='Diff filter'>
                          {['all', 'comments'].map((value) => (
                            <Button
                              key={value}
                              variant='ghost'
                              size='sm'
                              aria-pressed={mode === value}
                              disabled={!!commit && value === 'comments'}
                              className={`rounded-sm px-3 font-normal ${mode === value ? 'bg-accent' : 'text-muted-foreground'}`}
                              onClick={() => {
                                setMode(value)
                                setSelected(null)
                              }}
                            >
                              {value === 'all'
                                ? 'All'
                                : `Comments ${pr.threads.filter((t) => !t.resolved).length}`}
                            </Button>
                          ))}
                          {/* The thread list's filter menu: a muted Settings2 button, a radio group, then switch rows. */}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant='ghost'
                                  tone='muted'
                                  size='icon-sm'
                                  aria-label='Diff display options'
                                />
                              }
                            >
                              <Settings2Icon className='size-3.5' aria-hidden='true' />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' className='w-44'>
                              <DropdownMenuRadioGroup
                                value={diffStyle}
                                onValueChange={(value) => {
                                  if (value === 'unified' || value === 'split') setDiffStyle(value)
                                }}
                              >
                                <DropdownMenuLabel>View</DropdownMenuLabel>
                                <DropdownMenuRadioItem value='unified'>
                                  Unified
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value='split'>Split</DropdownMenuRadioItem>
                              </DropdownMenuRadioGroup>
                              <DropdownMenuSeparator />
                              {(
                                [
                                  ['Hide generated', hideGenerated, setHideGenerated],
                                  ['Hide viewed', hideViewed, setHideViewed],
                                  ['Wrap lines', wrap, setWrapChoice],
                                ] as const
                              ).map(([label, checked, set]) => (
                                <DropdownMenuCheckboxItem
                                  key={label}
                                  className='pr-2 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
                                  checked={checked}
                                  onCheckedChange={set}
                                  closeOnClick={false}
                                >
                                  {label}
                                  <Switch
                                    render={<span />}
                                    size='sm'
                                    checked={checked}
                                    tabIndex={-1}
                                    aria-hidden='true'
                                    className='pointer-events-none ml-auto'
                                  />
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className='flex min-h-0 flex-1 pt-3'>
                        {pane && (
                          <nav
                            id='linear-file-pane'
                            aria-label='Changed files'
                            className='flex w-[260px] shrink-0 flex-col pr-1.5 pb-4 pl-3 @max-[720px]:hidden'
                          >
                            <Input
                              aria-label='Filter files'
                              placeholder='Filter files…'
                              value={filter}
                              onChange={(e) => setFilter(e.target.value)}
                              className='mb-2 h-8 text-xs'
                            />
                            <div className='-mx-1.5 min-h-0 flex-1'>
                              <ChangedFilesTree
                                key={`${commitSha}:${files.map((f) => f.path).join()}`}
                                icons='charmed'
                                markers='names'
                                files={files.map((f) => ({
                                  path: f.path,
                                  status: f.status === 'removed' ? 'deleted' : f.status,
                                }))}
                                comments={
                                  commit
                                    ? undefined
                                    : Object.fromEntries(
                                        files.map((f) => [
                                          f.path,
                                          pr.threads.filter((t) => t.path === f.path && !t.resolved)
                                            .length,
                                        ])
                                      )
                                }
                                selected={selected}
                                active={inView}
                                onSelect={(path) => {
                                  if (path === inViewRef.current) return
                                  setSelected(path)
                                  setInView(path)
                                  document
                                    .getElementById(`linear-file-${path}`)
                                    ?.scrollIntoView({ block: 'start' })
                                }}
                              />
                            </div>
                          </nav>
                        )}
                        <main
                          aria-label='File diffs'
                          onScroll={(e) => {
                            const top = e.currentTarget.getBoundingClientRect().top + 24
                            const section = [
                              ...e.currentTarget.querySelectorAll<HTMLElement>(
                                'section[id^=linear-file-]'
                              ),
                            ].find((s) => s.getBoundingClientRect().bottom > top)
                            const path = section?.id.slice('linear-file-'.length) ?? null
                            if (path !== inViewRef.current) setInView(path)
                          }}
                          className='scrollbar-subtle min-w-0 flex-1 space-y-3 overflow-auto pr-4 pb-4 pl-3 @max-[720px]:pl-4'
                        >
                          {files.map((f) => (
                            <FileCard
                              key={`${commitSha}-${f.path}`}
                              file={f}
                              pr={pr}
                              commit={commit}
                              comments={mode === 'comments'}
                              hideGenerated={hideGenerated}
                              viewed={viewed.has(f.path)}
                              onViewed={(checked) => void actions.viewed(f.path, checked)}
                            />
                          ))}
                          {commit && !commitFiles.data && (
                            <p className='p-6 text-xs text-muted-foreground'>
                              {commitFiles.failed ? (
                                <Button variant='ghost-text' size='sm' onClick={commitFiles.retry}>
                                  Couldn't load commit files · Retry
                                </Button>
                              ) : (
                                'Loading commit files…'
                              )}
                            </p>
                          )}
                          {!files.length && (!commit || !!commitFiles.data) && (
                            <p className='p-6 text-xs text-muted-foreground'>
                              No files match this view
                            </p>
                          )}
                        </main>
                      </div>
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
