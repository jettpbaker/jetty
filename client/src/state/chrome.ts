import type { ChromePushData, Project, ThreadMeta, Usage } from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Stream } from 'effect'
import { AsyncResult, Atom } from 'effect/unstable/reactivity'

import { subscribe } from './connection'

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

const chromeAtom = Atom.readable((get) => AsyncResult.getOrElse(get(liveAtom), () => undefined))

export function useChrome(): Chrome | undefined {
  return useAtomValue(chromeAtom)
}
