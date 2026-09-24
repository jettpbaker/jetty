import type { CodeViewOptions, FileDiffLoadedFiles, FileDiffMetadata } from '@pierre/diffs'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useResolvedTheme } from '@/lib/theme'
import { CaretDownIcon, CaretRightIcon, SidebarIcon } from '@phosphor-icons/react'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { DisabledTooltip } from './disabled_tooltip'
import {
  diffItem,
  hydratedDiff,
  loadedFiles,
  patchMatchesContents,
  withoutContext,
  type FileChange,
  type LoadDiffFile,
} from './file_diff_model'
import { ScrollOverlay } from './scroll_overlay'
import './file_changes_viewer.css'

// Matches menu items (`h-menu-item-compact`).
const treeRowHeight = 26
const filePrefetchConcurrency = 4
// Phosphor CaretDown (bold). trees.software rotates the chevron slot -90deg when collapsed, so one glyph covers both states.
const treeCaretSprite =
  '<svg aria-hidden="true" width="0" height="0"><symbol id="jetty-caret-down" viewBox="0 0 256 256"><path fill="currentColor" d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"/></symbol><symbol id="jetty-empty" viewBox="0 0 6 6"></symbol></svg>'
const treeIcons = {
  set: 'complete',
  colored: true,
  spriteSheet: treeCaretSprite,
  remap: {
    'file-tree-icon-chevron': {
      name: 'jetty-caret-down',
      width: 12,
      height: 12,
      viewBox: '0 0 256 256',
    },
    // Every folder in a PR tree contains changes, so the "has changes" dot carries no information.
    'file-tree-icon-dot': { name: 'jetty-empty', width: 6, height: 6, viewBox: '0 0 6 6' },
  },
} as const
// `unsafeCSS` is the library's documented escape hatch (@layer unsafe). Sidebar rows keep label text in
// --foreground and only colour the trailing status mark, so undo the library's label tint.
const treeUnsafeCSS = [
  '[role="treeitem"][data-item-focused="true"]:not(:focus-visible)::before { outline: none; }',
  '[data-item-git-status] > [data-item-section="content"] { color: inherit; }',
  '[data-item-section="git"] { font-size: var(--text-xs); }',
  // A flattened directory chain reads as one path truncated at its end, not a truncation per segment.
  '[data-item-flattened-subitems] { display: inline; white-space: nowrap; }',
  '[data-item-flattened-subitem] :is([data-truncate-container], [data-truncate-grid], [data-truncate-grid] > :first-child, [data-truncate-content="visible"]) { display: contents; }',
  '[data-item-flattened-subitem] :is([data-truncate-content="overflow"], [data-truncate-marker-cell]) { display: none; }',
].join('\n')
const separatorUnsafeCSS = `
  [data-separator="line-info"] {
    height: 26px;
    min-height: 26px;
    margin-block: 0;
    box-sizing: border-box;
    background: transparent;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  [data-separator="line-info"] [data-separator-wrapper],
  [data-separator="line-info"] [data-separator-content],
  [data-separator="line-info"] [data-expand-button] {
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    min-width: 0;
    min-height: 0;
    padding: 0;
    margin: 0;
  }
  [data-separator="line-info"] [data-separator-wrapper] {
    position: absolute;
    inset: 0;
    width: auto;
    display: flex;
    align-items: center;
    height: 100%;
  }
  [data-separator="line-info"] [data-expand-all-button] { display: none; }
  [data-separator="line-info"] [data-expand-up] [data-icon] { transform: scaleY(-1); }
  [data-separator="line-info"] [data-expand-down] [data-icon] { transform: none; }
  [data-gutter] [data-separator="line-info"] [data-separator-wrapper] {
    justify-content: center;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding-left: 2ch;
    padding-right: 1ch;
  }
  [data-gutter] [data-separator="line-info"] [data-separator-content] { display: none; }
  [data-gutter] [data-separator="line-info"] [data-expand-button]:not([data-expand-all-button]) {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    width: 16px;
    height: 16px;
    color: var(--muted-foreground);
  }
  [data-gutter] [data-separator-wrapper][data-separator-multi-button] [data-expand-button]:not([data-expand-all-button]) {
    height: 10px;
  }
  [data-gutter] [data-separator-wrapper][data-separator-multi-button] [data-expand-down] {
    margin-top: -2px;
  }
  [data-gutter] [data-separator="line-info"] [data-expand-button] svg {
    width: 12px;
    height: 12px;
  }
  [data-additions] [data-gutter] [data-separator="line-info"] [data-expand-button] { display: none; }
  [data-content] [data-separator="line-info"] [data-separator-wrapper] {
    justify-content: flex-start;
    padding-inline: 1ch;
    width: 100%;
  }
  [data-content] [data-separator="line-info"] [data-expand-button] { display: none; }
  [data-content] [data-separator="line-info"] [data-separator-content] {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    gap: 1ch;
    font-size: var(--text-xs);
    text-decoration: none;
  }
  [data-content] [data-separator="line-info"] [data-separator-content]::before,
  [data-content] [data-separator="line-info"] [data-separator-content]::after {
    content: "";
    height: 0.5px;
    background-color: var(--muted-foreground);
  }
  [data-content] [data-separator="line-info"] [data-separator-content]::before {
    flex: none;
    width: 12px;
  }
  [data-content] [data-separator="line-info"] [data-separator-content]::after {
    flex: 1 1 auto;
    min-width: 1ch;
  }
  [data-content] [data-unmodified-lines] {
    flex: none;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }
  [data-additions] [data-content] [data-separator-content] { display: none; }
  [data-separator="line-info"][data-row-hover] {
    background-color: var(--accent);
    color: var(--foreground);
    fill: currentColor;
  }
  [data-gutter] [data-separator="line-info"][data-row-hover] [data-expand-button]:not([data-expand-all-button]),
  [data-separator="line-info"][data-row-hover] [data-expand-up],
  [data-separator="line-info"][data-row-hover] [data-expand-down],
  [data-separator="line-info"][data-row-hover] [data-expand-both],
  [data-separator="line-info"][data-row-hover] [data-unmodified-lines] {
    color: var(--foreground);
    fill: currentColor;
  }
  [data-gutter] [data-separator="line-info"][data-row-hover] [data-expand-button] svg,
  [data-gutter] [data-separator="line-info"][data-row-hover] [data-icon] {
    color: var(--foreground);
    fill: currentColor;
  }
`

