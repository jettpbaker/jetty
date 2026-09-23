import { useBrowse } from '@/state'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'

export const UP = '..'

const START = '~/'

export type FolderEntry = { name: string; fullPath: string; isGitRepo: boolean; added: boolean }

export type FolderPicker = ReturnType<typeof useFolderPicker>

export function baseName(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

function parentDir(path: string) {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}

function withSlash(path: string) {
  return path.endsWith('/') ? path : `${path}/`
}

export function useFolderPicker(existingPaths: readonly string[], onAdd: (path: string) => void) {
  const [query, setQuery] = useState(START)
  const [highlight, setHighlight] = useState('')
  const listId = useId()
  const home = useBrowse(START)?.parentPath
  const result = useBrowse(query)

  const slash = query.lastIndexOf('/')
  const dirQuery = query.slice(0, slash + 1)
  const filter = query.slice(slash + 1)
  const dir = result?.parentPath
  const canGoUp = dir !== undefined && dir !== '/'
  const entries: FolderEntry[] = (result?.entries ?? []).map((entry) => ({
    ...entry,
    added: existingPaths.includes(entry.fullPath),
  }))

  const values = [...(canGoUp ? [UP] : []), ...entries.map((entry) => entry.fullPath)]
  const fallback = filter && entries[0] ? entries[0].fullPath : (values[0] ?? '')
  const active = values.includes(highlight) ? highlight : fallback
  const activeEntry = entries.find((entry) => entry.fullPath === active)
  const targetPath = activeEntry?.fullPath ?? dir
  const target = targetPath
    ? { path: targetPath, name: baseName(targetPath), added: existingPaths.includes(targetPath) }
    : undefined

  function tildify(path: string) {
    if (!home) return path
    if (path === home) return '~'
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
  }

  function goTo(path: string, focus = '') {
    setQuery(withSlash(tildify(path)))
    setHighlight(focus)
  }

  function goUp() {
    if (dir && canGoUp) goTo(parentDir(dir), dir)
  }

  function select(value: string) {
    if (value === UP) goUp()
    else goTo(value)
  }

  function setFilter(next: string) {
    setQuery(dirQuery + next)
    setHighlight('')
  }

  function add() {
    if (target && !target.added) onAdd(target.path)
  }

  function back() {
    if (filter) {
      setFilter('')
      return true
    }
    if (dir && home && dir.startsWith(`${home}/`)) {
      goUp()
      return true
    }
    return false
  }

  const rowId = (value: string) => `${listId}-${values.indexOf(value)}`
  const activeId = active ? rowId(active) : undefined

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function move(by: number) {
    const index = Math.min(Math.max(values.indexOf(active) + by, 0), values.length - 1)
    if (values[index]) setHighlight(values[index])
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      move(event.key === 'ArrowDown' ? 1 : -1)
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) add()
    else if (event.key === 'Enter' && active) select(active)
    else return
    event.preventDefault()
  }

  function row(value: string) {
    const selected = value === active
    return {
      id: rowId(value),
      role: 'option',
      'aria-selected': selected,
      'data-selected': selected,
      onClick: () => select(value),
    } as const
  }

  return {
    query,
    setQuery: (next: string) => {
      setQuery(next)
      setHighlight('')
    },
    filter,
    setFilter,
    dir,
    dirLabel: dir ? tildify(dir) : '',
    home,
    tildify,
    canGoUp,
    entries,
    loaded: result !== undefined,
    row,
    list: { id: listId, role: 'listbox' } as const,
    input: {
      'data-slot': 'folder-picker-input',
      role: 'combobox',
      'aria-expanded': true,
      'aria-controls': listId,
      'aria-activedescendant': activeId,
      spellCheck: false,
      onKeyDown,
    } as const,
    activeIsUp: active === UP,
    target,
    goTo,
    goUp,
    select,
    add,
    back,
    onKeyDown,
  }
}
