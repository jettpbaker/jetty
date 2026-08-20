import type { Skill } from '@jetty/shared/wire'

import type { Socket } from '../socket'
import type { ChromeStore } from './chrome'

export type SkillsStore = {
  subscribe: (listener: () => void) => () => void
  getFor: (projectId: string | null | undefined) => Skill[]
}

const USER_KEY = ''
const EMPTY: Skill[] = []

export function createSkillsStore(socket: Socket, chromeStore: ChromeStore): SkillsStore {
  const cache = new Map<string, Skill[]>()
  const inflight = new Set<string>()
  const listeners = new Set<() => void>()

  function emit() {
    for (const listener of listeners) listener()
  }

  function load(projectId: string | undefined, force: boolean) {
    const key = projectId ?? USER_KEY
    if (inflight.has(key)) return
    if (!force && cache.has(key)) return
    inflight.add(key)
    void socket
      .request('skills.list', projectId ? { projectId } : {})
      .then((result) => {
        cache.set(key, result.skills)
        emit()
      })
      .catch(() => {
        // reconnect retries via onReconnect
      })
      .finally(() => {
        inflight.delete(key)
      })
  }

  function warm(force: boolean) {
    load(undefined, force)
    for (const project of chromeStore.getSnapshot().projects) {
      load(project.id, force)
    }
  }

  chromeStore.subscribe(() => warm(false))
  socket.onReconnect(() => warm(true))
  warm(false)

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getFor(projectId) {
      return cache.get(projectId ?? USER_KEY) ?? cache.get(USER_KEY) ?? EMPTY
    },
  }
}
