import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { LivePullRequestView, PullRequestUnavailable } from '@/components/custom/pull_request_view'
import { Button } from '@/components/ui/button'
import { useChrome, usePullRequest } from '@/state'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'

export const Route = createFileRoute('/pull-requests/$owner/$repo/$number')({
  component: PullRequestPage,
})

function PullRequestPage() {
  const params = Route.useParams()
  const repo = `${params.owner}/${params.repo}`.toLowerCase()
  if (!/^[1-9]\d*$/.test(params.number))
    return (
      <section className='flex h-full min-h-0 flex-col' aria-label='Pull request'>
        <PageSidebarTrigger standalone />
        <PullRequestUnavailable title='Pull request not found' detail={`${repo}#${params.number}`}>
          <Button
            variant='outline'
            size='sm'
            nativeButton={false}
            render={<Link to='/pull-requests' />}
          >
            Pull requests
          </Button>
        </PullRequestUnavailable>
      </section>
    )
  return <LivePullRequestPage repo={repo} number={Number(params.number)} />
}

function LivePullRequestPage({ repo, number }: { repo: string; number: number }) {
  const { snapshot } = usePullRequest({ repo, number })
  const chromeThreads = useChrome()?.threads
  const threads = useMemo(
    () =>
      (chromeThreads ?? []).filter((thread) =>
        thread.pullRequests?.some((link) => link.repo === repo && link.number === number)
      ),
    [chromeThreads, repo, number]
  )
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='Pull request'>
      {!snapshot?.data && <PageSidebarTrigger standalone />}
      <LivePullRequestView
        key={`${repo}#${number}`}
        link={{ repo, number, url: `https://github.com/${repo}/pull/${number}` }}
        threads={threads}
        standalone
      />
    </section>
  )
}
