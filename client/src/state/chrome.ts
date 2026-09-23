import type { ChromePushData, Project, ThreadMeta, Usage } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Stream } from 'effect'
import { AsyncResult, Atom } from 'effect/unstable/reactivity'

import { subscribe } from './connection'
import {
  archivedThreadsAtom,
  createdThreadsAtom,
  deletedThreadsAtom,
  threadPatchesAtom,
  type ThreadPatch,
} from './mutations'

export type Chrome = {
  projects: readonly Project[]
  threads: readonly ThreadMeta[]
  usage?: Usage
}

const emptyChrome: Chrome = { projects: [], threads: [] }

function upsert<T extends { id: string }>(list: readonly T[], item: T) {
  return list.some((entry) => entry.id === item.id)
    ? list.map((entry) => (entry.id === item.id ? item : entry))
    : [...list, item]
}

function foldChrome(chrome: Chrome, update: ChromePushData): Chrome {
  switch (update.type) {
    case 'snapshot':
      return { projects: update.projects, threads: update.threads, usage: update.usage }
    case 'project.upserted':
      return { ...chrome, projects: upsert(chrome.projects, update.project) }
    case 'thread.upserted':
      return { ...chrome, threads: upsert(chrome.threads, update.thread) }
    case 'thread.removed':
      return {
        ...chrome,
        threads: chrome.threads.filter((thread) => thread.id !== update.threadId),
      }
    case 'usage':
      return { ...chrome, usage: update.usage }
  }
}

const liveAtom = Atom.make((get) =>
  subscribe(get, (connection) => connection.subscribeChrome()).pipe(
    Stream.scan(emptyChrome, foldChrome),
    Stream.drop(1)
  )
).pipe(Atom.keepAlive)

function applyPatch(thread: ThreadMeta, patch: ThreadPatch | undefined) {
  if (!patch) return thread
  return {
    ...thread,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
  }
}

function withPending(
  chrome: Chrome,
  created: ReadonlyMap<string, ThreadMeta>,
  archived: ReadonlySet<string>,
  patches: ReadonlyMap<string, ThreadPatch>,
  deleted: ReadonlySet<string>
): Chrome {
  if (created.size === 0 && archived.size === 0 && patches.size === 0 && deleted.size === 0)
    return chrome
  const known = new Set(chrome.threads.map((thread) => thread.id))
  const threads = [
    ...chrome.threads,
    ...[...created.values()].filter((thread) => !known.has(thread.id)),
  ]
    .filter((thread) => !deleted.has(thread.id))
    .map((thread) =>
      applyPatch(
        archived.has(thread.id) ? { ...thread, archived: true } : thread,
        patches.get(thread.id)
      )
    )
  return { ...chrome, threads }
}

const chromeAtom = Atom.readable((get) => {
  const chrome = AsyncResult.getOrElse(get(liveAtom), () => undefined)
  return (
    chrome &&
    withPending(
      chrome,
      get(createdThreadsAtom),
      get(archivedThreadsAtom),
      get(threadPatchesAtom),
      get(deletedThreadsAtom)
    )
  )
})

export function useChrome(): Chrome | undefined {
  return useAtomValue(chromeAtom)
}
