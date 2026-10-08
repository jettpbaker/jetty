import type {
  AgentBehaviours,
  Bot,
  ChromePushData,
  ModelDiscovery,
  ProviderCapabilities,
  TitleModel,
  Project,
  ProjectIcon,
  ProviderId,
  ProviderModel,
  PullRequestLink,
  ThreadMeta,
} from '@jetty/shared/wire'

import { observeServerTime } from '@/lib/server_time'
import { newThreadProject } from '@/lib/thread_project'
import { useAtomValue } from '@effect/atom-react'
import { Equal, Stream } from 'effect'
import { AsyncResult, Atom, type AtomRegistry } from 'effect/reactivity'

import { subscribe, useAction } from './connection'

export type ThreadPatch = {
  title?: string
  pinned?: boolean
  archived?: boolean
  provider?: ProviderId
  readyForReview?: boolean
  // false surfaces a quiet thread at once, before the server agrees.
  quiet?: boolean
}

export const createdThreadsAtom = Atom.make<ReadonlyMap<string, ThreadMeta>>(new Map()).pipe(
  Atom.keepAlive
)
export const threadPatchesAtom = Atom.make<ReadonlyMap<string, ThreadPatch>>(new Map()).pipe(
  Atom.keepAlive
)
export const deletedThreadsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive
)
export const deletedProjectsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive
)
export const projectIconPatchesAtom = Atom.make<ReadonlyMap<string, ProjectIcon | null>>(
  new Map()
).pipe(Atom.keepAlive)
export const projectTitlePatchesAtom = Atom.make<ReadonlyMap<string, string>>(new Map()).pipe(
  Atom.keepAlive
)

export type Chrome = {
  projects: readonly Project[]
  threads: readonly ThreadMeta[]
  models?: readonly ProviderModel[]
  modelDiscovery?: ModelDiscovery
  providerCapabilities?: ProviderCapabilities
  branchPrefix?: string
  defaultEnvironment?: ThreadMeta['environment']
  titleModel?: TitleModel
  agentBehaviours?: AgentBehaviours
  bots: readonly Bot[]
}

const emptyChrome: Chrome = { projects: [], threads: [], bots: [] }

function upsert<T extends { id: string }>(list: readonly T[], item: T) {
  return list.some((entry) => entry.id === item.id)
    ? list.map((entry) => (entry.id === item.id ? item : entry))
    : [...list, item]
}

function foldChrome(chrome: Chrome, update: ChromePushData): Chrome {
  switch (update.type) {
    case 'snapshot':
      observeServerTime(update.serverTime)
      return {
        projects: update.projects,
        threads: update.threads,
        models: update.models,
        modelDiscovery: update.modelDiscovery,
        providerCapabilities: update.providerCapabilities,
        branchPrefix: update.branchPrefix,
        defaultEnvironment: update.defaultEnvironment,
        titleModel: update.titleModel,
        agentBehaviours: update.agentBehaviours,
        bots: update.bots ?? [],
      }
    case 'bot.upserted':
      return { ...chrome, bots: upsert(chrome.bots, update.bot) }
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
    case 'models':
      return { ...chrome, models: update.models }
    case 'modelDiscovery':
      return { ...chrome, modelDiscovery: update.status }
    case 'branchPrefix':
      return { ...chrome, branchPrefix: update.prefix }
    case 'defaultEnvironment':
      return { ...chrome, defaultEnvironment: update.environment }
    case 'titleModel':
      return { ...chrome, titleModel: { model: update.model, effort: update.effort } }
    case 'agentBehaviours':
      return { ...chrome, agentBehaviours: update.behaviours }
  }
}

// The server's own view, before this tab's pending changes.
export const liveAtom = Atom.make((get) =>
  subscribe(get, (connection) => connection.subscribeChrome()).pipe(
    Stream.scan(() => emptyChrome, foldChrome),
    Stream.drop(1)
  )
).pipe(Atom.keepAlive)

export function serverChrome(registry: AtomRegistry.AtomRegistry) {
  return AsyncResult.getOrElse(registry.get(liveAtom), () => undefined)
}

// A thread and the threads it created, all the way down: archive and delete take them together.
export function threadTreeIds(threads: readonly ThreadMeta[], threadId: string) {
  const ids = [threadId]
  for (let index = 0; index < ids.length; index++)
    for (const thread of threads) if (thread.parentThreadId === ids[index]) ids.push(thread.id)
  return ids
}

