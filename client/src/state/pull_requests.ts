import type { PullRequestLink, PullRequestSnapshot } from '@jetty/shared/wire'

import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { useNavigate } from '@tanstack/react-router'
import { Effect, Stream } from 'effect'
import { AsyncResult, Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useMemo } from 'react'

import { useChrome } from './chrome'
import { connectionAtom, run, subscribe, useAction } from './connection'

type Registry = AtomRegistry.AtomRegistry
export type PullRequestRef = { repo: string; number: number }

export function pullRequestKey(ref: PullRequestRef) {
  return `${ref.repo}#${ref.number}`
}

function parseKey(key: string): PullRequestRef {
  const split = key.lastIndexOf('#')
  return { repo: key.slice(0, split), number: Number(key.slice(split + 1)) }
}

const cacheAtom = Atom.family((_key: string) =>
  Atom.make<PullRequestSnapshot | undefined>(undefined).pipe(Atom.setIdleTTL('30 minutes'))
)

// Mounted only while a PR view is on screen; the server re-checks GitHub while subscribed.
const liveAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const { repo, number } = parseKey(key)
    return subscribe(get, (connection) => connection.subscribePullRequest(repo, number)).pipe(
      Stream.tap((snapshot) => Effect.sync(() => get.set(cacheAtom(key), snapshot)))
    )
  }).pipe(Atom.setIdleTTL('5 seconds'))
)

const snapshotAtom = Atom.family((key: string) =>
  Atom.readable((get) => {
    const cached = get(cacheAtom(key))
    return AsyncResult.getOrElse(get(liveAtom(key)), () => cached)
  })
)

const refreshingAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive)

export function usePullRequest(ref: PullRequestRef) {
  const key = pullRequestKey(ref)
  const snapshot = useAtomValue(snapshotAtom(key))
  const refreshing = useAtomValue(refreshingAtom).has(key)
  return { snapshot, refreshing }
}

function setRefreshing(registry: Registry, key: string, on: boolean) {
  registry.update(refreshingAtom, (keys) => {
    const next = new Set(keys)
    if (on) next.add(key)
    else next.delete(key)
    return next
  })
}

function refreshPullRequest(registry: Registry, ref: PullRequestRef) {
  const key = pullRequestKey(ref)
  if (registry.get(refreshingAtom).has(key)) return
  setRefreshing(registry, key, true)
  run(registry, (connection) =>
    connection.request('pullRequest.refresh', ref).pipe(
      Effect.tap((snapshot) => Effect.sync(() => registry.set(cacheAtom(key), snapshot))),
      Effect.ensuring(Effect.sync(() => setRefreshing(registry, key, false)))
    )
  )
}

export function useRefreshPullRequest() {
  return useAction(refreshPullRequest)
}

// Which PR tabs a thread's details pane shows. The newest link shows until it's closed;
// anything opened from the menu or a PR indicator stays.
type PullRequestTabs = { opened: readonly string[]; closed: readonly string[] }

const pullRequestTabsAtom = Atom.family((_threadId: string) =>
  Atom.make<PullRequestTabs>({ opened: [], closed: [] }).pipe(Atom.keepAlive)
)

export function pullRequestTabId(ref: PullRequestRef) {
  return `pr:${pullRequestKey(ref)}`
}

function showTab(registry: Registry, threadId: string, key: string) {
  registry.update(pullRequestTabsAtom(threadId), ({ opened, closed }) => ({
    opened: opened.includes(key) ? opened : [...opened, key],
    closed: closed.filter((entry) => entry !== key),
  }))
}

function hideTab(registry: Registry, threadId: string, key: string) {
  registry.update(pullRequestTabsAtom(threadId), ({ opened, closed }) => ({
    opened: opened.filter((entry) => entry !== key),
    closed: closed.includes(key) ? closed : [...closed, key],
  }))
}

const noLinks: readonly PullRequestLink[] = []

function sortedLinks(links: readonly PullRequestLink[] = noLinks) {
  return links.toSorted((a, b) => a.linkedAt - b.linkedAt)
}

export function useThreadPullRequests(threadId: string) {
  const links = useChrome()?.threads.find((entry) => entry.id === threadId)?.pullRequests
  return useMemo(() => sortedLinks(links), [links])
}

export function usePullRequestTabs(threadId: string, links: readonly PullRequestLink[]) {
  const registry = useContext(RegistryContext)
  const { opened, closed } = useAtomValue(pullRequestTabsAtom(threadId))
  const visible = useMemo(() => {
    const newest = links.at(-1)
    return links.filter((link) => {
      const key = pullRequestKey(link)
      return opened.includes(key) || (link === newest && !closed.includes(key))
    })
  }, [links, opened, closed])
  const show = useCallback(
    (ref: PullRequestRef) => showTab(registry, threadId, pullRequestKey(ref)),
    [registry, threadId]
  )
  const hide = useCallback(
    (ref: PullRequestRef) => hideTab(registry, threadId, pullRequestKey(ref)),
    [registry, threadId]
  )
  return { visible, show, hide }
}

// Asks a thread's details pane to open on a tab; the pane consumes it once mounted.
type DetailsRequest = { threadId: string; tab: string }

const detailsRequestAtom = Atom.make<DetailsRequest | undefined>(undefined).pipe(Atom.keepAlive)

export function useDetailsRequest(threadId: string) {
  const registry = useContext(RegistryContext)
  const request = useAtomValue(detailsRequestAtom)
  const consume = useCallback(() => registry.set(detailsRequestAtom, undefined), [registry])
  return { tab: request?.threadId === threadId ? request.tab : undefined, consume }
}

function openPullRequest(registry: Registry, threadId: string, ref: PullRequestRef) {
  showTab(registry, threadId, pullRequestKey(ref))
  registry.set(detailsRequestAtom, { threadId, tab: pullRequestTabId(ref) })
}

export function useOpenPullRequest() {
  const registry = useContext(RegistryContext)
  const navigate = useNavigate()
  return useCallback(
    (threadId: string, ref: PullRequestRef) => {
      openPullRequest(registry, threadId, ref)
      void navigate({ to: '/threads/$threadId', params: { threadId } })
    },
    [registry, navigate]
  )
}

function linkedRef(
  links: readonly PullRequestLink[],
  reference: string
): PullRequestLink | undefined {
  const url = reference.match(/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i)
  if (url) {
    const repo = url[1]!.toLowerCase()
    const number = Number(url[2])
    return links.find((link) => link.repo === repo && link.number === number)
  }
  const number = Number(reference.trim().replace(/^#/, ''))
  return links.filter((link) => link.number === number).at(-1)
}

export function useLinkPullRequest() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, reference: string): Promise<string | undefined> =>
      Effect.runPromise(
        AtomRegistry.getResult(registry, connectionAtom).pipe(
          Effect.flatMap((connection) =>
            connection.request('pullRequest.link', { threadId, reference })
          ),
          Effect.match({
            onFailure: (error) =>
              'message' in error && typeof error.message === 'string'
                ? error.message
                : "Couldn't link the pull request",
            onSuccess: ({ thread }) => {
              const link = linkedRef(sortedLinks(thread.pullRequests), reference)
              if (link) openPullRequest(registry, threadId, link)
              return undefined
            },
          })
        )
      ),
    [registry]
  )
}

function unlinkPullRequest(registry: Registry, threadId: string, link: PullRequestLink) {
  hideTab(registry, threadId, pullRequestKey(link))
  run(registry, (connection) =>
    connection.request('pullRequest.unlink', { threadId, reference: link.url })
  )
}

export function useUnlinkPullRequest() {
  return useAction(unlinkPullRequest)
}
