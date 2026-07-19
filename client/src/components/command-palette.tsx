import type { ResultOf } from '@jetty/shared/wire'

import { chromeStore, draftsStore, socket, tabsStore } from '@/app-state'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  ArrowBendUpLeftIcon,
  ChatCircleIcon,
  FolderIcon,
  FolderPlusIcon,
} from '@phosphor-icons/react'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

type BrowseResult = ResultOf<'fs.browse'>

type PaletteIntent = 'add-project'
type PaletteContext = { openPalette: (intent?: PaletteIntent) => void }

const Context = createContext<PaletteContext | null>(null)

export function useCommandPalette(): PaletteContext {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider')
  return ctx
}

const PATH_LIKE = /^(~\/|\/|\.\/)/
const BROWSE_DEBOUNCE_MS = 120
const MAX_THREADS = 15

type Mode = 'root' | 'browse'

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('root')
  const [query, setQuery] = useState('')

  const value = useMemo<PaletteContext>(
    () => ({
      openPalette(intent) {
        if (intent === 'add-project') {
          setMode('browse')
          setQuery('~/')
        } else {
          setMode('root')
          setQuery('')
        }
        setOpen(true)
      },
    }),
    []
  )

  useHotkeys([
    {
      hotkey: 'Mod+K',
      callback: () => (open ? setOpen(false) : value.openPalette()),
      options: { preventDefault: true },
    },
  ])

  return (
    <Context.Provider value={value}>
      {children}
      <Palette
        open={open}
        onOpenChange={setOpen}
        mode={mode}
        setMode={setMode}
        query={query}
        setQuery={setQuery}
      />
    </Context.Provider>
  )
}

type PaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Mode
  setMode: (mode: Mode) => void
  query: string
  setQuery: (query: string) => void
}

