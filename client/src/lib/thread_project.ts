import type { Chrome } from '@/state'

export function newThreadProject(chrome: Chrome, selectedId: string | undefined) {
  const threads = chrome.threads.filter((thread) => !thread.archived)
  const selected = threads.find((thread) => thread.id === selectedId)
  const recent = threads.reduce<(typeof threads)[number] | undefined>(
    (latest, thread) => (!latest || thread.updatedAt > latest.updatedAt ? thread : latest),
    undefined
  )
  return (selected ?? recent)?.projectId ?? chrome.projects[0]?.id
}
