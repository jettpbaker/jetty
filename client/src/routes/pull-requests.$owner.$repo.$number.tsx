import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { LivePullRequestView } from '@/components/custom/pull_request_view'
import { useChrome, usePullRequest } from '@/state'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'

export const Route = createFileRoute('/pull-requests/$owner/$repo/$number')({
  component: PullRequestPage,
})

function PullRequestPage() {
  const params = Route.useParams()
  const repo = `${params.owner}/${params.repo}`.toLowerCase()
  const number = Number(params.number)
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
      />
    </section>
  )
}
