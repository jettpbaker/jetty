import { newId } from '@jetty/shared/wire'

export type Draft = {
  id: string
  /** null until the user picks a project — sending is blocked meanwhile */
  projectId: string | null
}

export type DraftsStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => readonly Draft[]
  create: (projectId: string | null) => Draft
  setProject: (id: string, projectId: string) => void
  remove: (id: string) => void
  /** Seed from disk only if no mutation has landed yet. */
  hydrate: (list: readonly Draft[]) => void
}

const emptyDrafts: readonly Draft[] = []

export function createDraftsStore(persist?: (list: readonly Draft[]) => void): DraftsStore {
  let state: readonly Draft[] = emptyDrafts
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function setState(next: readonly Draft[]) {
    if (next === state) return
    state = next
    persist?.(state)
    emit()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return state
    },
    create(projectId) {
      const draft: Draft = { id: newId(), projectId }
      setState([...state, draft])
      return draft
    },
    setProject(id, projectId) {
      setState(state.map((draft) => (draft.id === id ? { ...draft, projectId } : draft)))
    },
    remove(id) {
      const next = state.filter((draft) => draft.id !== id)
      if (next.length === state.length) return
      setState(next)
    },
    hydrate(list) {
      // Reference equality with the initial empty constant: any mutation
      // replaces it, so disk never clobbers a live working set.
      if (state !== emptyDrafts) return
      state = list
      emit()
    },
  }
}
