import { createConnection, type Connection } from '@/net/connection'
import { connectionUrl } from '@/platform'
import { Effect, Stream } from 'effect'
import { Atom } from 'effect/unstable/reactivity'

export const connectionAtom = Atom.make(createConnection(connectionUrl())).pipe(Atom.keepAlive)

export function subscribe<A, E>(
  get: Atom.AtomContext,
  open: (connection: Connection) => Stream.Stream<A, E>
) {
  return Stream.unwrap(Effect.map(get.result(connectionAtom), open))
}
