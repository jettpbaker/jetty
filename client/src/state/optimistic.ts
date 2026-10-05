import { type Atom, type AtomRegistry } from 'effect/reactivity'

// Observe from dispatch: a matching push can be superseded before the RPC reply arrives.
export function observeOptimistic<A>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<A>,
  agrees: (value: A) => boolean,
  clear: () => void
) {
  let observed = false
  let accepted = false
  let finished = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const stop = registry.subscribe(atom, (value) => {
    observed ||= agrees(value)
    if (accepted && observed) finish()
  })
  function finish() {
    if (finished) return
    finished = true
    stop()
    clearTimeout(timeout)
    clear()
  }
  return {
    accepted() {
      accepted = true
      if (observed || agrees(registry.get(atom))) finish()
      else timeout = setTimeout(finish, 10_000)
    },
    failed: finish,
  }
}
