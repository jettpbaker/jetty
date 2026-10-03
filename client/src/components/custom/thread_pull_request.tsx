import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from '@/components/custom/lucide_icons'
import { cn } from '@/lib/utils'

export const prPresentation = {
  draft: { icon: GitPullRequestDraftIcon, label: 'Draft', color: 'text-pr-draft' },
  open: { icon: GitPullRequestIcon, label: 'Open', color: 'text-pr-open' },
  merged: { icon: GitMergeIcon, label: 'Merged', color: 'text-pr-merged' },
  closed: { icon: GitPullRequestClosedIcon, label: 'Closed', color: 'text-pr-closed' },
}

export type ThreadPullRequest = {
  repo: string
  number: number
  state: keyof typeof prPresentation
}

// A link's state is unknown until GitHub has been read once.
export function linkPresentation(state?: keyof typeof prPresentation) {
  return state
    ? prPresentation[state]
    : { ...prPresentation.open, label: 'Pull request', color: 'text-muted-foreground' }
}

// In-flight PRs lead, matching how the app ranks a thread's PRs.
const stateOrder: ThreadPullRequest['state'][] = ['open', 'draft', 'merged', 'closed']

// A thread's PRs as its row and hover card show them: one by number, several as a count per state.
export function PullRequestMark({ pullRequests }: { pullRequests: readonly ThreadPullRequest[] }) {
  const [only] = pullRequests
  const groups =
    pullRequests.length === 1 && only
      ? [{ state: only.state, text: `#${only.number}` }]
      : stateOrder.flatMap((state) => {
          const count = pullRequests.filter((pr) => pr.state === state).length
          return count ? [{ state, text: `${count}` }] : []
        })
  const title =
    pullRequests.length === 1 && only
      ? `${prPresentation[only.state].label} PR #${only.number}`
      : groups
          .map(({ state, text }) => `${text} ${prPresentation[state].label.toLowerCase()}`)
          .join(', ')

  return (
    <span className='flex shrink-0 items-center gap-1.5' title={title}>
      {groups.map(({ state, text }) => {
        const pr = prPresentation[state]
        return (
          <span key={state} className={cn('flex items-center gap-1', pr.color)}>
            <pr.icon aria-hidden='true' className='size-3' />
            <span className='font-mono'>{text}</span>
            <span className='sr-only'>{pr.label}</span>
          </span>
        )
      })}
    </span>
  )
}
