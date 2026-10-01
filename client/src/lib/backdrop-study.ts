import { storage } from '@/platform'
import { useSyncExternalStore } from 'react'

// Temporary comparison of new-thread backgrounds. Remove once one is chosen.
export const backdropFields = ['none', 'glow', 'drift', 'project', 'gradient'] as const
export const backdropMarks = ['none', 'jetty', 'name', 'glyph'] as const
// A crisp edge for the new-thread composer, from <html data-composer-edge>.
export const composerEdges = ['none', 'border', 'shadow', 'both'] as const
export type BackdropField = (typeof backdropFields)[number]
export type BackdropMark = (typeof backdropMarks)[number]
export type ComposerEdge = (typeof composerEdges)[number]
export type BackdropLook = {
  field: BackdropField
  mark: BackdropMark
  grain: boolean
  edge: ComposerEdge
}

const storageKey = 'jetty.backdrop-study'
const listeners = new Set<() => void>()
let look = load()
applyEdge(look.edge)

function load(): BackdropLook {
  const [field, mark, grain, edge] = (storage.get(storageKey) ?? '').split(':')
  return {
    field: backdropFields.find((value) => value === field) ?? 'none',
    mark: backdropMarks.find((value) => value === mark) ?? 'none',
    grain: grain === 'grain',
    edge: composerEdges.find((value) => value === edge) ?? 'none',
  }
}

function applyEdge(edge: ComposerEdge) {
  document.documentElement.dataset.composerEdge = edge
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBackdropLook(next: BackdropLook) {
  look = next
  applyEdge(next.edge)
  storage.set(
    storageKey,
    `${next.field}:${next.mark}:${next.grain ? 'grain' : 'plain'}:${next.edge}`
  )
  for (const listener of listeners) listener()
}

export function useBackdropLook() {
  return useSyncExternalStore(subscribe, () => look)
}
