import type { Project, ThreadMeta, ChromePushData } from '@jetty/shared/wire'

import type { Socket } from '../socket'

export type ChromeState = {
  projects: Project[]
  threads: ThreadMeta[]
}

const emptyChrome: ChromeState = { projects: [], threads: [] }

export type ChromeStore = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ChromeState
}

export function createChromeStore(socket: Socket): ChromeStore {
  let state: ChromeState = emptyChrome
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  function setState(next: ChromeState) {
    if (next === state) return
    state = next
    emit()
  }

  function applyPush(data: ChromePushData) {
    switch (data.type) {
      case 'snapshot':
        setState({ projects: data.projects, threads: data.threads })
        return
      case 'project.upserted': {
        const projects = upsertById(state.projects, data.project)
        setState({ projects, threads: state.threads })
        return
      }
      case 'thread.upserted': {
        const threads = upsertById(state.threads, data.thread)
        setState({ projects: state.projects, threads })
        return
      }
      case 'thread.removed': {
        const threads = state.threads.filter((t) => t.id !== data.threadId)
        if (threads.length === state.threads.length) return
        setState({ projects: state.projects, threads })
        return
      }
    }
  }

  function resubscribe() {
    void socket.request('chrome.subscribe', {}).catch(() => {
      // reconnect will retry
    })
  }

  socket.onChromePush(applyPush)
  socket.onReconnect(resubscribe)

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
  }
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((row) => row.id === item.id)
  if (index === -1) return [...list, item]
  if (list[index] === item) return list
  const next = [...list]
  next[index] = item
  return next
}