export function diffViewOptions(
  themeType: 'light' | 'dark',
  {
    split = false,
    loadDiffFiles,
    lineNumbers = true,
  }: {
    split?: boolean
    loadDiffFiles?: CodeViewOptions<undefined, undefined>['loadDiffFiles']
    lineNumbers?: boolean
  }
): CodeViewOptions<undefined, undefined> {
  return {
    diffStyle: split ? 'split' : 'unified',
    theme: { light: 'pierre-light-soft', dark: 'pierre-dark-soft' },
    themeType,
    stickyHeaders: true,
    itemMetrics: {
      diffHeaderHeight: 36,
      lineHeight: 20,
      hunkSeparatorHeight: lineNumbers ? 26 : 4,
    },
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    hunkSeparators: lineNumbers ? 'line-info' : 'simple',
    disableLineNumbers: !lineNumbers,
    expansionLineCount: 20,
    loadDiffFiles,
    unsafeCSS: `
      [data-diffs-header] { height: 36px; min-height: 36px; box-sizing: border-box; background-color: var(--background); border-bottom: 1px solid var(--border); }
      [data-diffs-header]::before {
        content: ''; position: absolute; inset: -1px 0 auto; height: 1px; pointer-events: none;
        background: linear-gradient(var(--border), var(--border)), var(--background);
      }
      [data-diffs-header] [data-change-icon] { display: none; }
      [data-diffs-header]:hover { --file-icon-opacity: 0; --file-chevron-opacity: 1; }
      ${separatorUnsafeCSS}
    `,
    overflow: split ? 'wrap' : 'scroll',
  }
}

