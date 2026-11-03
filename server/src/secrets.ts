import { newId } from '@jetty/shared/wire'
import { Effect } from 'effect'
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { StoreError } from './store'

const LIFETIME_MS = 24 * 60 * 60 * 1000

export type Secrets = ReturnType<typeof createSecrets>

export function createSecrets(home: string) {
  const folder = join(home, 'secrets')
  async function prepare() {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    await chmod(folder, 0o700)
  }
  return {
    save(value: string) {
      return Effect.tryPromise({
        try: async () => {
          await prepare()
          const path = join(folder, newId())
          const partial = `${path}.partial`
          try {
            await writeFile(partial, value, { mode: 0o600, flag: 'wx' })
            await rename(partial, path)
          } catch {
            await rm(partial, { force: true })
            throw new Error('Could not save secret')
          }
          return path
        },
        catch: () => new StoreError('internal', 'Could not save secret'),
      })
    },
    sweep() {
      return Effect.tryPromise({
        try: async () => {
          await prepare()
          const cutoff = Date.now() - LIFETIME_MS
          for (const entry of await readdir(folder)) {
            const path = join(folder, entry)
            if ((await stat(path)).mtimeMs < cutoff)
              await rm(path, { recursive: true, force: true })
          }
        },
        catch: () => new StoreError('internal', 'Could not sweep secrets'),
      })
    },
  }
}
