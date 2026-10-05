import type { ThreadMeta } from '@jetty/shared/wire'

type WorktreeFields = Pick<ThreadMeta, 'id' | 'git' | 'worktree'>

// A new worktree's branch is named after the thread id until its generated title renames it;
// that placeholder isn't worth showing.
export function threadBranch(thread: WorktreeFields) {
  const branch = thread.git?.branch ?? thread.worktree?.branch ?? undefined
  return branch?.endsWith(`/thread-${thread.id}`) ? undefined : branch
}

// From the moment the thread exists until its worktree is ready, not just while setup runs.
export function settingUpWorktree(thread: Pick<ThreadMeta, 'worktree'> | undefined) {
  const state = thread?.worktree?.state
  return state === 'pending' || state === 'setting_up'
}
