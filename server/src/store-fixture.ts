import { BunServices } from '@effect/platform-bun'
import { Layer, ManagedRuntime } from 'effect'

import { databaseLayer } from './db'
import { Store, storeLayer } from './store'

export async function openTestStore(home: string) {
  const runtime = ManagedRuntime.make(
    storeLayer.pipe(Layer.provideMerge(databaseLayer(home)), Layer.provide(BunServices.layer))
  )
  try {
    const store = await runtime.runPromise(Store)
    return { store, runtime, close: () => runtime.dispose() }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
