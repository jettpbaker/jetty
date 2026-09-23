import { PullRequestList } from '@/components/custom/pull_request_list'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/pull-requests/')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'created' } =>
    search.tab === 'created' ? { tab: 'created' } : {},
  component: PullRequests,
})

function PullRequests() {
  const { tab = 'for-you' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <PullRequestList
      tab={tab}
      onTabChange={(next) =>
        navigate({ search: next === 'created' ? { tab: next } : {}, replace: true })
      }
    />
  )
}
