import type { Project, ThreadMeta } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Equal } from 'effect'
import { Atom } from 'effect/reactivity'

import { botsAtom } from './bots'
import { chromeAtom, projectAtom, threadMetaAtom } from './chrome'

export type SidebarRow = { thread: ThreadMeta; project?: Project }

// A row's inputs, by value: a push for one thread re-renders only its row.
const rowAtom = Atom.family((threadId: string) =>
  Atom.readable((get): SidebarRow | undefined => {
    const thread = get(threadMetaAtom(threadId))
    return thread && { thread, project: get(projectAtom(thread.projectId)) }
  }).pipe(Atom.withEquality(Equal.equals))
)

export function useSidebarRow(threadId: string) {
  return useAtomValue(rowAtom(threadId))
}

// What the list orders and groups by, by value: a push that streams into a thread leaves the
// list alone. Date groups read updatedAt by the day, and every push moves it.
const listAtom = Atom.readable((get) => {
  const chrome = get(chromeAtom)
  return (
    chrome && {
      projects: chrome.projects,
      // In the Bots section's order; a face changing leaves the list alone.
      bots: get(botsAtom).map((bot) => ({ id: bot.id, name: bot.name })),
      threads: chrome.threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        projectId: thread.projectId,
        status: thread.status,
        readyForReview: thread.readyForReview,
        updatedDay: new Date(thread.updatedAt).setHours(0, 0, 0, 0),
        // The last turn start, so streaming never reshuffles the list.
        lastStartedAt: thread.turnStartedAt ?? thread.updatedAt,
        pinned: thread.pinned,
        archived: thread.archived,
        botId: thread.botId,
        quiet: thread.quiet === true,
      })),
    }
  )
}).pipe(Atom.withEquality(Equal.equals))

export type SidebarList = NonNullable<Atom.Type<typeof listAtom>>

export function useSidebarList() {
  return useAtomValue(listAtom)
}
