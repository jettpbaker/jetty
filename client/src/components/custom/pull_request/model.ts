import { createContext } from 'react'

import type { PrCheck, PrFile, PrPull, PrThread, PrUser } from './adapter'

// How diffs lay out; a view provides "split" to switch every diff under it.
export const DiffStyleContext = createContext<'unified' | 'split'>('unified')
// Whether long lines wrap instead of scrolling sideways.
export const DiffWrapContext = createContext(false)
// Quote reply: hands a comment's markdown to the conversation's comment box.
export const QuoteContext = createContext<(body: string) => void>(() => {})

export const failed = (c: PrCheck) =>
  ['failure', 'timed_out', 'action_required', 'cancelled', 'stale', 'startup_failure'].includes(
    c.conclusion ?? ''
  )
export const running = (c: PrCheck) => c.status !== 'completed'
// GitHub's profile display name when set, else the login.
// GitHub sends bots with a login like `copilot-pull-request-reviewer[bot]` and no display name, so
// known ones get their product name and the rest drop the suffix.
const botNames: Record<string, string> = { 'copilot-pull-request-reviewer[bot]': 'Copilot' }
export const personName = (user: PrUser) =>
  user.name ?? botNames[user.login] ?? user.login.replace(/\[bot\]$/, '')
export function checkCounts(pr: PrPull) {
  return {
    failed: pr.checks.filter(failed).length,
    running: pr.checks.filter(running).length,
    passed: pr.checks.filter((c) => c.conclusion === 'success').length,
    skipped: pr.checks.filter((c) => c.conclusion === 'skipped').length,
  }
}
export function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
export function mergeReason(pr: PrPull) {
  const data = pr.data
  if (pr.state === 'draft') return 'Draft · publish when ready for review.'
  if (pr.state === 'closed' || pr.state === 'merged') return 'This pull request is closed.'
  if (!data.viewerCanUpdate) return "You don't have permission to merge this pull request."
  if (!pr.mergeMethods.length) return 'No merge methods available.'
  if (
    data.mergeable === 'CONFLICTING' ||
    data.pull.mergeable_state === 'dirty' ||
    data.mergeStateStatus === 'DIRTY'
  )
    return 'Resolve merge conflicts first'
  if (data.pull.mergeable_state === 'behind' || data.mergeStateStatus === 'BEHIND')
    return 'Branch is out of date'
  if (data.reviewDecision === 'CHANGES_REQUESTED') return 'Changes were requested'
  if (data.reviewDecision === 'REVIEW_REQUIRED') return 'Awaiting an approving review'
  const required = pr.checks.filter((check) => check.required)
  if (required.some(failed)) return 'Some required checks are failing'
  if (required.some(running)) return 'Required checks are still running'
  if (
    data.pull.mergeable_state === 'blocked' ||
    ['BLOCKED', 'DRAFT'].includes(data.mergeStateStatus ?? '')
  )
    return 'Blocked by branch protection'
  if (
    data.mergeable === 'UNKNOWN' ||
    data.pull.mergeable_state === 'unknown' ||
    data.mergeStateStatus === 'UNKNOWN'
  )
    return 'Checking mergeability'
  return ''
}
export function ago(at: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000))
  return minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`
}
export function duration(c: PrCheck) {
  if (c.kind === 'status' || c.conclusion === 'skipped' || !c.startedAt) return ''
  const seconds = Math.floor(
    ((c.completedAt ? Date.parse(c.completedAt) : Date.now()) - Date.parse(c.startedAt)) / 1000
  )
  return seconds <= 0
    ? ''
    : seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
        : `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`
}
export function filePatch(f: PrFile, patch = f.patch) {
  const old = f.previousPath ?? f.path
  return (
    [
      `diff --git a/${old} b/${f.path}`,
      ...(f.status === 'added'
        ? ['new file mode 100644']
        : f.status === 'removed'
          ? ['deleted file mode 100644']
          : []),
      `--- ${f.status === 'added' ? '/dev/null' : `a/${old}`}`,
      `+++ ${f.status === 'removed' ? '/dev/null' : `b/${f.path}`}`,
      patch ?? '',
    ].join('\n') + '\n'
  )
}
// The last four actual hunk lines, with accurate excerpt line numbers and counts.
export function excerpt(t: PrThread) {
  const lines = t.diffHunk.split('\n').filter((line) => /^[ +-]/.test(line))
  if (!lines.length) return ''
  const selected = lines.slice(-4)
  const header = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(t.diffHunk)
  const preceding = lines.slice(0, -selected.length)
  const oldStart = Number(header?.[1] ?? 1) + preceding.filter((l) => !l.startsWith('+')).length
  const newStart = Number(header?.[2] ?? 1) + preceding.filter((l) => !l.startsWith('-')).length
  return `@@ -${oldStart},${selected.filter((l) => !l.startsWith('+')).length} +${newStart},${selected.filter((l) => !l.startsWith('-')).length} @@\n${selected.join('\n')}`
}

export function visibleLines(file: Pick<PrFile, 'status' | 'patch'>) {
  const lines = new Set<number>()
  let line = 0
  const removed = file.status === 'removed'
  for (const row of (file.patch ?? '').split('\n')) {
    const header = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(row)
    if (header) {
      line = Number(header[removed ? 1 : 2])
      continue
    }
    if (row.startsWith('\\') || (removed ? row.startsWith('+') : row.startsWith('-'))) continue
    if (row.startsWith(' ') || row.startsWith(removed ? '-' : '+')) lines.add(line++)
  }
  return lines
}

// owner/repo and repo, read from the PR's GitHub URL.
export const repoPath = (pr: { url: string }) =>
  new URL(pr.url).pathname.split('/').slice(1, 3).join('/')
export const repoName = (pr: { url: string }) => repoPath(pr).split('/')[1]
