import type { FileTreeBatchOperation, FileTreeVisibleRow } from '@pierre/trees'

import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  useChrome,
  useFileSearch,
  useFolderReader,
  useRefreshOnFocus,
  useToolsSettled,
} from '@/state'
import { FileTree, useFileTree } from '@pierre/trees/react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

import { charmedTree } from './changed_files_tree'
import { charmedSprite } from './charmed_icons'
import { CharmedFileIcon } from './diff/file_name'
import './changed_files_tree.css'
import './option_picker.css'

type Entry = { readonly name: string; readonly directory: boolean }
type Listing = { folders: Map<string, readonly Entry[]>; open: Set<string> }

// Each thread's folders as last listed, and which were open, so its Files view paints again at
// once and catches up behind. Folders are keyed by path, '' for the top.
const listings = new Map<string, Listing>()
const keptListings = 20

function listingOf(threadId: string) {
  const listing = listings.get(threadId) ?? { folders: new Map(), open: new Set() }
  listings.delete(threadId)
  listings.set(threadId, listing)
  for (const stale of listings.keys()) {
    if (listings.size <= keptListings) break
    listings.delete(stale)
  }
  return listing
}

// The tree's path for an entry: folders end in a slash.
const treePath = (folder: string, entry: Entry) =>
  `${folder && `${folder}/`}${entry.name}${entry.directory ? '/' : ''}`

function treePaths(listing: Listing) {
  return [...listing.folders].flatMap(([folder, entries]) =>
    entries.map((entry) => treePath(folder, entry))
  )
}

// ⌘P asks for the search; each request is answered once, by the view it finds.
let answeredFind = 0

// The whole project, as in an editor's sidebar: a tree read a folder at a time as folders open,
// and a search over every file git doesn't ignore. Picking a file opens it in the file tab.
export function ThreadFiles({
  threadId,
  projectId,
  openPath,
  find,
  onOpen,
}: {
  threadId: string
  projectId: string
  openPath?: string
  find: number
  onOpen: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  // Enter pressed before the results for what's typed land waits for them; typing cancels it.
  const [entered, setEntered] = useState(false)
  const resultsCurrent = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (find <= answeredFind) return
    answeredFind = find
    input.current?.focus()
    input.current?.select()
  }, [find])
  const searching = query.trim() !== ''
  return (
    <div className='search-picker flex h-full min-h-0 flex-col pt-3 pr-1.5 pl-3'>
      <Command
        shouldFilter={false}
        className={cn(
          'rounded-none! bg-transparent',
          searching ? 'min-h-0 flex-1' : 'h-auto shrink-0'
        )}
      >
        <CommandInput
          ref={input}
          placeholder='Search files'
          aria-label='Search files'
          value={query}
          onValueChange={(next) => {
            setQuery(next)
            setEntered(false)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && searching && !resultsCurrent.current) {
              event.preventDefault()
              setEntered(true)
            }
            if (event.key !== 'Escape' || !query) return
            event.preventDefault()
            setQuery('')
          }}
        />
        <Separator />
        {searching && (
          <SearchResults
            projectId={projectId}
            threadId={threadId}
            query={query}
            current={resultsCurrent}
            entered={entered}
            onPick={(path) => {
              setQuery('')
              setEntered(false)
              onOpen(path)
            }}
          />
        )}
      </Command>
      <div hidden={searching} className='-mx-1.5 mt-2 min-h-0 flex-1'>
        <FolderTree threadId={threadId} openPath={openPath} onOpen={onOpen} />
      </div>
    </div>
  )
}

