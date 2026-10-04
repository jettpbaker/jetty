import type { PullRequestData } from '@jetty/shared/pull-request'

import { Loading } from '@/components/custom/loading'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { perf } from '@/perf'
import {
  usePullRequest,
  usePullRequestThreads,
  useRefreshPullRequest,
  usePullRequestActions,
  useReviewRequestPatches,
  useUnlinkPullRequest,
  useLinkPullRequest,
  pullRequestKey,
  type PullRequestRef,
} from '@/state/pull_requests'
import { useMemo, useLayoutEffect, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  MoreVerticalIcon,
  RefreshIcon,
  LinkSquare02Icon,
  Copy01Icon,
  Unlink01Icon,
} from './huge_icons'
import { MediaLightboxProvider } from './media_lightbox'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { adaptPullRequest } from './pull_request/adapter'
import { JettyStyle } from './pull_request/jetty_style'
import { AfterPrPaint, PrRuntimeContext } from './pull_request/runtime'

type LinkedThread = { id: string; title: string }
const noThreads: readonly LinkedThread[] = []

function externalLink(url: string) {
  return <a aria-label='Open in GitHub' href={url} target='_blank' rel='noreferrer' />
}

function UnlinkItem({ threadId, link }: { threadId: string; link: PullRequestAddress }) {
  const unlink = useUnlinkPullRequest()
  const relink = useLinkPullRequest()
  return (
    <DropdownMenuItem
      onClick={() => {
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
      }}
    >
      <Unlink01Icon />
      Unlink from thread
    </DropdownMenuItem>
  )
}

function MoreMenu({ link, threadId }: { link: PullRequestAddress; threadId?: string }) {
  const refresh = useRefreshPullRequest()
  const { refreshing } = usePullRequest(link)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='ghost' size='icon-sm' aria-label='More' />}>
        <MoreVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={refreshing} onClick={() => refresh(link)}>
            <RefreshIcon />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem render={externalLink(link.url)}>
            <LinkSquare02Icon />
            Open in GitHub
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void navigator.clipboard.writeText(link.url).then(
                () => toast('Link copied'),
                () => toast.error("Couldn't copy link")
              )
            }
          >
            <Copy01Icon />
            Copy link
          </DropdownMenuItem>
          {threadId && <UnlinkItem threadId={threadId} link={link} />}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PullRequestView({
  data,
  link,
  standalone = false,
  threads = noThreads,
  threadId,
}: {
  data: PullRequestData
  link: PullRequestAddress
  standalone?: boolean
  threads?: readonly LinkedThread[]
  threadId?: string
}) {
  const actions = usePullRequestActions(link)
  const patches = useReviewRequestPatches(link)
  const pr = useMemo(() => {
    const reviewers = new Map(
      (data.reviewers ?? data.reviewRequests ?? []).map((reviewer) => [reviewer.login, reviewer])
    )
    const requested = new Map(data.pull.requested_reviewers.map((user) => [user.login, user]))
    for (const [login, patch] of patches) {
      if (patch.requested) requested.set(login, patch.user)
      else requested.delete(login)
      const current = reviewers.get(login)
      if (current) reviewers.set(login, { ...current, requested: patch.requested })
      else if (patch.requested)
        reviewers.set(login, {
          ...patch.user,
          kind: 'user',
          asCodeOwner: false,
          requested: true,
          state: 'AWAITING',
          latestReviewState: null,
        })
    }
    return adaptPullRequest({
      ...data,
      pull: { ...data.pull, requested_reviewers: [...requested.values()] },
      reviewers: [...reviewers.values()],
    })
  }, [data, patches])
  const runtime = useMemo(
    () => ({
      ref: link,
      actions,
      threads,
      more: <MoreMenu link={link} threadId={threadId} />,
      sidebar: standalone ? <PageSidebarTrigger /> : null,
    }),
    [link, actions, threads, threadId, standalone]
  )
  useLayoutEffect(() => perf.rendered('pr.open'), [])
  return (
    <PrRuntimeContext value={runtime}>
      <AfterPrPaint>
        <JettyStyle pr={pr} />
      </AfterPrPaint>
    </PrRuntimeContext>
  )
}

const unavailableTitle = {
  unavailable: 'GitHub unavailable',
  not_found: 'Pull request not found',
  rate_limited: 'GitHub rate limit reached',
}

type PullRequestAddress = PullRequestRef & { url: string }

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
  const linkedThreads = usePullRequestThreads(link)
  const refresh = useRefreshPullRequest()
  const failure = snapshot && snapshot.status !== 'ready' && snapshot.status !== 'loading'
  if (snapshot?.data)
    return (
      <MediaLightboxProvider>
        <PullRequestView
          key={pullRequestKey(link)}
          data={snapshot.data}
          link={link}
          standalone={standalone}
          threads={threads ?? linkedThreads}
          threadId={threadId}
        />
      </MediaLightboxProvider>
    )
  if (!failure) return <Loading label='Loading pull request…' />
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
      {threadId && <MoreMenu threadId={threadId} link={link} />}
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
