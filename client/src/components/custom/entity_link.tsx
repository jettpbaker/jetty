import type { ThreadMeta } from '@jetty/shared/wire'

import {
  CircleDotIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
} from '@/components/custom/lucide_icons'
import { useNow } from '@/hooks/use-now'
import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  useChrome,
  useOpenPullRequest,
  usePullRequestSummary,
  useThreadRowPrefetch,
  type Chrome,
} from '@/state'
import { PreviewCard } from '@base-ui/react/preview-card'
import { Link, useParams } from '@tanstack/react-router'
import {
  useMemo,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react'

import { OverflowTitle } from './overflow_title'
import { pullRequestFacts, type GitHubPullRequest } from './pull_request_model'
import { sidebarThreads } from './sidebar_thread_groups'
import { ThreadHoverContent } from './thread_hover'
import { linkPresentation } from './thread_pull_request'
import { statusPresentation, threadStatus } from './thread_status'

type Kind = 'thread' | 'pr' | 'issue' | 'commit'
type Glyph = ComponentType<SVGProps<SVGSVGElement>>

// The agent writes ordinary markdown links; Jetty swaps the ones it recognises for <entity-link>.

const entityPatterns: [Kind, RegExp][] = [
  ['thread', /^jetty:\/\/threads\/([\da-f-]+)$/],
  ['pr', /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/],
  ['issue', /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(?:[/?#].*)?$/],
  ['commit', /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/commit\/([\da-f]{7,40})(?:[/?#].*)?$/],
]

function entityOf(url: string) {
  for (const [kind, pattern] of entityPatterns) {
    const match = url.match(pattern)
    if (!match) continue
    const [, first = '', second] = match
    const repo = first.toLowerCase()
    return {
      kind,
      entity:
        kind === 'thread' ? first : kind === 'commit' ? `${repo}@${second}` : `${repo}#${second}`,
    }
  }
}

type MarkdownNode = {
  type: string
  url?: string
  children?: MarkdownNode[]
  data?: { hName?: string; hProperties?: Record<string, string> }
}

export function remarkEntityLinks() {
  function visit(node: MarkdownNode) {
    const target = node.type === 'link' && node.url ? entityOf(node.url) : undefined
    if (target) node.data = { ...node.data, hName: 'entity-link', hProperties: target }
    for (const child of node.children ?? []) visit(child)
  }
  return visit
}

export const entityLinkTag = { 'entity-link': ['kind', 'entity'] }

// The link stays inline, so it wraps like the words around it and never leaves a hole.
const linkClass =
  'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 text-primary decoration-primary/40 underline-offset-[3px] hover:underline'

const pullGlyph = 'size-3.5 align-[-2px]'
const discGlyph = 'size-3 align-[-1px]'

// The glyph is glued to the first word so a line never ends on a bare glyph.
function Lead({
  icon: Icon,
  color,
  label,
  size,
  children,
}: {
  icon: Glyph
  color: string
  label: string
  size: string
  children: ReactNode
}) {
  return (
    <span className='whitespace-nowrap'>
      <Icon aria-hidden='true' className={cn('mr-1 inline-block', color, size)} />
      <span className='sr-only'>{label} </span>
      {children}
    </span>
  )
}

// Long titles stop at a word, so a link stays a phrase; the hover card has the rest.
function shorten(title: string, limit = 40) {
  if (title.length <= limit) return title
  const cut = title.slice(0, limit + 1)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.]+$/, '')}…`
}

// A repo is home when this page's project has a PR in it; links to anything else name their repo.
function useHomeRepos() {
  const chrome = useChrome()
  const { threadId, owner, repo } = useParams({ strict: false })
  return useMemo(() => {
    if (owner && repo) return new Set([`${owner}/${repo}`.toLowerCase()])
    const projectId = chrome?.threads.find((thread) => thread.id === threadId)?.projectId
    return new Set(
      chrome?.threads.flatMap((thread) =>
        thread.projectId === projectId ? (thread.pullRequests ?? []).map((link) => link.repo) : []
      )
    )
  }, [chrome, threadId, owner, repo])
}

function GitHubAnchor({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} target='_blank' rel='noreferrer' className={linkClass}>
      {children}
    </a>
  )
}

function ThreadPreview({ meta, chrome }: { meta: ThreadMeta; chrome: Chrome }) {
  const now = useNow(60_000)
  const openPullRequest = useOpenPullRequest()
  const [thread] = sidebarThreads(chrome, now, [meta])
  if (!thread) return null
  return (
    <ThreadHoverContent
      details={thread}
      model={thread.model}
      effort={thread.effort}
      status={thread.status}
      onOpenPullRequest={() => thread.pullRequest && openPullRequest(thread.id, thread.pullRequest)}
    />
  )
}

function ThreadLink({ id, fallback }: { id: string; fallback: ReactNode }) {
  const chrome = useChrome()
  const prefetch = useThreadRowPrefetch()
  const meta = chrome?.threads.find((thread) => thread.id === id)
  if (!chrome || !meta) return fallback
  // A thread that has gone idle has finished its run.
  const status = threadStatus(meta.status, meta.readyForReview)
  const look = statusPresentation[status === 'idle' ? 'done' : status]
  const [first, ...rest] = shorten(meta.title).split(' ')
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={500}
        closeDelay={100}
        render={
          <Link
            to='/threads/$threadId'
            params={{ threadId: id }}
            className={linkClass}
            onPointerEnter={() => prefetch.enter(id)}
            onPointerLeave={() => prefetch.leave(id)}
          />
        }
      >
        <Lead icon={look.icon!} color={look.color} label={look.label} size={discGlyph}>
          {first}
        </Lead>
        {rest.length > 0 && ` ${rest.join(' ')}`}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side='bottom' align='start' sideOffset={8} className='z-50'>
          <PreviewCard.Popup className='thread-hover-shared'>
            <ThreadPreview meta={meta} chrome={chrome} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
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

function PullLink({ entity }: { entity: string }) {
  const chrome = useChrome()
  const home = useHomeRepos()
  const [repo = '', number = ''] = entity.split('#')
  const [owner = '', name = ''] = repo.split('/')
  const target = {
    to: '/pull-requests/$owner/$repo/$number',
    params: { owner, repo: name, number },
  } as const
  const data = usePullRequestSummary({ repo, number: Number(number) })
  // A thread's link to it follows GitHub live; a PR no thread links shows its last read.
  const linked = chrome?.threads
    .flatMap((thread) => thread.pullRequests ?? [])
    .find((link) => link.repo === repo && link.number === Number(number))
  const look = linkPresentation(linked?.state ? linked : data && pullRequestFacts(data))
  const content = (
    <Lead icon={look.icon} color={look.color} label={look.label} size={pullGlyph}>
      {home.has(repo) ? `#${number}` : entity}
    </Lead>
  )
  if (!data)
    return (
      <Link {...target} className={linkClass} title={look.label}>
        {content}
      </Link>
    )
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={500}
        closeDelay={100}
        render={<Link {...target} className={linkClass} />}
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

function IssueLink({ entity }: { entity: string }) {
  const home = useHomeRepos()
  const [repo = '', number = ''] = entity.split('#')
  return (
    <GitHubAnchor href={`https://github.com/${repo}/issues/${number}`} title={entity}>
      <Lead icon={CircleDotIcon} color='text-muted-foreground' label='Open issue' size={pullGlyph}>
        {home.has(repo) ? `#${number}` : entity}
      </Lead>
    </GitHubAnchor>
  )
}

function CommitLink({ entity }: { entity: string }) {
  const home = useHomeRepos()
  const [repo = '', sha = ''] = entity.split('@')
  const short = sha.slice(0, 7)
  return (
    <GitHubAnchor href={`https://github.com/${repo}/commit/${sha}`} title={`${repo}@${short}`}>
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
  kind,
  entity,
  children,
}: {
  kind?: string
  entity?: string
  children?: ReactNode
}) {
  if (!entity) return children
  if (kind === 'thread') return <ThreadLink id={entity} fallback={children} />
  if (kind === 'pr') return <PullLink entity={entity} />
  if (kind === 'issue') return <IssueLink entity={entity} />
  if (kind === 'commit') return <CommitLink entity={entity} />
  return children
}
