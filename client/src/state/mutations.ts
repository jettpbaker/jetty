import type { Connection } from '@/net/connection'
import type { Project, ProjectIcon } from '@jetty/shared/wire'

import { Effect, Fiber } from 'effect'
import { type AtomRegistry } from 'effect/reactivity'
import { toast } from 'sonner'

import {
  chromeAtom,
  createdThreadsAtom,
  deletedProjectsAtom,
  deletedThreadsAtom,
  liveAtom,
  projectIconPatchesAtom,
  serverChrome,
  threadPatchesAtom,
  threadTreeIds,
  type ThreadPatch,
} from './chrome'
import { run, useAction } from './connection'

type Registry = AtomRegistry.AtomRegistry

function markThreadSeen(registry: Registry, threadId: string) {
  setPatch(registry, threadId, { readyForReview: false })
  run(registry, (connection) =>
    connection
      .request('thread.markSeen', { threadId })
      .pipe(Effect.ensuring(Effect.sync(() => clearPatch(registry, threadId, 'readyForReview'))))
  )
}

export const useMarkThreadSeen = () => useAction(markThreadSeen)

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

function createThread(
  registry: Registry,
  projectId: string,
  environment: 'local' | 'worktree' = 'worktree',
  ref?: string
) {
  const id = crypto.randomUUID()
  registry.update(createdThreadsAtom, (threads) =>
    new Map(threads).set(id, {
      id,
      projectId,
      environment,
      // Known before the server answers, so the chat reads "Setting up worktree" from the first frame.
      ...(environment === 'worktree' && {
        worktree: { state: 'pending', error: null, branch: null },
      }),
      title: 'New thread',
      status: 'idle',
      archived: false,
      pinned: false,
      updatedAt: Date.now(),
    })
  )
  const forget = () => registry.update(createdThreadsAtom, (threads) => without(threads, [id]))
  const creation = run(
    registry,
    (connection) =>
      connection
        .request('thread.create', {
          id,
          projectId,
          environment,
          ref,
        })
        .pipe(
          // Once the server lists it, a later delete (from any tab) must not bring this back.
          Effect.tap(() =>
            Effect.sync(() =>
              settleWhen(
                registry,
                () => !!serverChrome(registry)?.threads.some((thread) => thread.id === id),
                forget
              )
            )
          ),
          Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
        ),
    forget
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

// With `value`, only a patch still holding it clears, so a newer toggle survives an older reply.
export function clearPatch<K extends keyof ThreadPatch>(
  registry: Registry,
  threadId: string,
  key: K,
  value?: ThreadPatch[K]
) {
  registry.update(threadPatchesAtom, (patches) => {
    const current = patches.get(threadId)
    if (current?.[key] === undefined) return patches
    if (value !== undefined && current[key] !== value) return patches
    const patch = { ...current }
    delete patch[key]
    return Object.keys(patch).length === 0
      ? without(patches, [threadId])
      : new Map(patches).set(threadId, patch)
  })
}

// After the server accepts a change, its push (which lands just after the reply) takes over from
// the patch, so a later change by an agent or another tab shows instead of the stale patch.
function settleWhen(registry: Registry, agrees: () => boolean, clear: () => void) {
  function check() {
    if (!agrees()) return
    stop()
    clearTimeout(timeout)
    clear()
  }
  const stop = registry.subscribe(liveAtom, check)
  const timeout = setTimeout(() => {
    stop()
    clear()
  }, 10_000)
  check()
}

export function settlePatch<K extends keyof ThreadPatch>(
  registry: Registry,
  threadId: string,
  key: K,
  value: ThreadPatch[K]
) {
  settleWhen(
    registry,
    () => {
      const thread = serverChrome(registry)?.threads.find((entry) => entry.id === threadId)
      return !thread || thread[key] === value
    },
    () => clearPatch(registry, threadId, key, value)
  )
}

function renameThread(registry: Registry, threadId: string, title: string) {
  const trimmed = title.trim()
  if (!trimmed) return
  setPatch(registry, threadId, { title: trimmed })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.rename', { threadId, title: trimmed })),
        Effect.tap(() => Effect.sync(() => settlePatch(registry, threadId, 'title', trimmed)))
      ),
    () => clearPatch(registry, threadId, 'title', trimmed)
  )
}

