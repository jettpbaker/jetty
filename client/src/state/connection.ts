import { createConnection, type Connection } from '@/net/connection'
import { connectionUrl } from '@/platform'
import { RegistryContext } from '@effect/atom-react'
import { Effect, Exit, Stream } from 'effect'
import { Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext } from 'react'

export const connectionAtom = Atom.make(createConnection(connectionUrl())).pipe(Atom.keepAlive)

export function subscribe<A, E>(
  get: Atom.AtomContext,
  open: (connection: Connection) => Stream.Stream<A, E>
) {
  return Stream.unwrap(Effect.map(get.result(connectionAtom), open))
}

export function run<A, E>(
  registry: AtomRegistry.AtomRegistry,
  request: (connection: Connection) => Effect.Effect<A, E>,
  onFailure?: () => void
) {
  return Effect.runFork(
    AtomRegistry.getResult(registry, connectionAtom).pipe(
      Effect.flatMap(request),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit)) onFailure?.()
        })
      )
    )
  )
}

export function useAction<Args extends unknown[], R>(
  action: (registry: AtomRegistry.AtomRegistry, ...args: Args) => R
) {
  const registry = useContext(RegistryContext)
  return useCallback((...args: Args) => action(registry, ...args), [action, registry])
}
