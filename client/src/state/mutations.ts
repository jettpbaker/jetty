import type { Connection } from '@/net/connection'
import type { ThreadMeta } from '@jetty/shared/wire'

import { RegistryContext } from '@effect/atom-react'
import { Deferred, Effect, Exit } from 'effect'
import { Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

import { connectionAtom } from './connection'

export type ThreadPatch = { title?: string; pinned?: boolean }

export const createdThreadsAtom = Atom.make<ReadonlyMap<string, ThreadMeta>>(new Map()).pipe(
  Atom.keepAlive
)
export const archivedThreadsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive
)
export const threadPatchesAtom = Atom.make<ReadonlyMap<string, ThreadPatch>>(new Map()).pipe(
  Atom.keepAlive
)
export const deletedThreadsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive
)

const creations = new Map<string, Deferred.Deferred<void, unknown>>()

/** Resolves once the server knows the thread, so `thread.subscribe` never races `thread.create`. */
export function awaitCreation(threadId: string) {
  const creation = creations.get(threadId)
  return creation ? Deferred.await(creation) : Effect.void
}

function run<A, E>(
  registry: AtomRegistry.AtomRegistry,
  request: (connection: Connection) => Effect.Effect<A, E>,
  onExit: (exit: Exit.Exit<A, E>) => void
) {
  Effect.runFork(
    AtomRegistry.getResult(registry, connectionAtom).pipe(
      Effect.flatMap(request),
      Effect.onExit((exit) => Effect.sync(() => onExit(exit)))
    )
  )
}

function createThread(registry: AtomRegistry.AtomRegistry, projectId: string) {
  const id = crypto.randomUUID()
  const creation = Deferred.makeUnsafe<void, unknown>()
  creations.set(id, creation)
  registry.update(createdThreadsAtom, (threads) =>
    new Map(threads).set(id, {
      id,
      projectId,
      title: 'New thread',
      status: 'idle',
      archived: false,
      pinned: false,
      updatedAt: Date.now(),
    })
  )
  run(
    registry,
    (connection) => connection.request('thread.create', { id, projectId }),
    (exit) => {
      creations.delete(id)
      Deferred.doneUnsafe(creation, Exit.asVoid(exit))
      if (Exit.isSuccess(exit)) return
      registry.update(createdThreadsAtom, (threads) => {
        const next = new Map(threads)
        next.delete(id)
        return next
      })
    }
  )
  return id
}

function setPatch(registry: AtomRegistry.AtomRegistry, threadId: string, patch: ThreadPatch) {
  registry.update(threadPatchesAtom, (patches) => {
    const next = new Map(patches)
    next.set(threadId, { ...next.get(threadId), ...patch })
    return next
  })
}

function clearPatch(registry: AtomRegistry.AtomRegistry, threadId: string, key: keyof ThreadPatch) {
  registry.update(threadPatchesAtom, (patches) => {
    const current = patches.get(threadId)
    if (!current || current[key] === undefined) return patches
    const nextPatch = { ...current }
    delete nextPatch[key]
    const next = new Map(patches)
    if (nextPatch.title === undefined && nextPatch.pinned === undefined) next.delete(threadId)
    else next.set(threadId, nextPatch)
    return next
  })
}

function renameThread(registry: AtomRegistry.AtomRegistry, threadId: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) return
  setPatch(registry, threadId, { title: trimmed })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.rename', { threadId, title: trimmed }))
      ),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      clearPatch(registry, threadId, 'title')
    }
  )
}

function pinThread(registry: AtomRegistry.AtomRegistry, threadId: string, pinned: boolean) {
  setPatch(registry, threadId, { pinned })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.pin', { threadId, pinned }))
      ),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      clearPatch(registry, threadId, 'pinned')
    }
  )
}

function deleteThread(registry: AtomRegistry.AtomRegistry, threadId: string) {
  registry.update(deletedThreadsAtom, (deleted) => new Set(deleted).add(threadId))
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.delete', { threadId }))
      ),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      registry.update(deletedThreadsAtom, (deleted) => {
        const next = new Set(deleted)
        next.delete(threadId)
        return next
      })
    }
  )
}

function archiveThread(registry: AtomRegistry.AtomRegistry, threadId: string) {
  registry.update(archivedThreadsAtom, (archived) => new Set(archived).add(threadId))
  run(
    registry,
    (connection) => connection.request('thread.archive', { threadId }),
    (exit) => {
      if (Exit.isSuccess(exit)) return
      registry.update(archivedThreadsAtom, (archived) => {
        const next = new Set(archived)
        next.delete(threadId)
        return next
      })
    }
  )
}

/** Returns the new thread's id immediately; the server call runs in the background. */
export function useCreateThread() {
  const registry = useContext(RegistryContext)
  return useCallback((projectId: string) => createThread(registry, projectId), [registry])
}

export function useArchiveThread() {
  const registry = useContext(RegistryContext)
  return useCallback((threadId: string) => archiveThread(registry, threadId), [registry])
}

export function useRenameThread() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, title: string) => renameThread(registry, threadId, title),
    [registry]
  )
}

export function usePinThread() {
  const registry = useContext(RegistryContext)
  return useCallback(
    (threadId: string, pinned: boolean) => pinThread(registry, threadId, pinned),
    [registry]
  )
}

export function useDeleteThread() {
  const registry = useContext(RegistryContext)
  return useCallback((threadId: string) => deleteThread(registry, threadId), [registry])
}
