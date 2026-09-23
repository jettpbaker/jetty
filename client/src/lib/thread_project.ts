import type { Chrome } from '@/state'

export function newThreadProject(chrome: Chrome, selectedId: string | undefined) {
  const threads = chrome.threads.filter((thread) => !thread.archived)
  const thread =
    threads.find((candidate) => candidate.id === selectedId) ??
    threads.toSorted((a, b) => b.updatedAt - a.updatedAt)[0]
  return thread?.projectId ?? chrome.projects[0]?.id
}
