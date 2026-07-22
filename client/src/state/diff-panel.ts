export type DiffPanelState = {
  open: boolean
}

export type DiffPanelStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DiffPanelState
  toggle: () => void
  open: () => void
  close: () => void
}

export function createDiffPanelStore(): DiffPanelStore {
  let state: DiffPanelState = { open: false }
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function setState(next: DiffPanelState) {
    if (next.open === state.open) return
    state = next
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
    toggle() {
      setState({ open: !state.open })
    },
    open() {
      setState({ open: true })
    },
    close() {
      setState({ open: false })
    },
  }
}

export const diffPanelStore = createDiffPanelStore()
