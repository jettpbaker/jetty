import type { GitHubIssue } from '@jetty/shared/wire'

import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
} from '@/components/custom/lucide_icons'
import { useNow } from '@/hooks/use-now'
import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  useBot,
  useIssueSummary,
  useLinkedPull,
  useOpenPullRequestTab,
  useProjectRepos,
  usePullRequestSummary,
  useThreadMeta,
  useThreadRowPrefetch,
} from '@/state'
import { PreviewCard } from '@base-ui/react/preview-card'
import { Link, useParams } from '@tanstack/react-router'
import {
  createContext,
  use,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from 'react'

import { botColorStyle } from './bot_avatar'
import './bot_link.css'
import { JettyBot } from './jetty_bot'
import { visitLinks, type MarkdownNode } from './markdown_links'
import { OverflowTitle } from './overflow_title'
import { PersonAvatar } from './person_avatar'
import { pullRequestFacts, type GitHubPullRequest } from './pull_request_model'
import { ThreadHoverDetails, ThreadHoverPopup } from './thread_hover'
import { linkPresentation } from './thread_pull_request'
import { statusPresentation, threadStatus, type Status } from './thread_status'

type Kind = 'thread' | 'bot' | 'pr' | 'issue' | 'commit'
type Glyph = ComponentType<SVGProps<SVGSVGElement>>

// The agent writes ordinary markdown links; Jetty swaps the ones it recognises for <entity-link>.

// The last group is a place within the entity (a comment, a file, a tab): a permalink.
const entityPatterns: [Kind, RegExp][] = [
  ['thread', /^jetty:\/\/threads\/([\da-f-]+)()$/],
  ['bot', /^jetty:\/\/bots\/([\w-]+)()$/],
  ['pr', /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?([/?#].*)?$/],
  ['issue', /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?([/?#].*)?$/],
  ['commit', /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/commit\/([\da-f]{7,40})\/?([/?#].*)?$/],
]

function entityOf(url: string) {
  for (const [kind, pattern] of entityPatterns) {
    const match = url.match(pattern)
    if (!match) continue
    const [, first = '', second, within] = match
    const repo = first.toLowerCase()
    return {
      kind,
      entity:
        kind === 'thread' || kind === 'bot'
          ? first
          : kind === 'commit'
            ? `${repo}@${second}`
            : `${repo}#${second}`,
      ...(within && { permalink: url }),
    }
  }
}

const githubPaths: Record<string, string> = { pr: 'pull', issue: 'issues', commit: 'commit' }

function entityUrl(kind: string, entity: string) {
  if (kind === 'thread') return `jetty://threads/${entity}`
  if (kind === 'bot') return `jetty://bots/${entity}`
  const [repo, id] = entity.split(/[#@]/)
  return `https://github.com/${repo}/${githubPaths[kind]}/${id}`
}

export function remarkEntityLinks() {
  return (tree: MarkdownNode) =>
    visitLinks(tree, (node, url) => {
      const target = entityOf(url)
      if (target) node.data = { ...node.data, hName: 'entity-link', hProperties: target }
    })
}

export const entityLinkTag = { 'entity-link': ['kind', 'entity', 'permalink'] }

// The link stays inline, so it wraps like the words around it and never leaves a hole.
export const inlineLinkClass =
  'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 text-primary decoration-current/40 underline-offset-[3px] hover:underline'

const pullGlyph = 'size-3.5 align-[-2px]'
const discGlyph = 'size-3 align-[-1px]'

// The glyph is glued to the first word so a line never ends on a bare glyph.
function Lead({
  icon: Icon,
  color,
  label,
  size,
  gap = 'mr-1',
  children,
}: {
  icon: Glyph
  color: string
  label: string
  size: string
  gap?: string
  children: ReactNode
}) {
  return (
    <span className='whitespace-nowrap'>
      <Icon aria-hidden='true' className={cn('inline-block', gap, color, size)} />
      <span className='sr-only'>{label} </span>
      {children}
    </span>
  )
}

export function LeadTitle({
  text,
  ...lead
}: Omit<ComponentProps<typeof Lead>, 'children'> & { text: string }) {
  const [first, ...rest] = text.split(' ')
  return (
    <>
      <Lead {...lead}>{first}</Lead>
      {rest.length > 0 && ` ${rest.join(' ')}`}
    </>
  )
}

// Long titles stop at a word near 240px of chat text, so a link stays a phrase; the hover card
// has the rest.
export function shorten(title: string, limit = 34) {
  if (title.length <= limit) return title
  const cut = title.slice(0, limit + 1)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.]+$/, '')}…`
}

// A repo is home when this page's project has a PR in it; links to anything else name their repo.
function useHomeRepos() {
  const { threadId, owner, repo } = useParams({ strict: false })
  const projectRepos = useProjectRepos(useThreadMeta(threadId)?.projectId)
  return owner && repo ? new Set([`${owner}/${repo}`.toLowerCase()]) : projectRepos
}

function GitHubAnchor({ className, children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} target='_blank' rel='noreferrer' className={cn(inlineLinkClass, className)}>
      {children}
    </a>
  )
}

// `outcome` shows how a run ended in place of the thread's live status.
export function ThreadLink({
  id,
  fallback,
  outcome,
}: {
  id: string
  fallback: ReactNode
  outcome?: Status
}) {
  const prefetch = useThreadRowPrefetch()
  const meta = useThreadMeta(id)
  if (!meta) return fallback
  const look = statusPresentation[outcome ?? threadStatus(meta.status, meta.readyForReview)]
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={500}
        closeDelay={100}
        render={
          <Link
            to='/threads/$threadId'
            params={{ threadId: id }}
            className={inlineLinkClass}
            onPointerEnter={() => prefetch.enter(id)}
            onPointerLeave={() => prefetch.leave(id)}
          />
        }
      >
        <LeadTitle
          icon={look.icon!}
          color={look.color}
          label={look.label}
          size={discGlyph}
          text={shorten(meta.title)}
        />
      </PreviewCard.Trigger>
      <ThreadHoverPopup side='bottom'>
        <ThreadHoverDetails threadId={id} />
      </ThreadHoverPopup>
    </PreviewCard.Root>
  )
}

// A bot's mention: its face and current name in its colour, opening its chat. Click, not
// pointer-down: the chip sits in a scrollable chat.
export function BotLink({ id, fallback }: { id: string; fallback: ReactNode }) {
  const bot = useBot(id)
  if (!bot) return fallback
  return (
    <Link
      to='/bots/$botId'
      params={{ botId: id }}
      style={botColorStyle(bot.color)}
      className='bot-link outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
    >
      <JettyBot shape={bot.shape} color={bot.color} size={14} />
      {bot.name}
    </Link>
  )
}

const mentionLink = /\[@((?:\\.|[^\]\\])*)\]\(jetty:\/\/bots\/([\w-]+)\)/g

// Jett's messages show as typed, but for the bots they mention.
export function BotMentions({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(mentionLink)) {
    const [link, label = '', id = ''] = match
    parts.push(
      text.slice(at, match.index),
      <BotLink key={match.index} id={id} fallback={`@${label.replace(/\\(.)/g, '$1')}`} />
    )
    at = match.index + link.length
  }
  parts.push(text.slice(at))
  return parts
}

const previewShell =
  'flex w-72 max-w-[calc(100vw-24px)] flex-col gap-1.5 rounded-sm border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md'

function PullPreview({
  entity,
  pull,
  look,
}: {
  entity: string
  pull: GitHubPullRequest
  look: ReturnType<typeof linkPresentation>
}) {
  const now = useNow(60_000)
  return (
    <>
      <OverflowTitle>{pull.title}</OverflowTitle>
      <div className='flex min-w-0 items-center justify-between gap-3 text-muted-foreground'>
        <span className='flex shrink-0 items-center gap-1.5'>
          <span className={cn('flex items-center gap-1', look.color)}>
            <look.icon aria-hidden='true' className='size-3' />
            {look.label}
          </span>
          <span aria-hidden='true'>·</span>
          <span className='font-mono'>{formatAge(Date.parse(pull.updated_at), now)}</span>
        </span>
        <span className='truncate'>{entity}</span>
      </div>
      <div className='flex min-w-0 items-center gap-1 text-muted-foreground'>
        <GitBranchIcon aria-hidden='true' className='size-3 shrink-0' />
        <span className='truncate font-mono'>{pull.head.ref}</span>
        <span className='ml-auto shrink-0 pl-2 font-mono'>
          <span className='text-status-success'>+{pull.additions}</span>{' '}
          <span className='text-status-error'>−{pull.deletions}</span>
        </span>
      </div>
    </>
  )
}

// Set around a thread's chat. Absent on a PR page, and in the details pane's own markdown.
export const OpenPullLink = createContext<string | undefined>(undefined)

// ⌘-click, ctrl-click, middle-click and the rest keep the browser's handling of the real link.
export function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

// A permalink (a review comment, the Files tab) opens there on GitHub; Jetty's view has no anchors.
function PullLink({ entity, permalink }: { entity: string; permalink?: string }) {
  const home = useHomeRepos()
  const paneThreadId = use(OpenPullLink)
  const openInPane = useOpenPullRequestTab()
  const [repo = '', number = ''] = entity.split('#')
  const [owner = '', name = ''] = repo.split('/')
  const target = {
    to: '/pull-requests/$owner/$repo/$number',
    params: { owner, repo: name, number },
  } as const
  const data = usePullRequestSummary({ repo, number: Number(number) })
  // A thread's link to it follows GitHub live; a PR no thread links shows its last read.
  const linked = useLinkedPull(repo, Number(number))
  const facts = linked?.state ? linked : data && pullRequestFacts(data)
  const look = linkPresentation(facts)
  // Accent until the state arrives: a muted link would read as plain text.
  const color = facts?.state ? look.color : 'text-primary'
  const linkClass = cn(inlineLinkClass, color)
  const content = (
    <LeadTitle
      icon={look.icon}
      color={color}
      label={look.label}
      size={pullGlyph}
      text={data ? shorten(data.pull.title) : home.has(repo) ? `#${number}` : entity}
    />
  )
  // Click, not pointer-down: the chip sits in a scrollable chat. Enter fires click too.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!paneThreadId || !plainClick(event)) return
    event.preventDefault()
    openInPane(paneThreadId, { repo, number: Number(number) })
  }
  if (!data)
    return permalink ? (
      <GitHubAnchor href={permalink} title={look.label} className={linkClass}>
        {content}
      </GitHubAnchor>
    ) : (
      <Link {...target} className={linkClass} title={look.label} onClick={onClick}>
        {content}
      </Link>
    )
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={500}
        closeDelay={100}
        render={
          permalink ? (
            <GitHubAnchor href={permalink} className={linkClass} />
          ) : (
            <Link {...target} className={linkClass} onClick={onClick} />
          )
        }
      >
        {content}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side='bottom' align='start' sideOffset={6} className='z-50'>
          <PreviewCard.Popup
            data-overflow-hover
            className={cn(
              previewShell,
              'transition-opacity duration-100 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-0 motion-reduce:transition-none'
            )}
          >
            <PullPreview entity={entity} pull={data.pull} look={look} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

// GitHub's issue colours: open is the open-PR green, completed is the merged purple, not planned is muted.
// `label` is the chip's accessible name. `name` is the short state the hover card shows, like a PR's.
const issuePresentation = {
  open: { icon: CircleDotIcon, color: 'text-pr-open', label: 'Open issue', name: 'Open' },
  completed: {
    icon: CircleCheckIcon,
    color: 'text-pr-merged',
    label: 'Closed issue',
    name: 'Closed',
  },
  not_planned: {
    icon: CircleSlashIcon,
    color: 'text-muted-foreground',
    label: 'Issue closed as not planned',
    name: 'Not planned',
  },
} as const

const unknownIssue = {
  icon: CircleDotIcon,
  color: 'text-muted-foreground',
  label: 'Issue',
  name: 'Issue',
}

function issueLook(issue?: GitHubIssue) {
  if (!issue) return unknownIssue
  if (issue.state === 'open' || issue.stateReason === 'reopened') return issuePresentation.open
  if (issue.stateReason === 'not_planned') return issuePresentation.not_planned
  return issuePresentation.completed
}

// A label keeps GitHub's own colour, with text picked so it stays readable on that fill in either theme.
function labelChipStyle(color: string): CSSProperties | undefined {
  const hex = color.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return { backgroundColor: `#${hex}`, color: luminance > 0.6 ? '#1f2328' : '#ffffff' }
}

function IssuePreview({
  entity,
  issue,
  look,
}: {
  entity: string
  issue: GitHubIssue
  look: ReturnType<typeof issueLook>
}) {
  const now = useNow(60_000)
  const updated = Date.parse(issue.updatedAt)
  return (
    <>
      <OverflowTitle>{issue.title}</OverflowTitle>
      <div className='flex min-w-0 items-center justify-between gap-3 text-muted-foreground'>
        <span className='flex shrink-0 items-center gap-1.5'>
          <span className={cn('flex items-center gap-1', look.color)}>
            <look.icon aria-hidden='true' className='size-3' />
            {look.name}
          </span>
          {!Number.isNaN(updated) && (
            <>
              <span aria-hidden='true'>·</span>
              <span className='font-mono'>{formatAge(updated, now)}</span>
            </>
          )}
        </span>
        <span className='truncate'>{entity}</span>
      </div>
      {issue.labels.length > 0 && (
        <div className='flex flex-wrap gap-1'>
          {issue.labels.map((label, index) => {
            const style = labelChipStyle(label.color)
            return (
              <span
                key={`${label.name}-${index}`}
                className={cn(
                  'inline-flex max-w-full truncate rounded-full px-1.5 leading-4 font-medium',
                  !style && 'bg-muted text-foreground'
                )}
                style={style}
              >
                {label.name}
              </span>
            )
          })}
        </div>
      )}
      {(issue.author || issue.assignees.length > 0) && (
        <div className='flex min-w-0 items-center gap-1 text-muted-foreground'>
          {issue.author && <span className='truncate font-mono'>{issue.author.login}</span>}
          {issue.assignees.length > 0 && (
            <span className='ml-auto flex shrink-0 items-center gap-1 pl-2'>
              {issue.assignees.map((person) => (
                <PersonAvatar
                  key={person.login}
                  login={person.login}
                  src={person.avatarUrl || undefined}
                  className='size-4'
                />
              ))}
            </span>
          )}
        </div>
      )}
    </>
  )
}

// A permalink (an issue comment) opens there on GitHub; the chip and the card share one read.
function IssueLink({ entity, permalink }: { entity: string; permalink?: string }) {
  const home = useHomeRepos()
  const [repo = '', number = ''] = entity.split('#')
  const issue = useIssueSummary({ repo, number: Number(number) })
  const look = issueLook(issue)
  const href = permalink ?? entityUrl('issue', entity)
  const content = (
    <LeadTitle
      icon={look.icon}
      color={look.color}
      label={look.label}
      size={pullGlyph}
      text={issue ? shorten(issue.title) : home.has(repo) ? `#${number}` : entity}
    />
  )
  if (!issue)
    return (
      <GitHubAnchor href={href} title={look.label}>
        {content}
      </GitHubAnchor>
    )
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={500}
        closeDelay={100}
        render={<GitHubAnchor href={href} title={look.label} />}
      >
        {content}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side='bottom' align='start' sideOffset={6} className='z-50'>
          <PreviewCard.Popup
            data-overflow-hover
            className={cn(
              previewShell,
              'transition-opacity duration-100 ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-0 motion-reduce:transition-none'
            )}
          >
            <IssuePreview entity={entity} issue={issue} look={look} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

function CommitLink({ entity, permalink }: { entity: string; permalink?: string }) {
  const home = useHomeRepos()
  const [repo = '', sha = ''] = entity.split('@')
  const short = sha.slice(0, 7)
  return (
    <GitHubAnchor href={permalink ?? entityUrl('commit', entity)} title={`${repo}@${short}`}>
      <Lead
        icon={GitCommitHorizontalIcon}
        color='text-muted-foreground'
        label='Commit'
        size={pullGlyph}
      >
        <span className='font-mono'>{home.has(repo) ? short : `${repo}@${short}`}</span>
      </Lead>
    </GitHubAnchor>
  )
}

export function EntityLink({
  kind = '',
  entity = '',
  permalink,
  children,
}: {
  kind?: string
  entity?: string
  permalink?: string
  children?: ReactNode
}) {
  // Only props remarkEntityLinks could make: a permalink on github.com, to the entity named.
  const target = entityOf(permalink ?? entityUrl(kind, entity))
  if (target?.kind !== kind || target.entity !== entity) return children
  if (kind === 'thread') return <ThreadLink id={entity} fallback={children} />
  if (kind === 'bot') return <BotLink id={entity} fallback={children} />
  if (kind === 'pr') return <PullLink entity={entity} permalink={permalink} />
  if (kind === 'issue') return <IssueLink entity={entity} permalink={permalink} />
  return <CommitLink entity={entity} permalink={permalink} />
}