export function useCollapsedFiles(initial: () => Set<string>) {
  const [collapsedFiles, setCollapsedFiles] = useState(initial)
  const renderFilePrefix = useCallback(
    (item: { id: string; collapsed?: boolean }) => (
      <FileCollapseButton
        path={item.id}
        collapsed={item.collapsed ?? false}
        onToggle={() =>
          setCollapsedFiles((previous) => {
            const next = new Set(previous)
            if (next.has(item.id)) next.delete(item.id)
            else next.add(item.id)
            return next
          })
        }
      />
    ),
    []
  )
  const expand = useCallback(
    (path: string) =>
      setCollapsedFiles((previous) => {
        if (!previous.has(path)) return previous
        const next = new Set(previous)
        next.delete(path)
        return next
      }),
    []
  )
  return { collapsedFiles, renderFilePrefix, expand }
}

function separatorFromEvent(event: PointerEvent) {
  for (const node of event.composedPath()) {
    if (
      node instanceof Element &&
      node.getAttribute('data-separator') === 'line-info' &&
      node.hasAttribute('data-expand-index')
    ) {
      return node
    }
  }
  return null
}

export function FileChangesViewer({
  files: changes,
  footer,
  embedded = false,
  layout = 'panel',
  loadFile,
  reveal,
}: {
  files: FileChange[]
  footer?: ReactNode
  embedded?: boolean
  layout?: 'panel' | 'page'
  loadFile?: LoadDiffFile
  reveal?: { path: string }
}) {
  const resolvedTheme = useResolvedTheme()
  const { collapsedFiles, renderFilePrefix, expand } = useCollapsedFiles(() => new Set())
  const [noContext, setNoContext] = useState<ReadonlyMap<FileDiffMetadata, FileDiffMetadata>>(
    () => new Map()
  )
  const [hydrated, setHydrated] = useState<ReadonlyMap<FileDiffMetadata, FileDiffMetadata>>(
    () => new Map()
  )
  const scrollViewport = useRef<HTMLDivElement>(null)
  const scrollId = useId()
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const items = useMemo(
    () =>
      changes.map((file) =>
        diffItem(
          file.path,
          hydrated.get(file.diff) ?? noContext.get(file.diff) ?? file.diff,
          collapsedFiles.has(file.path)
        )
      ),
    [changes, collapsedFiles, hydrated, noContext]
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
            setHydrated((previous) => new Map(previous).set(diff, hydratedDiff(diff, files)))
            return files
          })
          .catch((error) => {
            setNoContext((previous) => new Map(previous).set(diff, withoutContext(diff)))
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
  const selectFile = useCallback((path: string) => {
    setSelected(path)
    viewer.current?.scrollTo({ type: 'item', id: path, align: 'start', behavior: 'instant' })
  }, [])
  const [selected, setSelected] = useState(changes[0]?.path)
  useEffect(() => {
    if (!reveal) return
    expand(reveal.path)
    selectFile(reveal.path)
  }, [reveal, expand, selectFile])
  const [treeOpen, setTreeOpen] = useState(layout === 'page')
  const treeId = useId()
  const treeToggle = (
    <Button
      variant='ghost-text'
      size='icon-sm'
      className="aria-expanded:text-muted-foreground enabled:hover:aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-4"
      aria-label={treeOpen ? 'Collapse file tree' : 'Expand file tree'}
      aria-expanded={treeOpen}
      aria-controls={treeId}
      onClick={() => setTreeOpen((open) => !open)}
    >
      <SidebarIcon mirrored={layout === 'panel'} />
    </Button>
  )
  const [mode, setMode] = useState('unified')
  const [wide, setWide] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const file = changes.find((entry) => entry.path === selected) ?? changes[0]
  const split = wide && mode === 'split'
  const diffOptions = useMemo(
    () => diffViewOptions(resolvedTheme, { split, loadDiffFiles }),
    [split, resolvedTheme, loadDiffFiles]
  )
  useLayoutEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => setWide(entry!.contentRect.width >= 900))
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const node = root.current
    if (!node) return
    const painted: Element[] = []
    function clear() {
      for (const row of painted) row.removeAttribute('data-row-hover')
      painted.length = 0
    }
    function paint(separator: Element) {
      const index = separator.getAttribute('data-expand-index')
      const container = separator.closest('[data-code]')
      if (index == null || !container) return
      clear()
      for (const row of container.querySelectorAll(
        `[data-separator="line-info"][data-expand-index="${CSS.escape(index)}"]`
      )) {
        row.setAttribute('data-row-hover', '')
        painted.push(row)
      }
    }
    function prefetch(separator: Element) {
      const shadow = separator.getRootNode()
      if (!(shadow instanceof ShadowRoot)) return
      const item = viewer.current
        ?.getInstance()
        ?.getRenderedItems()
        .find((rendered) => rendered.element === shadow.host)
      if (item?.type === 'diff' && item.item.fileDiff.isPartial)
        void loadDiffFiles?.(item.item.fileDiff)
    }
    function onMove(event: PointerEvent) {
      const separator = separatorFromEvent(event)
      if (separator && painted.includes(separator)) return
      if (!separator) {
        clear()
        return
      }
      prefetch(separator)
      paint(separator)
    }
    function onLeave() {
      clear()
    }
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      clear()
    }
  }, [file, loadDiffFiles])
  if (!file) return <p className='p-4 text-sm text-muted-foreground'>No changed files.</p>
  return (
    <div
      ref={root}
      data-embedded={embedded}
      data-layout={layout}
      className='file-changes-viewer overflow-hidden border border-border bg-background'
    >
      <header
        className={`flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border ${layout === 'page' ? 'px-6' : 'pl-2 pr-3'}`}
      >
        <div className='flex min-w-0 items-center gap-2 text-xs'>
          {layout === 'page' && treeToggle}
          {layout === 'panel' && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label='Diff scope: Uncommitted'
                render={
                  <Button variant='ghost' tone='muted' size='sm' className='rounded-sm px-1' />
                }
              >
                Uncommitted
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-max min-w-32'>
                <DropdownMenuRadioGroup value='uncommitted'>
                  <DisabledTooltip reason='Coming soon' side='right'>
                    <DropdownMenuRadioItem value='branch' disabled>
                      Branch
                    </DropdownMenuRadioItem>
                  </DisabledTooltip>
                  <DropdownMenuRadioItem value='uncommitted'>Uncommitted</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <Tabs
            value={split ? 'split' : 'unified'}
            onValueChange={(value) => {
              if (value === 'unified' || value === 'split') setMode(value)
            }}
          >
            <TabsList variant='line' aria-label='Diff layout' className='h-7 gap-1 p-0'>
              <TabsTrigger
                value='unified'
                className='details-header-tab h-auto rounded-sm px-2 py-1 text-xs'
                aria-label='Unified diff'
              >
                Unified
              </TabsTrigger>
              <DisabledTooltip
                reason={wide ? undefined : 'Widen the viewer to use split diff'}
                wrap='inline-flex'
              >
                <TabsTrigger
                  value='split'
                  className='details-header-tab h-auto rounded-sm px-2 py-1 text-xs disabled:pointer-events-auto disabled:cursor-not-allowed aria-disabled:pointer-events-auto aria-disabled:cursor-not-allowed aria-disabled:hover:text-muted-foreground dark:aria-disabled:hover:text-muted-foreground'
                  disabled={!wide}
                  aria-label='Split diff'
                >
                  Split
                </TabsTrigger>
              </DisabledTooltip>
            </TabsList>
          </Tabs>
          {layout === 'panel' && treeToggle}
        </div>
      </header>
      <div className='file-changes-body' data-tree-open={treeOpen}>
        <section
          id={scrollId}
          aria-label='File diffs'
          className='relative isolate flex min-h-0 min-w-0 flex-col'
        >
          <CodeView
            ref={viewer}
            containerRef={scrollViewport}
            items={items}
            className='diff-scroll-viewport min-h-0 flex-1 overflow-auto'
            options={diffOptions}
            renderHeaderPrefix={renderFilePrefix}
          />
          <ScrollOverlay viewport={scrollViewport} controls={scrollId} />
          {footer}
        </section>
        <nav
          id={treeId}
          inert={!treeOpen}
          aria-hidden={!treeOpen || undefined}
          aria-label='Changed files'
          className='file-changes-list min-h-0 min-w-0 overflow-hidden'
        >
          <div className='file-changes-list-pane'>
            <ChangedFilesTree
              key={changes.map(({ path, status }) => `${status}:${path}`).join()}
              files={changes}
              selected={file.path}
              onSelect={selectFile}
            />
          </div>
        </nav>
      </div>
    </div>
  )
}

