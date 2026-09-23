import { Context, Effect, FileSystem, Layer, Path } from 'effect'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type BrowseEntry = { name: string; fullPath: string; isGitRepo: boolean }
export type BrowseResult = { parentPath: string; entries: BrowseEntry[] }

const MAX_ENTRIES = 500

export function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return join(homedir(), input.slice(2))
  return input
}

export function normalizePath(input: string): string {
  return resolve(expandHome(input))
}

export function browse(partialPath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const listWhole = partialPath.endsWith('/')
    const abs = normalizePath(partialPath)
    const dir = listWhole ? abs : path.dirname(abs)
    const filter = listWhole ? '' : path.basename(abs)
    const filterLower = filter.toLowerCase()
    const showDotfiles = filter.startsWith('.')

    const names = yield* fs.readDirectory(dir).pipe(Effect.catch(() => Effect.succeed([])))

    const entries: Omit<BrowseEntry, 'isGitRepo'>[] = []
    for (const name of names) {
      if (!showDotfiles && name.startsWith('.')) continue
      if (filter && !name.toLowerCase().startsWith(filterLower)) continue
      const fullPath = path.join(dir, name)
      const isDirectory = yield* fs.stat(fullPath).pipe(
        Effect.map((stat) => stat.type === 'Directory'),
        Effect.catch(() => Effect.succeed(false))
      )
      if (!isDirectory) continue
      entries.push({ name, fullPath })
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const shown = yield* Effect.forEach(
      entries.slice(0, MAX_ENTRIES),
      (entry) =>
        fs.exists(path.join(entry.fullPath, '.git')).pipe(
          Effect.catch(() => Effect.succeed(false)),
          Effect.map((isGitRepo) => ({ ...entry, isGitRepo }))
        ),
      { concurrency: 32 }
    )
    return { parentPath: dir, entries: shown }
  })
}

export const FileBrowser = Context.Service<{
  browse: (partialPath: string) => Effect.Effect<BrowseResult>
}>('jetty/FileBrowser')

export const FileBrowserLive = Layer.effect(
  FileBrowser,
  Effect.gen(function* () {
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>()
    return {
      browse: (partialPath: string) => browse(partialPath).pipe(Effect.provideContext(services)),
    }
  })
)
