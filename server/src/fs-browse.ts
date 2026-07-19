import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export type BrowseEntry = { name: string; fullPath: string }
export type BrowseResult = { parentPath: string; entries: BrowseEntry[] }

const MAX_ENTRIES = 50

/** Expand a leading `~` to the home directory; other paths pass through. */
export function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return join(homedir(), input.slice(2))
  return input
}

/** Absolute, symlink-preserving normalization of a user-entered path. */
export function normalizePath(input: string): string {
  return resolve(expandHome(input))
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// A trailing slash means "list this directory"; otherwise the last segment is a
// case-insensitive prefix filter against its parent. Directories only, dotfiles
// hidden unless the filter segment itself is dotted. A missing parent lists empty.
export function browse(partialPath: string): BrowseResult {
  const listWhole = partialPath.endsWith('/')
  const abs = normalizePath(partialPath)
  const dir = listWhole ? abs : dirname(abs)
  const filter = listWhole ? '' : basename(abs)
  const filterLower = filter.toLowerCase()
  const showDotfiles = filter.startsWith('.')

  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return { parentPath: dir, entries: [] }
  }

  const entries: BrowseEntry[] = []
  for (const name of names) {
    if (!showDotfiles && name.startsWith('.')) continue
    if (filter && !name.toLowerCase().startsWith(filterLower)) continue
    const fullPath = join(dir, name)
    if (!isDirectory(fullPath)) continue
    entries.push({ name, fullPath })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return { parentPath: dir, entries: entries.slice(0, MAX_ENTRIES) }
}