function Palette({ open, onOpenChange, mode, setMode, query, setQuery }: PaletteProps) {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const navigate = useNavigate()
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null)

  useEffect(() => {
    if (!open) {
      setMode('root')
      setQuery('')
      setBrowseResult(null)
    }
  }, [open, setMode, setQuery])

  useEffect(() => {
    if (!open || mode !== 'browse') return
    const handle = setTimeout(() => {
      void socket
        .request('fs.browse', { partialPath: query })
        .then(setBrowseResult)
        .catch(() => setBrowseResult(null))
    }, BROWSE_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [open, mode, query])

  function close() {
    onOpenChange(false)
  }

  function onQueryChange(next: string) {
    setQuery(next)
    if (mode === 'root' && PATH_LIKE.test(next)) setMode('browse')
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (mode === 'browse' && query === '' && event.key === 'Backspace') {
      event.preventDefault()
      setMode('root')
      setBrowseResult(null)
    }
  }

  function openDraftIn(projectId: string) {
    close()
    const draft = draftsStore.create(projectId)
    tabsStore.open(draft.id)
    void navigate({ to: '/new/$draftId', params: { draftId: draft.id } })
  }

  function openThread(threadId: string) {
    close()
    tabsStore.open(threadId)
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  async function addProject(path: string) {
    try {
      const { project } = await socket.request('project.create', { path })
      openDraftIn(project.id)
    } catch {
      toast.error('Couldn’t add the project.')
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className='bg-popover/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-lg before:backdrop-saturate-150'
    >
      <Command shouldFilter={mode === 'root'} className='relative bg-transparent'>
        <CommandInput
          value={query}
          onValueChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          placeholder={
            mode === 'browse'
              ? 'Enter project path (e.g. ~/projects/my-app)'
              : 'Search projects and threads...'
          }
        />
        <CommandList>
          {mode === 'root' ? (
            <RootItems
              chrome={chrome}
              onAddProject={() => {
                setMode('browse')
                setQuery('~/')
              }}
              onOpenProject={openDraftIn}
              onOpenThread={openThread}
            />
          ) : (
            <BrowseItems
              query={query}
              result={browseResult}
              onDrill={(fullPath) => setQuery(`${fullPath}/`)}
              onAdd={addProject}
            />
          )}
        </CommandList>
        <div className='px-3 py-2 text-xs text-muted-foreground'>
          ↑↓ navigate · ↵ select · esc close
        </div>
      </Command>
    </CommandDialog>
  )
}

type ChromeState = ReturnType<typeof chromeStore.getSnapshot>

function RootItems({
  chrome,
  onAddProject,
  onOpenProject,
  onOpenThread,
}: {
  chrome: ChromeState
  onAddProject: () => void
  onOpenProject: (projectId: string) => void
  onOpenThread: (threadId: string) => void
}) {
  const projectById = new Map(chrome.projects.map((project) => [project.id, project]))
  const threads = chrome.threads.filter((thread) => !thread.archived).slice(0, MAX_THREADS)

  return (
    <>
      <CommandEmpty>No results.</CommandEmpty>
      <CommandGroup heading='Actions'>
        <CommandItem
          value='add project new folder directory path'
          keywords={['folder', 'directory', 'path', 'new']}
          onSelect={onAddProject}
        >
          <FolderPlusIcon />
          Add project
        </CommandItem>
      </CommandGroup>
      {chrome.projects.length > 0 && (
        <CommandGroup heading='Projects'>
          {chrome.projects.map((project) => (
            <CommandItem
              key={project.id}
              value={`project ${project.title} ${project.path}`}
              onSelect={() => onOpenProject(project.id)}
            >
              <FolderIcon />
              <span className='min-w-0 truncate'>{project.title}</span>
              <span className='min-w-0 truncate text-xs text-muted-foreground'>{project.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {threads.length > 0 && (
        <CommandGroup heading='Threads'>
          {threads.map((thread) => {
            const project = projectById.get(thread.projectId)
            return (
              <CommandItem
                key={thread.id}
                value={`thread ${thread.title} ${project?.title ?? ''} ${thread.id}`}
                onSelect={() => onOpenThread(thread.id)}
              >
                <ChatCircleIcon />
                <span className='min-w-0 truncate'>{thread.title || thread.id}</span>
                {project && (
                  <span className='min-w-0 truncate text-xs text-muted-foreground'>
                    {project.title}
                  </span>
                )}
              </CommandItem>
            )
          })}
        </CommandGroup>
      )}
    </>
  )
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  if (index <= 0) return '/'
  return trimmed.slice(0, index)
}

function BrowseItems({
  query,
  result,
  onDrill,
  onAdd,
}: {
  query: string
  result: BrowseResult | null
  onDrill: (fullPath: string) => void
  onAdd: (path: string) => void
}) {
  const entries = result?.entries ?? []
  const parentPath = result?.parentPath ?? null

  let addPath: string | null = null
  if (query.endsWith('/')) {
    addPath = parentPath
  } else {
    const wanted = baseName(query).toLowerCase()
    addPath = entries.find((entry) => entry.name.toLowerCase() === wanted)?.fullPath ?? null
  }

  const showUp = parentPath !== null && parentPath !== '/'

  return (
    <>
      <CommandEmpty>No matching directory.</CommandEmpty>
      {entries.length > 0 && (
        <CommandGroup heading='Directories'>
          {entries.map((entry) => (
            <CommandItem
              key={entry.fullPath}
              value={entry.fullPath}
              onSelect={() => onDrill(entry.fullPath)}
            >
              <FolderIcon />
              <span className='min-w-0 truncate'>{entry.name}</span>
              <span className='min-w-0 truncate text-xs text-muted-foreground'>
                {entry.fullPath}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {(addPath || showUp) && (
        <>
          <CommandSeparator />
          <CommandGroup>
            {addPath && (
              <CommandItem
                value='__add__'
                className='text-primary data-selected:text-primary'
                onSelect={() => onAdd(addPath)}
              >
                <FolderPlusIcon />
                <span className='truncate'>Add {baseName(addPath) || addPath}</span>
              </CommandItem>
            )}
            {showUp && parentPath && (
              <CommandItem value='__up__' onSelect={() => onDrill(parentDir(parentPath))}>
                <ArrowBendUpLeftIcon />
                Go up
              </CommandItem>
            )}
          </CommandGroup>
        </>
      )}
    </>
  )
}