function pinThread(registry: Registry, threadId: string, pinned: boolean) {
  setPatch(registry, threadId, { pinned })
  run(
    registry,
    (connection) =>
      awaitCreation(threadId).pipe(
        Effect.andThen(connection.request('thread.pin', { threadId, pinned })),
        Effect.tap(() => Effect.sync(() => settlePatch(registry, threadId, 'pinned', pinned)))
      ),
    () => clearPatch(registry, threadId, 'pinned', pinned)
  )
}

// Deletions still inside their undo window; leaving the page ends the window.
const pendingDeletions = new Set<() => void>()
addEventListener('pagehide', () => {
  for (const commit of pendingDeletions) commit()
})

// Hides the thread now; the server delete waits for `commit`, so `undo` can bring it back.
function deleteThread(registry: Registry, threadId: string) {
  const tree = threadTreeIds(registry.get(chromeAtom)?.threads ?? [], threadId)
  registry.update(deletedThreadsAtom, (deleted) => new Set([...deleted, ...tree]))
  const restore = () =>
    registry.update(deletedThreadsAtom, (deleted) => {
      const next = new Set(deleted)
      for (const id of tree) next.delete(id)
      return next
    })
  let settled = false
  const deletion = {
    undo() {
      if (settled) return
      settled = true
      pendingDeletions.delete(deletion.commit)
      restore()
    },
    commit() {
      if (settled) return
      settled = true
      pendingDeletions.delete(deletion.commit)
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
  pendingDeletions.add(deletion.commit)
  return deletion
}

// Like a thread delete: hidden at once, removed on the server (threads included) on `commit`.
function deleteProject(registry: Registry, projectId: string) {
  registry.update(deletedProjectsAtom, (deleted) => new Set(deleted).add(projectId))
  const restore = () =>
    registry.update(deletedProjectsAtom, (deleted) => withoutId(deleted, projectId))
  let settled = false
  const deletion = {
    undo() {
      if (settled) return
      settled = true
      pendingDeletions.delete(deletion.commit)
      restore()
    },
    commit() {
      if (settled) return
      settled = true
      pendingDeletions.delete(deletion.commit)
      run(
        registry,
        (connection) =>
          connection
            .request('project.delete', { projectId })
            .pipe(Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))),
        restore
      )
    },
  }
  pendingDeletions.add(deletion.commit)
  return deletion
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
    connection.request('thread.archive', { threadId, archived: false }).pipe(
      Effect.tap(() => Effect.sync(() => settlePatch(registry, threadId, 'archived', false))),
      Effect.onError(() => Effect.sync(() => clearPatch(registry, threadId, 'archived', false)))
    )
}

// Archiving takes the thread's children along; unarchiving brings back whatever went with it, which
// only the server knows, so that waits for its push.
function archiveThread(registry: Registry, threadId: string, archived: boolean) {
  const threads = registry.get(chromeAtom)?.threads ?? []
  const ids = archived
    ? threadTreeIds(threads, threadId).filter(
        (id) => id === threadId || !threads.find((thread) => thread.id === id)?.archived
      )
    : [threadId]
  for (const id of ids) setPatch(registry, id, { archived })
  run(
    registry,
    (connection) =>
      connection.request('thread.archive', { threadId, archived }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            for (const id of ids) settlePatch(registry, id, 'archived', archived)
          })
        ),
        Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))
      ),
    () => {
      for (const id of ids) clearPatch(registry, id, 'archived', archived)
    }
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
  const clear = () =>
    registry.update(projectIconPatchesAtom, (patches) =>
      patches.get(projectId) === icon ? without(patches, [projectId]) : patches
    )
  run(
    registry,
    (connection) =>
      connection.request('project.setIcon', { projectId, icon }).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            settleWhen(
              registry,
              () => {
                const project = serverChrome(registry)?.projects.find(
                  (entry) => entry.id === projectId
                )
                return !project || JSON.stringify(project.icon ?? null) === JSON.stringify(icon)
              },
              clear
            )
          )
        )
      ),
    clear
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

export function useDeleteProject() {
  return useAction(deleteProject)
}

export function useDeleteThread() {
  return useAction(deleteThread)
}