function withPending(
  chrome: Chrome,
  created: ReadonlyMap<string, ThreadMeta>,
  patches: ReadonlyMap<string, ThreadPatch>,
  deleted: ReadonlySet<string>,
  icons: ReadonlyMap<string, ProjectIcon | null>,
  titles: ReadonlyMap<string, string>,
  deletedProjects: ReadonlySet<string>
): Chrome {
  if (
    created.size === 0 &&
    patches.size === 0 &&
    deleted.size === 0 &&
    icons.size === 0 &&
    titles.size === 0 &&
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
    .map((project) => {
      const title = titles.get(project.id)
      if (!icons.has(project.id) && title === undefined) return project
      return {
        ...project,
        ...(icons.has(project.id) ? { icon: icons.get(project.id) ?? undefined } : {}),
        ...(title !== undefined ? { title } : {}),
      }
    })
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
      get(projectTitlePatchesAtom),
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

export function useModels() {
  return useAtomValue(modelsAtom)
}

function readChrome(registry: AtomRegistry.AtomRegistry) {
  return registry.get(chromeAtom)
}

// Chrome as it is when called, for handlers that shouldn't re-render on every push.
export function useReadChrome() {
  return useAction(readChrome)
}

const threadsByIdAtom = Atom.readable(
  (get) => new Map(get(chromeAtom)?.threads.map((thread) => [thread.id, thread]))
)

// One thread's metadata, by value: a push for any other thread leaves its readers alone.
export const threadMetaAtom = Atom.family((threadId: string) =>
  Atom.readable((get) => get(threadsByIdAtom).get(threadId)).pipe(Atom.withEquality(Equal.equals))
)

export function useThreadMeta(threadId: string | undefined) {
  return useAtomValue(threadMetaAtom(threadId ?? ''))
}

const projectsAtom = Atom.readable((get) => get(chromeAtom)?.projects).pipe(
  Atom.withEquality(Equal.equals)
)

export function useProjects() {
  return useAtomValue(projectsAtom)
}

export const projectAtom = Atom.family((projectId: string) =>
  Atom.readable((get) => get(projectsAtom)?.find((project) => project.id === projectId))
)

export function useProject(projectId: string | undefined) {
  return useAtomValue(projectAtom(projectId ?? ''))
}

const providerCapabilitiesAtom = Atom.readable((get) => get(chromeAtom)?.providerCapabilities)

export function useProviderCapabilities() {
  return useAtomValue(providerCapabilitiesAtom)
}

const chromeReadyAtom = Atom.readable((get) => get(chromeAtom) !== undefined)

export function useChromeReady() {
  return useAtomValue(chromeReadyAtom)
}

const noThreads: readonly ThreadMeta[] = []

const childThreadsAtom = Atom.family((parentId: string) =>
  Atom.readable(
    (get) =>
      get(chromeAtom)?.threads.filter((thread) => thread.parentThreadId === parentId) ?? noThreads
  ).pipe(Atom.withEquality(Equal.equals))
)

export function useChildThreadMetas(parentId: string) {
  return useAtomValue(childThreadsAtom(parentId))
}

// The threads working for a bot, however far below its chat, newest activity first.
const botThreadsAtom = Atom.family((botId: string) =>
  Atom.readable(
    (get) =>
      get(chromeAtom)
        ?.threads.filter((thread) => thread.botId === botId && !thread.archived)
        .toSorted((a, b) => b.updatedAt - a.updatedAt) ?? noThreads
  ).pipe(Atom.withEquality(Equal.equals))
)

export function useBotThreadMetas(botId: string) {
  return useAtomValue(botThreadsAtom(botId))
}

const quietThreadIdsAtom = Atom.readable((get) =>
  (get(chromeAtom)?.threads ?? noThreads).flatMap((thread) => (thread.quiet ? [thread.id] : []))
).pipe(Atom.withEquality(Equal.equals))

export function useQuietThreadIds() {
  return useAtomValue(quietThreadIdsAtom)
}

// Each linked PR by repo#number (the first thread's link to it), and each project's PR repos.
const pullLinksAtom = Atom.readable((get) => {
  const pulls = new Map<string, PullRequestLink>()
  const repos = new Map<string, Set<string>>()
  for (const thread of get(chromeAtom)?.threads ?? [])
    for (const link of thread.pullRequests ?? []) {
      const key = `${link.repo}#${link.number}`
      if (!pulls.has(key)) pulls.set(key, link)
      repos.set(thread.projectId, (repos.get(thread.projectId) ?? new Set()).add(link.repo))
    }
  return { pulls, repos }
})

const linkedPullAtom = Atom.family((key: string) =>
  Atom.readable((get) => get(pullLinksAtom).pulls.get(key)).pipe(Atom.withEquality(Equal.equals))
)

export function useLinkedPull(repo: string, number: number) {
  return useAtomValue(linkedPullAtom(`${repo}#${number}`))
}

const noRepos: ReadonlySet<string> = new Set()

const projectReposAtom = Atom.family((projectId: string) =>
  Atom.readable((get) => get(pullLinksAtom).repos.get(projectId) ?? noRepos).pipe(
    Atom.withEquality(Equal.equals)
  )
)

export function useProjectRepos(projectId: string | undefined) {
  return useAtomValue(projectReposAtom(projectId ?? ''))
}

const newThreadProjectAtom = Atom.family((selectedId: string) =>
  Atom.readable((get) => {
    const chrome = get(chromeAtom)
    return chrome && newThreadProject(chrome, selectedId || undefined)
  })
)
const noProjectAtom = Atom.make<string | undefined>(undefined)

// The project a new thread starts in when none is picked; only worked out while `wanted`.
export function useNewThreadProject(wanted: boolean, selectedId: string | undefined) {
  return useAtomValue(wanted ? newThreadProjectAtom(selectedId ?? '') : noProjectAtom)
}