function FolderTree({
  threadId,
  openPath,
  onOpen,
}: {
  threadId: string
  openPath?: string
  onOpen: (path: string) => void
}) {
  const read = useFolderReader(threadId)
  const [listing] = useState(() => listingOf(threadId))
  // What the tree says when it has nothing to show.
  const [note, setNote] = useState<string>()
  const [options] = useState(() => {
    const paths = treePaths(listing)
    return {
      paths,
      initialExpandedPaths: [...listing.open].map((folder) => `${folder}/`),
      initialSelectedPaths: openPath && paths.includes(openPath) ? [openPath] : [],
      itemHeight: charmedTree.itemHeight,
      icons: charmedTree.icons(paths),
      unsafeCSS: charmedTree.unsafeCSS,
      renderRowDecoration: ({ row }: { row: FileTreeVisibleRow }) =>
        row.kind === 'directory' ? charmedTree.folderDecoration(row) : null,
    }
  })
  const { model } = useFileTree(options)
  const refresh = useRef<() => void>(undefined)

  useEffect(() => {
    let active = true
    const latest = new Map<string, number>()
    let requests = 0
    // The folders the tree has, and those open the last time it changed.
    const folders = new Set<string>()
    for (const [folder, entries] of listing.folders)
      for (const entry of entries)
        if (entry.directory) folders.add(treePath(folder, entry).slice(0, -1))
    const open = new Set(listing.open)
    const folderNames = (paths: string[]) =>
      new Set(paths.flatMap((path) => path.split('/').slice(0, -1)))
    let iconFolders = folderNames(treePaths(listing))

    function forget(folder: string) {
      for (const known of folders)
        if (known === folder || known.startsWith(`${folder}/`)) {
          folders.delete(known)
          open.delete(known)
          listing.folders.delete(known)
        }
    }

    function apply(folder: string, entries: readonly Entry[]) {
      const listed: readonly Entry[] = listing.folders.get(folder) ?? []
      const before = new Set(listed.map((entry) => treePath(folder, entry)))
      const after = new Set(entries.map((entry) => treePath(folder, entry)))
      const operations: FileTreeBatchOperation[] = []
      for (const path of before)
        if (!after.has(path)) {
          operations.push({ type: 'remove', path, recursive: true })
          if (path.endsWith('/')) forget(path.slice(0, -1))
        }
      for (const path of after)
        if (!before.has(path)) {
          operations.push({ type: 'add', path })
          if (path.endsWith('/')) folders.add(path.slice(0, -1))
        }
      listing.folders.set(folder, entries)
      if (operations.length === 0) return
      model.batch(operations)
      // The tree's sprite carries the glyphs of the folders it has.
      const paths = treePaths(listing)
      const names = folderNames(paths)
      if ([...names].some((name) => !iconFolders.has(name))) {
        iconFolders = names
        model.setIcons(charmedTree.icons(paths))
      }
    }

    function list(folder: string) {
      const request = ++requests
      latest.set(folder, request)
      read(folder).then(
        (entries) => {
          if (!active || latest.get(folder) !== request) return
          if (folder !== '' && !folders.has(folder)) return
          apply(folder, entries)
          if (folder === '') setNote(entries.length > 0 ? undefined : 'No files')
        },
        () => {
          if (active && folder === '' && !listing.folders.has('')) setNote("Couldn't list files")
        }
      )
    }

    // A folder is read each time it opens, so one shut for a while shows what's there now.
    function opened() {
      for (const folder of folders) {
        const item = model.getItem(folder)
        const expanded = !!item && 'isExpanded' in item && item.isExpanded()
        if (expanded && !open.has(folder)) {
          open.add(folder)
          list(folder)
        } else if (!expanded) open.delete(folder)
      }
    }

    refresh.current = () => {
      list('')
      for (const folder of open) list(folder)
    }
    refresh.current()
    const unsubscribe = model.subscribe(opened)
    return () => {
      active = false
      unsubscribe()
      listing.open = open
    }
  }, [model, listing, read])

  const turnEndedAt = useChrome()?.threads.find((thread) => thread.id === threadId)?.turnEndedAt
  const catchUp = useCallback(() => refresh.current?.(), [])
  useToolsSettled(threadId, catchUp)
  useRefreshOnFocus(catchUp)
  const turnEnded = useRef(turnEndedAt)
  useEffect(() => {
    if (turnEnded.current === turnEndedAt) return
    turnEnded.current = turnEndedAt
    catchUp()
  }, [turnEndedAt, catchUp])

  useEffect(() => {
    const item = openPath ? model.getItem(openPath) : null
    if (!item || item.isSelected()) return
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect()
    item.select()
  }, [model, openPath])

  // A file row opens on click (and on Enter, which clicks it), even the one already selected.
  const host = useRef<HTMLDivElement>(null)
  const pick = useEffectEvent(onOpen)
  useEffect(() => {
    const element = host.current
    if (!element) return
    function click(event: MouseEvent) {
      for (const target of event.composedPath()) {
        if (!(target instanceof HTMLElement) || !target.dataset.itemPath) continue
        if (target.dataset.itemType === 'file') pick(target.dataset.itemPath)
        return
      }
    }
    element.addEventListener('click', click)
    return () => element.removeEventListener('click', click)
  }, [])

  return (
    <div ref={host} className='relative h-full'>
      <FileTree
        model={model}
        data-charmed='soft'
        aria-label='Project files'
        className='changed-files-tree h-full w-full'
      />
      {note && (
        <p className='absolute inset-x-0 top-0 px-3 py-2 text-xs text-muted-foreground'>{note}</p>
      )}
    </div>
  )
}

function SearchResults({
  projectId,
  threadId,
  query,
  current: currentRef,
  entered,
  onPick,
}: {
  projectId: string
  threadId: string
  query: string
  // whether the list shown is the one for what's typed, for the input's Enter
  current: RefObject<boolean>
  // Enter was pressed before it was, so the top result opens once it is
  entered: boolean
  onPick: (path: string) => void
}) {
  // Each search lists the project's files again, so it waits for a pause in typing.
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 80)
    return () => clearTimeout(timer)
  }, [query])
  const { files, fresh } = useFileSearch(projectId, threadId, search)
  const results = search ? (files ?? []) : []
  const current = fresh && search === query.trim()
  useLayoutEffect(() => {
    currentRef.current = current
  })
  const pickEntered = useEffectEvent(() => {
    if (results[0]) onPick(results[0])
  })
  useEffect(() => {
    if (current && entered) pickEntered()
  }, [current, entered])
  return (
    <CommandList className='min-h-0 flex-1 overflow-y-auto! pt-2'>
      {results.map((path) => {
        const name = path.split('/').at(-1) ?? path
        const folder = path.slice(0, -name.length - 1)
        return (
          <CommandItem key={path} value={`file:${path}`} onSelect={() => onPick(path)}>
            <span data-charmed='soft' className='inline-flex size-4 shrink-0'>
              <CharmedFileIcon path={path} />
            </span>
            <span className='shrink-0 font-mono'>{name}</span>
            {folder && (
              <span className='min-w-0 truncate font-mono text-muted-foreground'>{folder}</span>
            )}
          </CommandItem>
        )
      })}
      {results.length === 0 && (
        <p className='px-2.5 py-2 text-xs text-muted-foreground'>
          {files && search ? 'No matching files' : 'Searching…'}
        </p>
      )}
      <svg
        aria-hidden='true'
        className='absolute size-0 overflow-hidden'
        dangerouslySetInnerHTML={{ __html: charmedSprite }}
      />
    </CommandList>
  )
}
