import type { DiffScope } from '@jetty/shared/wire'
import type { FileDiffLoadedFiles, FileDiffMetadata } from '@pierre/diffs'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { ChangesScopePicker } from './changes_scope'
import { charmedSprite } from './charmed_icons'
import { DiffBody } from './diff/body'
import { syntaxTheme } from './diff/cursor_themes'
import { DiffFileCard } from './diff/file_card'
import { DiffFileList } from './diff/file_list'
import { byTreeOrder, DiffStyleContext, DiffWrapContext, type DiffFile } from './diff/model'
import { DiffToolbar, useDiffStyle, useDiffWrap } from './diff/toolbar'
import { DiffWorkerPoolProvider, firstPaintLines } from './diff_worker_pool'
import {
  hydratedDiff,
  loadedFiles,
  patchMatchesContents,
  withoutContext,
  type FileChange,
  type LoadDiffFile,
} from './file_diff_model'

const filePrefetchConcurrency = 4

type ChangedFile = DiffFile & { diff: FileDiffMetadata; initiallyNear: boolean }

export function FileChangesViewer({
  scope = 'uncommitted',
  onScopeChange,
  files: changes,
  footer,
  loadFile,
  reveal,
}: {
  scope?: DiffScope
  onScopeChange?: (scope: DiffScope) => void
  files: FileChange[]
  footer?: ReactNode
  loadFile?: LoadDiffFile
  reveal?: { path: string }
}) {
  const root = useRef<HTMLDivElement>(null)
  const paneId = useId()
  const [pane, setPane] = useState(true)
  const [filter, setFilter] = useState('')
  const [diffStyle, setDiffStyle] = useDiffStyle()
  const [wrap, setWrap] = useDiffWrap(root)
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set())
  const [noContext, setNoContext] = useState<ReadonlyMap<FileDiffMetadata, FileDiffMetadata>>(
    () => new Map()
  )
  const [hydrated, setHydrated] = useState<ReadonlyMap<FileDiffMetadata, FileDiffMetadata>>(
    () => new Map()
  )
  const diffs = useMemo(() => new Set(changes.map((file) => file.diff)), [changes])
  const currentDiffs = useRef(diffs)
  currentDiffs.current = diffs
  useEffect(() => {
    function prune(previous: ReadonlyMap<FileDiffMetadata, FileDiffMetadata>) {
      const next = new Map([...previous].filter(([diff]) => diffs.has(diff)))
      return next.size === previous.size ? previous : next
    }
    setHydrated(prune)
    setNoContext(prune)
  }, [diffs])
  const models = useMemo(() => {
    let lines = 0
    return [...changes].sort(byTreeOrder).map((file): ChangedFile => {
      const initiallyNear = lines < firstPaintLines
      lines += file.diff.unifiedLineCount
      return {
        path: file.path,
        previousPath: file.diff.prevName,
        status: file.status === 'deleted' ? 'removed' : file.status,
        additions: file.diff.hunks.reduce((n, hunk) => n + hunk.additionLines, 0),
        deletions: file.diff.hunks.reduce((n, hunk) => n + hunk.deletionLines, 0),
        binary: file.diff.hunks.length === 0 && file.diff.type !== 'rename-pure',
        diff: file.diff,
        initiallyNear,
      }
    })
  }, [changes])
  const files = useMemo(
    () => models.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase())),
    [models, filter]
  )
  // One request per diff revision, shared by the prefetch and the expand click.
  const loadDiffFiles = useMemo(() => {
    if (!loadFile) return undefined
    const requests = new WeakMap<FileDiffMetadata, Promise<FileDiffLoadedFiles>>()
    return (diff: FileDiffMetadata) => {
      let request = requests.get(diff)
      if (!request) {
        request = loadFile(diff.name, diff.prevName)
          .then((contents) => {
            if ('unavailable' in contents)
              throw new Error(`No context for ${diff.name}: ${contents.unavailable}`)
            if (!patchMatchesContents(diff, contents))
              throw new Error(`Patch does not match file contents for ${diff.name}`)
            const files = loadedFiles(diff, contents)
            setHydrated((previous) =>
              currentDiffs.current.has(diff)
                ? new Map(previous).set(diff, hydratedDiff(diff, files))
                : previous
            )
            return files
          })
          .catch((error) => {
            setNoContext((previous) =>
              currentDiffs.current.has(diff)
                ? new Map(previous).set(diff, withoutContext(diff))
                : previous
            )
            throw error
          })
        requests.set(diff, request)
        request.catch(() => requests.delete(diff))
      }
      return request
    }
  }, [loadFile])
  useEffect(() => {
    if (!loadDiffFiles) return
    const pending = changes
      .map(({ diff }) => diff)
      .filter(
        (diff) => diff.isPartial && (diff.type === 'change' || diff.type === 'rename-changed')
      )
    let next = 0
    let active = true
    for (let i = 0; i < Math.min(filePrefetchConcurrency, pending.length); i++) {
      async function prefetch() {
        while (active && next < pending.length) {
          const diff = pending[next++]!
          await loadDiffFiles!(diff).catch(() => {})
        }
      }
      void prefetch()
    }
    return () => {
      active = false
    }
  }, [changes, loadDiffFiles])
  const [selected, setSelected] = useState<string | null>(null)
  const [scrolledTo, setInView] = useState<string | null>(null)
  const inView = files.some((file) => file.path === scrolledTo)
    ? scrolledTo
    : (files[0]?.path ?? null)
  const active = useRef(inView)
  active.current = inView
  const selectFile = useCallback((path: string) => {
    setSelected(path)
    setInView(path)
    root.current
      ?.querySelector<HTMLElement>(`section[id="${CSS.escape(`linear-file-${path}`)}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])
  useEffect(() => {
    if (!reveal) return
    setFilter('')
    setCollapsedFiles((previous) => {
      if (!previous.has(reveal.path)) return previous
      const next = new Set(previous)
      next.delete(reveal.path)
      return next
    })
    setSelected(reveal.path)
  }, [reveal])
  useEffect(() => {
    if (selected) selectFile(selected)
  }, [selected, reveal, selectFile])
  return (
    <DiffStyleContext value={diffStyle}>
      <DiffWrapContext value={wrap}>
        <DiffWorkerPoolProvider themes={syntaxTheme}>
          <div
            ref={root}
            className='@container flex h-full min-h-0 flex-col overflow-hidden bg-background'
          >
            {onScopeChange && (
              <div className='flex h-9 shrink-0 items-center border-b border-border pl-2'>
                <ChangesScopePicker value={scope} onChange={onScopeChange} />
              </div>
            )}
            <div className='flex min-h-0 flex-1 flex-col pt-3'>
              <DiffToolbar
                files={files}
                total={models.length}
                pane={pane}
                paneId={paneId}
                onPaneChange={setPane}
                filter={filter}
                onFilter={setFilter}
                inView={inView}
                onSelect={selectFile}
                diffStyle={diffStyle}
                onDiffStyleChange={setDiffStyle}
                toggles={[['Wrap lines', wrap, setWrap]]}
              />
              <DiffFileList
                files={files}
                pane={pane}
                paneId={paneId}
                filter={filter}
                onFilter={setFilter}
                selected={selected}
                inView={inView}
                onInView={setInView}
                onSelect={(path) => {
                  if (path !== active.current) selectFile(path)
                }}
              >
                {files.map((file) => (
                  <DiffFileCard
                    key={file.path}
                    file={file}
                    initiallyNear={file.initiallyNear}
                    open={!collapsedFiles.has(file.path)}
                    collapsed={collapsedFiles.has(file.path)}
                    onToggle={() =>
                      setCollapsedFiles((previous) => {
                        const next = new Set(previous)
                        if (next.has(file.path)) next.delete(file.path)
                        else next.add(file.path)
                        return next
                      })
                    }
                    height={Math.max(80, file.diff.unifiedLineCount * 20 + 32)}
                  >
                    {() =>
                      file.diff.hunks.length === 0 ? (
                        <p className='p-4 text-xs text-muted-foreground'>
                          {file.diff.type === 'rename-pure'
                            ? 'No textual changes · renamed file'
                            : 'Diff not shown'}
                        </p>
                      ) : (
                        <div className='min-w-0 overflow-x-auto'>
                          <DiffBody
                            diff={hydrated.get(file.diff) ?? noContext.get(file.diff) ?? file.diff}
                            loadDiffFiles={loadDiffFiles}
                          />
                        </div>
                      )
                    }
                  </DiffFileCard>
                ))}
                {!files.length && (
                  <p className='p-6 text-xs text-muted-foreground'>No files match this view</p>
                )}
              </DiffFileList>
            </div>
            {footer}
            <svg
              aria-hidden='true'
              className='absolute size-0 overflow-hidden'
              dangerouslySetInnerHTML={{ __html: charmedSprite }}
            />
          </div>
        </DiffWorkerPoolProvider>
      </DiffWrapContext>
    </DiffStyleContext>
  )
}
