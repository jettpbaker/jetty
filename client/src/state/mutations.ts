import type { Connection } from '@/net/connection'
import type { Project, ProjectIcon, ProviderId, ThreadMeta } from '@jetty/shared/wire'

import { Effect, Fiber } from 'effect'
import { Atom, type AtomRegistry } from 'effect/unstable/reactivity'

import { run, useAction } from './connection'

type Registry = AtomRegistry.AtomRegistry

export type ThreadPatch = {
  title?: string
  pinned?: boolean
  archived?: boolean
  provider?: ProviderId
  readyForReview?: boolean
}

function markThreadSeen(registry: Registry, threadId: string) {
  setPatch(registry, threadId, { readyForReview: false })
  run(registry, (connection) =>
    connection
      .request('thread.markSeen', { threadId })
      .pipe(Effect.ensuring(Effect.sync(() => clearPatch(registry, threadId, 'readyForReview'))))
  )
}

export const useMarkThreadSeen = () => useAction(markThreadSeen)

export const createdThreadsAtom = Atom.make<ReadonlyMap<string, ThreadMeta>>(new Map()).pipe(
  Atom.keepAlive
)
export const threadPatchesAtom = Atom.make<ReadonlyMap<string, ThreadPatch>>(new Map()).pipe(
  Atom.keepAlive
)
export const deletedThreadsAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive
)
export const projectIconPatchesAtom = Atom.make<ReadonlyMap<string, ProjectIcon | null>>(
  new Map()
).pipe(Atom.keepAlive)

export function without<V>(map: ReadonlyMap<string, V>, keys: readonly string[]) {
  if (!keys.some((key) => map.has(key))) return map
  const next = new Map(map)
  for (const key of keys) next.delete(key)
  return next
}

export function withoutId(set: ReadonlySet<string>, id: string) {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}

const creations = new Map<string, Fiber.Fiber<unknown, unknown>>()

// Resolves once the server knows the thread, so thread.subscribe never races thread.create.
export function awaitCreation(threadId: string) {
  const creation = creations.get(threadId)
  return creation ? Fiber.join(creation) : Effect.void
}

function createThread(registry: Registry, projectId: string) {
  const id = crypto.randomUUID()
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
  const creation = run(
    registry,
    (connection) => connection.request('thread.create', { id, projectId }),
    () => registry.update(createdThreadsAtom, (threads) => without(threads, [id]))
  )
  creations.set(id, creation)
  creation.addObserver(() => creations.delete(id))
  return id
}

export function setPatch(registry: Registry, threadId: string, patch: ThreadPatch) {
  registry.update(threadPatchesAtom, (patches) =>
    new Map(patches).set(threadId, { ...patches.get(threadId), ...patch })
  )
}

export function clearPatch(registry: Registry, threadId: string, key: keyof ThreadPatch) {
  registry.update(threadPatchesAtom, (patches) => {
    const current = patches.get(threadId)
    if (current?.[key] === undefined) return patches
    const patch = { ...current }
    delete patch[key]
    return Object.keys(patch).length === 0
      ? without(patches, [threadId])
      : new Map(patches).set(threadId, patch)
  })
}

function renameThread(registry: Registry, threadId: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) return
  setPatch(registry, threadId, { title: trimmed })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.rename', { threadId, title: trimmed }))
      ),
    () => clearPatch(registry, threadId, 'title')
  )
}

function pinThread(registry: Registry, threadId: string, pinned: boolean) {
  setPatch(registry, threadId, { pinned })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.pin', { threadId, pinned }))
      ),
    () => clearPatch(registry, threadId, 'pinned')
  )
}

// Hides the thread now; the server delete waits for `commit`, so `undo` can bring it back.
function deleteThread(registry: Registry, threadId: string) {
  registry.update(deletedThreadsAtom, (deleted) => new Set(deleted).add(threadId))
  const restore = () =>
    registry.update(deletedThreadsAtom, (deleted) => withoutId(deleted, threadId))
  let settled = false
  return {
    undo() {
      if (settled) return
      settled = true
      restore()
    },
    commit() {
      if (settled) return
      settled = true
      run(
        registry,
        (connection) =>
          awaitCreation(threadId).pipe(
            Effect.andThen(connection.request('thread.delete', { threadId }))
          ),
        restore
      )
    },
  }
}

// Sending to an archived thread brings it back first; the server won't queue on archived threads.
export function unarchiveFirst(
  registry: Registry,
  threadId: string,
  archived: boolean | undefined
): (connection: Connection) => Effect.Effect<unknown, unknown> {
  if (!archived) return () => Effect.void
  setPatch(registry, threadId, { archived: false })
  return (connection) =>
    connection
      .request('thread.archive', { threadId, archived: false })
      .pipe(Effect.onError(() => Effect.sync(() => clearPatch(registry, threadId, 'archived'))))
}

function archiveThread(registry: Registry, threadId: string, archived: boolean) {
  setPatch(registry, threadId, { archived })
  run(
    registry,
    (connection) => connection.request('thread.archive', { threadId, archived }),
    () => clearPatch(registry, threadId, 'archived')
  )
}

function createProject(registry: Registry, path: string, onCreated?: (project: Project) => void) {
  run(registry, (connection) =>
    connection
      .request('project.create', { path })
      .pipe(Effect.tap(({ project }) => Effect.sync(() => onCreated?.(project))))
  )
}

function setProjectIcon(registry: Registry, projectId: string, icon: ProjectIcon | null) {
  registry.update(projectIconPatchesAtom, (patches) => new Map(patches).set(projectId, icon))
  run(
    registry,
    (connection) => connection.request('project.setIcon', { projectId, icon }),
    () => registry.update(projectIconPatchesAtom, (patches) => without(patches, [projectId]))
  )
}

export function useSetProjectIcon() {
  return useAction(setProjectIcon)
}

export function useCreateProject() {
  return useAction(createProject)
}

export function useCreateThread() {
  return useAction(createThread)
}

export function useArchiveThread() {
  return useAction(archiveThread)
}

export function useRenameThread() {
  return useAction(renameThread)
}

export function usePinThread() {
  return useAction(pinThread)
}

export function useDeleteThread() {
  return useAction(deleteThread)
}
