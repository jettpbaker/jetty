import type {
  AgentBehaviours,
  ChromePushData,
  ModelDiscovery,
  TitleModel,
  Project,
  ProjectIcon,
  ProviderModel,
  ThreadMeta,
  RateLimits,
} from '@jetty/shared/wire'

import { useAtomValue } from '@effect/atom-react'
import { Stream } from 'effect'
import { AsyncResult, Atom } from 'effect/unstable/reactivity'

import { subscribe } from './connection'
import {
  createdThreadsAtom,
  deletedProjectsAtom,
  deletedThreadsAtom,
  projectIconPatchesAtom,
  threadPatchesAtom,
  type ThreadPatch,
} from './mutations'

export type Chrome = {
  projects: readonly Project[]
  threads: readonly ThreadMeta[]
  usage?: RateLimits
  models?: readonly ProviderModel[]
  modelDiscovery?: ModelDiscovery
  branchPrefix?: string
  titleModel?: TitleModel
  agentBehaviours?: AgentBehaviours
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
      return {
        projects: update.projects,
        threads: update.threads,
        usage: update.usage,
        models: update.models,
        modelDiscovery: update.modelDiscovery,
        branchPrefix: update.branchPrefix,
        titleModel: update.titleModel,
        agentBehaviours: update.agentBehaviours,
      }
    case 'project.upserted':
      return { ...chrome, projects: upsert(chrome.projects, update.project) }
    case 'thread.upserted':
      return { ...chrome, threads: upsert(chrome.threads, update.thread) }
    case 'project.removed':
      return {
        ...chrome,
        projects: chrome.projects.filter((project) => project.id !== update.projectId),
        threads: chrome.threads.filter((thread) => thread.projectId !== update.projectId),
      }
    case 'thread.removed':
      return {
        ...chrome,
        threads: chrome.threads.filter((thread) => thread.id !== update.threadId),
      }
    case 'usage':
      return { ...chrome, usage: update.usage }
    case 'models':
      return { ...chrome, models: update.models }
    case 'modelDiscovery':
      return { ...chrome, modelDiscovery: update.status }
    case 'branchPrefix':
      return { ...chrome, branchPrefix: update.prefix }
    case 'titleModel':
      return { ...chrome, titleModel: { model: update.model, effort: update.effort } }
    case 'agentBehaviours':
      return { ...chrome, agentBehaviours: update.behaviours }
  }
}

const liveAtom = Atom.make((get) =>
  subscribe(get, (connection) => connection.subscribeChrome()).pipe(
    Stream.scan(emptyChrome, foldChrome),
    Stream.drop(1)
  )
).pipe(Atom.keepAlive)

function withPending(
  chrome: Chrome,
  created: ReadonlyMap<string, ThreadMeta>,
  patches: ReadonlyMap<string, ThreadPatch>,
  deleted: ReadonlySet<string>,
  icons: ReadonlyMap<string, ProjectIcon | null>,
  deletedProjects: ReadonlySet<string>
): Chrome {
  if (
    created.size === 0 &&
    patches.size === 0 &&
    deleted.size === 0 &&
    icons.size === 0 &&
    deletedProjects.size === 0
  )
    return chrome
  const known = new Set(chrome.threads.map((thread) => thread.id))
  const threads = [
    ...chrome.threads,
    ...[...created.values()].filter((thread) => !known.has(thread.id)),
  ]
    .filter((thread) => !deleted.has(thread.id) && !deletedProjects.has(thread.projectId))
    .map((thread) => {
      const patch = patches.get(thread.id)
      return patch ? { ...thread, ...patch } : thread
    })
  const projects = chrome.projects
    .filter((project) => !deletedProjects.has(project.id))
    .map((project) =>
      icons.has(project.id) ? { ...project, icon: icons.get(project.id) ?? undefined } : project
    )
  return { ...chrome, projects, threads }
}

export const chromeAtom = Atom.readable((get) => {
  const chrome = AsyncResult.getOrElse(get(liveAtom), () => undefined)
  return (
    chrome &&
    withPending(
      chrome,
      get(createdThreadsAtom),
      get(threadPatchesAtom),
      get(deletedThreadsAtom),
      get(projectIconPatchesAtom),
      get(deletedProjectsAtom)
    )
  )
})

const noModels: readonly ProviderModel[] = []

export const modelsAtom = Atom.readable(
  (get) => AsyncResult.getOrElse(get(liveAtom), () => undefined)?.models ?? noModels
)

export function useChrome(): Chrome | undefined {
  return useAtomValue(chromeAtom)
}
