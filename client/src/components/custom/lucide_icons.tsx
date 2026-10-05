import { createLucideIcon } from 'lucide-react'

export {
  CircleSlashIcon,
  CircleIcon,
  CircleDashedIcon,
  CircleCheckIcon,
  CircleDotIcon,
  DiffIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  GitPullRequestDraftIcon,
  Settings2Icon,
  WorkflowIcon,
} from 'lucide-react'

// Merged and closed redrawn on Lucide's git-pull-request (open), so the three PR states read as one
// family: rings at 6,6 and 18,18, the stem down from the top ring, the hook into the bottom ring.
// A filled disc reads heavier than a ring with the same edge, so merged's discs give back a quarter
// unit; closed's ✕ takes the top ring's place with equal gaps to the stem below and the hook beside.
export const GitPullRequestMergedIcon = createLucideIcon('git-pull-request-merged', [
  ['circle', { cx: '18', cy: '18', r: '2.75', fill: 'currentColor', key: 'ring-bottom' }],
  ['circle', { cx: '6', cy: '6', r: '2.75', fill: 'currentColor', key: 'ring-top' }],
  ['path', { d: 'M13 6h3a2 2 0 0 1 2 2v7', key: 'hook' }],
  ['line', { x1: '6', x2: '6', y1: '9', y2: '21', key: 'stem' }],
])

export const GitPullRequestClosedIcon = createLucideIcon('git-pull-request-closed', [
  ['circle', { cx: '18', cy: '18', r: '3', key: 'ring-bottom' }],
  ['path', { d: 'M11.5 6h4.5a2 2 0 0 1 2 2v7', key: 'hook' }],
  ['path', { d: 'm3 3 6 6', key: 'cross-down' }],
  ['path', { d: 'm3 9 6-6', key: 'cross-up' }],
  ['line', { x1: '6', x2: '6', y1: '11.5', y2: '21', key: 'stem' }],
])
