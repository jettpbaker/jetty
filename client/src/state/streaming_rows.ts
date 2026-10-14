import type { ThreadRow } from '@/components/custom/thread_rows'
import type { ThreadItem } from '@jetty/shared/items'

import { streamRow } from '@/components/custom/thread_rows'
import { RegistryContext } from '@effect/atom-react'
import { findThreadItem } from '@jetty/shared/reducer'
import { useContext, useEffectEvent, useLayoutEffect, useState } from 'react'

import { itemDeltasSince, sameItemStructure } from './item_selection'
import { threadAtom } from './threads'

export function createStreamingRows() {
  let base: readonly ThreadRow[] = []
  let rows: ThreadRow[] = []
  const indices = new Map<string, number>()
  const rowIndices = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()
  function update(item: ThreadItem, projectPath?: string) {
    const index = indices.get(item.id)
    if (index === undefined) return false
    const row = rows[index]!
    const next = streamRow(row, item, projectPath)
    if (next === row) return false
    rows[index] = next
    for (const listener of listeners.get(row.id) ?? []) listener()
    return index === rows.length - 1
  }
  return {
    get rows() {
      return rows
    },
    reset(next: readonly ThreadRow[]) {
      if (base === next) return
      base = next
      rows = [...next]
      indices.clear()
      rowIndices.clear()
      for (const [index, row] of rows.entries()) {
        rowIndices.set(row.id, index)
        if (row.kind === 'assistant' || row.kind === 'plan') indices.set(row.item.id, index)
        else if (row.kind === 'work')
          for (const activity of row.activities) indices.set(activity.id, index)
      }
    },
    get(row: ThreadRow) {
      const index = rowIndices.get(row.id)
      return index !== undefined && base[index] === row ? rows[index]! : row
    },
    update,
    sync(items: readonly ThreadItem[], projectPath?: string) {
      let tail = false
      for (const item of items) tail = update(item, projectPath) || tail
      return tail
    },
    subscribe(id: string, listener: () => void) {
      let active = listeners.get(id)
      if (!active) {
        active = new Set()
        listeners.set(id, active)
      }
      active.add(listener)
      return () => {
        active.delete(listener)
        if (!active.size) listeners.delete(id)
      }
    },
  }
}

export function useStreamingRows(
  threadId: string,
  rows: readonly ThreadRow[],
  items: readonly ThreadItem[],
  projectPath: string | undefined,
  onTailChanged: () => void
) {
  const registry = useContext(RegistryContext)
  const [store] = useState(createStreamingRows)
  const tailChanged = useEffectEvent(onTailChanged)
  useLayoutEffect(() => {
    store.reset(rows)
    const current = registry.get(threadAtom(threadId))?.items
    if (current && current !== items) store.sync(current, projectPath)
  }, [store, rows, items, registry, threadId, projectPath])
  useLayoutEffect(() => {
    let previous = registry.get(threadAtom(threadId))?.items
    return registry.subscribe(threadAtom(threadId), (state) => {
      if (!state) return
      const before = previous
      previous = state.items
      if (!before || before === state.items) return
      const changed = itemDeltasSince(before, state.items)
      let tail = false
      if (changed) {
        for (const id of changed) {
          const item = findThreadItem(state.items, id)
          if (item) tail = store.update(item, projectPath) || tail
        }
      } else if (sameItemStructure(before, state.items)) tail = store.sync(state.items, projectPath)
      if (tail) tailChanged()
    })
  }, [registry, threadId, store, projectPath])
  return store
}
