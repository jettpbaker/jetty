import { storage } from '@/platform'
import { useAtomValue } from '@effect/atom-react'
import { Schema } from 'effect'
import { Effect } from 'effect'
import { Atom, type AtomRegistry } from 'effect/reactivity'
import { useEffect } from 'react'

import { run, useAction } from './connection'

const Identity = Schema.Struct({
  login: Schema.NullOr(Schema.String),
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
})
type Identity = Schema.Schema.Type<typeof Identity>

// The last identity survives reloads, so the sidebar footer opens on it while a fresh read catches up.
const cacheKey = 'jetty.identity'
const isIdentity = Schema.is(Identity)

function loadCached(): Identity | undefined {
  try {
    const saved: unknown = JSON.parse(storage.get(cacheKey) ?? 'null')
    return isIdentity(saved) ? saved : undefined
  } catch {
    return undefined
  }
}

const identityAtom = Atom.make<Identity | undefined>(loadCached()).pipe(Atom.keepAlive)

function readIdentity(registry: AtomRegistry.AtomRegistry) {
  run(registry, (connection) =>
    connection.request('user.identity', {}).pipe(
      Effect.tap((identity) =>
        Effect.sync(() => {
          registry.set(identityAtom, identity)
          storage.set(cacheKey, JSON.stringify(identity))
        })
      )
    )
  )
}

export function useIdentity() {
  const read = useAction(readIdentity)
  useEffect(() => {
    read()
  }, [read])
  return useAtomValue(identityAtom)
}
