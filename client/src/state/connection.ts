import { createConnection, type Connection } from '@/net/connection'
import { connectionUrl } from '@/platform'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Effect, Exit, Stream } from 'effect'
import { Atom, AtomRegistry } from 'effect/unstable/reactivity'
import { useCallback, useContext, useEffect } from 'react'
import { toast } from 'sonner'

type ConnectionStatus = 'connecting' | 'online' | 'reconnecting'

const statusAtom = Atom.make<ConnectionStatus>('connecting').pipe(Atom.keepAlive)

export const connectionAtom = Atom.make((get) => {
  let seen = false
  return createConnection(connectionUrl, (connected) => {
    seen ||= connected
    get.set(statusAtom, connected ? 'online' : seen ? 'reconnecting' : 'connecting')
  })
}).pipe(Atom.keepAlive)

// A server restart that settles within a beat passes unannounced.
const noticeDelayMs = 1000

export function useConnectionNotice() {
  const status = useAtomValue(statusAtom)
  useEffect(() => {
    if (status === 'online') return
    const label = status === 'connecting' ? 'Connecting' : 'Reconnecting'
    const timer = setTimeout(
      () => toast.loading(label, { id: 'connection', duration: Infinity, dismissible: false }),
      noticeDelayMs
    )
    return () => {
      clearTimeout(timer)
      toast.dismiss('connection')
    }
  }, [status])
}

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