function ChangedFilesTree({
  files,
  selected,
  onSelect,
}: {
  files: FileChange[]
  selected: string
  onSelect: (path: string) => void
}) {
  const { model } = useFileTree({
    paths: files.map((file) => file.path),
    initialExpansion: 'open',
    itemHeight: treeRowHeight,
    icons: treeIcons,
    unsafeCSS: treeUnsafeCSS,
    initialSelectedPaths: [selected],
    gitStatus: files.map(({ path, status }) => ({ path, status })),
    onSelectionChange: (paths) => {
      const path = paths.findLast((path) => files.some((file) => file.path === path))
      if (path) onSelect(path)
    },
  })
  return (
    <FileTree
      model={model}
      className='changed-files-tree h-full w-full'
      onPointerMove={(event) => {
        const row = event.nativeEvent
          .composedPath()
          .find((node) => node instanceof HTMLElement && node.dataset.type === 'item')
        event.currentTarget.title =
          (row instanceof HTMLElement && row.dataset.itemPath?.replace(/\/$/, '')) || ''
      }}
    />
  )
}

const fileIconResolver = createFileTreeIconResolver('standard')
const fileIconSprite = getBuiltInSpriteSheet('standard')

function FileCollapseButton({
  path,
  collapsed,
  onToggle,
}: {
  path: string
  collapsed: boolean
  onToggle: () => void
}) {
  const icon = fileIconResolver.resolveIcon('file-tree-icon-file', path)
  const iconMarkup = useMemo(() => {
    const start = fileIconSprite.indexOf(`<symbol id="${icon.name}"`)
    if (start < 0) return ''
    const end = fileIconSprite.indexOf('</symbol>', start)
    return fileIconSprite
      .slice(start, end + 9)
      .replace(`<symbol id="${icon.name}"`, '<svg')
      .replace('</symbol>', '</svg>')
  }, [icon.name])
  const Chevron = collapsed ? CaretDownIcon : CaretRightIcon
  return (
    <Button
      variant='ghost-text'
      size='icon'
      className='file-collapse-button relative aria-expanded:text-muted-foreground'
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${path}`}
      aria-expanded={!collapsed}
      onClick={onToggle}
      data-collapsed={collapsed}
    >
      <span
        className='file-language-icon absolute size-5'
        data-language={icon.token}
        aria-hidden='true'
        dangerouslySetInnerHTML={{ __html: iconMarkup }}
      />
      <Chevron className='file-collapse-chevron absolute' aria-hidden='true' />
    </Button>
  )
}
