import { Layer, ManagedRuntime } from 'effect'

import { databaseLayer } from './db'
import { Store, storeLayer } from './store'

export async function openTestStore(home: string) {
  const runtime = ManagedRuntime.make(storeLayer.pipe(Layer.provideMerge(databaseLayer(home))))
  try {
    const store = await runtime.runPromise(Store)
    return { store, runtime, close: () => runtime.dispose() }
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
