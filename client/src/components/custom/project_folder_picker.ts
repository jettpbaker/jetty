import { inComposition } from '@/lib/composition'
import { useBrowse } from '@/state'
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'

export const UP = '..'

const START = '~/'

type Action = 'add' | 'open'

function baseName(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

function parentDir(path: string) {
  return path.slice(0, path.lastIndexOf('/')) || '/'
}

function withSlash(path: string) {
  return path.endsWith('/') ? path : `${path}/`
}

// A path typed or pasted after the one already there starts over, as in a file dialog: the
// prefilled ~/ plus a pasted /Users/me/code reads /Users/me/code, and …/~/code reads ~/code.
function startOver(path: string) {
  const fresh = Math.max(path.lastIndexOf('//'), path.lastIndexOf('/~/'))
  return fresh < 0 ? path : path.slice(fresh + 1)
}

export function useFolderPicker(existingPaths: readonly string[], onAdd: (path: string) => void) {
  const [query, setQuery] = useState(START)
  const [highlight, setHighlight] = useState('')
  const listId = useId()
  const opened = useRef<{ path: string; at: number }>(undefined)
  const home = useBrowse(START).listing?.parentPath
  const { listing: result, current } = useBrowse(query)
  // Enter or ⌘↵ pressed before the typed path's listing lands waits for it, rather than acting
  // on the listing still shown from the path before.
  const [waiting, setWaiting] = useState<Action>()

  const slash = query.lastIndexOf('/')
  const dirQuery = query.slice(0, slash + 1)
  const filter = query.slice(slash + 1)
  const dir = result?.parentPath
  const canGoUp = dir !== undefined && dir !== '/'
  const entries = (result?.entries ?? []).map((entry) => ({
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

  function perform(action: Action) {
    if (!current) setWaiting(action)
    else if (action === 'add') add()
    else if (active) select(active)
  }

  const performWaiting = useEffectEvent(perform)
  useEffect(() => {
    if (!waiting || !current) return
    setWaiting(undefined)
    performWaiting(waiting)
  }, [waiting, current])

  function onRowClick(event: MouseEvent, value: string) {
    if (event.detail > 1) return
    opened.current = value === UP ? undefined : { path: value, at: event.timeStamp }
    select(value)
  }

  function onListClick(event: MouseEvent) {
    const last = opened.current
    if (event.detail !== 2 || !last || event.timeStamp - last.at > 500) return
    if (!existingPaths.includes(last.path)) onAdd(last.path)
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
    // Enter and the arrows belong to an IME while it composes.
    if (inComposition(event.nativeEvent)) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      move(event.key === 'ArrowDown' ? 1 : -1)
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) perform('add')
    else if (event.key === 'Enter') perform('open')
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
      onMouseDown: (event: MouseEvent) => event.preventDefault(),
      onClick: (event: MouseEvent) => onRowClick(event, value),
    } as const
  }

  return {
    query,
    setQuery: (next: string) => {
      setQuery(startOver(next))
      setHighlight('')
      setWaiting(undefined)
    },
    filter,
    canGoUp,
    entries,
    loaded: result !== undefined,
    row,
    list: { id: listId, role: 'listbox', onClick: onListClick } as const,
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
    add: () => perform('add'),
    back,
  }
}
