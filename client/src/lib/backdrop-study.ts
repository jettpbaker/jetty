import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

// Temporary comparison of new-thread backgrounds. Remove once one is chosen.
export const backdropFields = ['none', 'glow', 'drift', 'project', 'gradient'] as const
export const backdropMarks = ['none', 'jetty', 'name', 'glyph'] as const
export type BackdropField = (typeof backdropFields)[number]
export type BackdropMark = (typeof backdropMarks)[number]
export type BackdropLook = { field: BackdropField; mark: BackdropMark; grain: boolean }

const storageKey = 'jetty.backdrop-study'
const listeners = new Set<() => void>()
let look = load()

function load(): BackdropLook {
  const [field, mark, grain] = (storage.get(storageKey) ?? '').split(':')
  return {
    field: backdropFields.find((value) => value === field) ?? 'none',
    mark: backdropMarks.find((value) => value === mark) ?? 'none',
    grain: grain === 'grain',
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBackdropLook(next: BackdropLook) {
  look = next
  storage.set(storageKey, `${next.field}:${next.mark}:${next.grain ? 'grain' : 'plain'}`)
  for (const listener of listeners) listener()
}

export function useBackdropLook() {
  return useSyncExternalStore(subscribe, () => look)
}
