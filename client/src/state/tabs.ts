export type TabsStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => readonly string[]
  open: (threadId: string) => void
  close: (threadId: string) => void
  /** arrayMove: place `id` at the index currently held by `targetId`. */
  move: (id: string, targetId: string) => void
  /** Seed from disk only if no mutation has landed yet. */
  hydrate: (ids: readonly string[]) => void
}

const emptyTabs: readonly string[] = []

export function createTabsStore(persist?: (ids: readonly string[]) => void): TabsStore {
  let state: readonly string[] = emptyTabs
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function setState(next: readonly string[]) {
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
    open(threadId) {
      if (state.includes(threadId)) return
      setState([...state, threadId])
    },
    close(threadId) {
      const next = state.filter((id) => id !== threadId)
      if (next.length === state.length) return
      setState(next)
    },
    move(id, targetId) {
      const i = state.indexOf(id)
      const j = state.indexOf(targetId)
      if (i === -1 || j === -1 || i === j) return
      const next = [...state]
      next.splice(i, 1)
      next.splice(j, 0, id)
      setState(next)
    },
    hydrate(ids) {
      // Reference equality with the initial empty constant: any mutation
      // replaces it, so disk never clobbers a live working set.
      if (state !== emptyTabs) return
      state = ids
      emit()
    },
  }
}
