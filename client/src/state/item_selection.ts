import type { ThreadItem } from '@jetty/shared/items'

const deltas = new WeakMap<
  readonly ThreadItem[],
  { previous: WeakRef<readonly ThreadItem[]>; itemId: string }
>()

export function noteItemDelta(
  previous: readonly ThreadItem[],
  items: readonly ThreadItem[],
  itemId: string
) {
  if (previous !== items) deltas.set(items, { previous: new WeakRef(previous), itemId })
}

// The items deltas changed on the way from an earlier array to this one; undefined when anything
// else changed it too.
export function itemDeltasSince(previous: readonly ThreadItem[], items: readonly ThreadItem[]) {
  const ids = new Set<string>()
  let current = items
  while (current !== previous) {
    const delta = deltas.get(current)
    const before = delta?.previous.deref()
    if (!delta || !before) return undefined
    ids.add(delta.itemId)
    current = before
  }
  return ids
}

// Some of a thread's items. A delta changes only its own item, so while deltas stream into items
// the selection doesn't hold, it stays the same array without another pass over the thread.
export function createItemSelection(includes: (item: ThreadItem) => boolean) {
  const cache = new WeakMap<readonly ThreadItem[], readonly ThreadItem[]>()
  return function select(items: readonly ThreadItem[]): readonly ThreadItem[] {
    const cached = cache.get(items)
    if (cached) return cached
    const delta = deltas.get(items)
    const previous = delta?.previous.deref()
    const before = previous && cache.get(previous)
    const selected =
      delta && before && !before.some((item) => item.id === delta.itemId)
        ? before
        : items.filter(includes)
    cache.set(items, selected)
    return selected
  }
}

export function sameItems(a: readonly ThreadItem[], b: readonly ThreadItem[]) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}
