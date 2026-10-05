import type { ProjectFile } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { contentKey } from '@/lib/hash'
import { pressProps } from '@/lib/press'
import { useResolvedTheme } from '@/lib/theme'
import { readFileDraft, useFileDirty, useSaveProjectFile, useWriteFileDraft } from '@/state'
import { Editor, type EditorFactory } from '@pierre/diffs/edit'
import { CodeView, EditProvider, type CodeViewHandle } from '@pierre/diffs/react'
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'

import type { FileTarget } from './file_link'

import { diffViewOptions, FileLanguageIcon } from './code_view'
import { environments } from './composer_environment'
import { KeybindTooltip, keybinds } from './keybinds'
import { ScrollOverlay } from './scroll_overlay'

let lastVersion = 0
let answeredFocus = 0

// The active line as a quiet band and a foreground caret, not the theme's selection blue.
// Pierre's find widget is unlayered and unsafeCSS is @layer unsafe, so the overrides are
// !important. 36px is the file header; the panel sticks just under it.
const editorCSS = `
  [data-line][data-editor-active-line], [data-column-number][data-editor-active-line] {
    --diffs-computed-editor-active-line-bg: color-mix(in lab, var(--diffs-bg) 95%, var(--diffs-fg));
  }
  [data-column-number][data-editor-active-line] { color: var(--diffs-fg); }
  [data-caret] { --diffs-bg-caret-override: var(--diffs-fg); }
  [data-search-panel] { top: calc(36px + 8px) !important; }
  [data-search-panel] [data-editor-widget] {
    border: 1px solid var(--border) !important;
    background-color: var(--background) !important;
    box-shadow: none !important;
    border-radius: var(--radius-md) !important;
    color: var(--foreground) !important;
    font-family: var(--font-sans) !important;
    padding: 4px 28px 4px 4px !important;
  }
  [data-input-box] input {
    color: var(--foreground) !important;
    background-color: transparent !important;
    border: 1px solid var(--border) !important;
    border-radius: var(--radius-md) !important;
    font-family: var(--font-sans) !important;
    font-size: 12px !important;
  }
  [data-input-box] input::placeholder { color: var(--muted-foreground) !important; }
  [data-input-box] input:focus-visible { outline: none !important; box-shadow: none !important; }
  [data-matches], [data-matches][data-no-matches] {
    color: var(--muted-foreground) !important;
    font-weight: 400 !important;
  }
  [data-search-icon] {
    color: var(--muted-foreground) !important;
    border-radius: min(var(--radius-md), 8px) !important;
  }
  [data-search-icon]:disabled {
    opacity: 1 !important;
    color: var(--disabled-foreground) !important;
  }
  [data-search-icon]:not(:disabled):hover {
    color: var(--foreground) !important;
    background-color: var(--accent) !important;
  }
  [data-search-icon]:focus-visible {
    outline: none !important;
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent) !important;
  }
  [data-search-icon][aria-pressed="true"] {
    color: var(--foreground) !important;
    background-color: var(--accent) !important;
  }
  [data-search-close] {
    color: var(--muted-foreground) !important;
    background-color: transparent !important;
    border-radius: min(var(--radius-md), 8px) !important;
    top: 4px !important;
    right: 4px !important;
    transform: none !important;
  }
  [data-search-close]:not(:disabled):hover {
    color: var(--foreground) !important;
    background-color: var(--accent) !important;
  }
`

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)

export type Checkout = { environment?: 'local' | 'worktree'; branch?: string; path?: string }

function notUtf8(file: ProjectFile) {
  return 'utf8' in file && file.utf8 === false
}

function diskText(file: ProjectFile) {
  return 'contents' in file ? (file.contents ?? '') : ''
}

// The file as it is in the thread's checkout, edited in place. Edits not yet saved are a draft
// that outlives this view; saving writes only over the text the edits started from, so a file
// that changed on disk meanwhile (agents edit files too) comes back as a conflict, never lost.
export function FileEditor({
  threadId,
  target,
  disk,
  checkout,
  focus,
}: {
  threadId: string
  target: FileTarget
  disk: ProjectFile
  checkout: Checkout
  // a request for the caret, answered once the editor has attached
  focus: number
}) {
  const { path, line } = target
  const name = path.split('/').at(-1) ?? path
  const themeType = useResolvedTheme()
  const options = useMemo(() => {
    const view = diffViewOptions(themeType, {})
    return { ...view, unsafeCSS: `${view.unsafeCSS}${editorCSS}` }
  }, [themeType])
  const save = useSaveProjectFile()
  const writeDraft = useWriteFileDraft()
  const dirty = useFileDirty(threadId, path)
  const readOnly = notUtf8(disk)
  const [opened] = useState(() =>
    notUtf8(disk) ? diskText(disk) : (readFileDraft(threadId, path)?.text ?? diskText(disk))
  )
  // The text as last typed. The draft holds it with the disk text it descends from, and a save
  // settles the draft even when it completes after this view has gone.
  const text = useRef(opened)
  // The document's text from outside, before an editor holds it.
  const [source, setSource] = useState(opened)
  const [conflict, setConflict] = useState<ProjectFile>()
  const [saving, setSaving] = useState(false)
  const writing = useRef(false)
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)

  const base = () => readFileDraft(threadId, path)?.base ?? text.current

  function edited(next: string) {
    if (readOnly) return
    const from = base()
    text.current = next
    writeDraft(threadId, path, { ...readFileDraft(threadId, path), base: from, text: next })
  }

  // Taking the disk's text is one more edit, so ⌘Z brings back what it replaced.
  function adopt(next: string) {
    const editor = viewer.current?.getEditor(path)
    const document = editor?.getEditState()?.document
    const replaced = text.current
    text.current = next
    writeDraft(threadId, path, undefined)
    setConflict(undefined)
    if (document && replaced !== next)
      editor.applyEdits([
        {
          range: { start: { line: 0, character: 0 }, end: document.positionAt(replaced.length) },
          newText: next,
        },
      ])
    else if (!document) setSource(next)
  }

  // Lets go of the edits for the disk's text; a file that's gone or no longer text just drops them.
  function discard(now: ProjectFile) {
    if ('contents' in now && now.contents !== null) return adopt(now.contents)
    writeDraft(threadId, path, undefined)
  }

  const diskChanged = useEffectEvent((now: ProjectFile) => {
    if (notUtf8(now)) {
      const nowText = diskText(now)
      if (nowText !== text.current) adopt(nowText)
      else if (readFileDraft(threadId, path)) writeDraft(threadId, path, undefined)
      setConflict(undefined)
      return
    }
    const nowText = 'contents' in now ? now.contents : undefined
    const from = base()
    if (nowText === from) {
      const draft = readFileDraft(threadId, path)
      if (draft?.unverified) writeDraft(threadId, path, { base: draft.base, text: draft.text })
      setConflict(undefined)
    } else if (typeof nowText === 'string' && nowText === text.current) {
      writeDraft(threadId, path, undefined)
      setConflict(undefined)
    } else if (
      typeof nowText === 'string' &&
      text.current === from &&
      !readFileDraft(threadId, path)
    )
      adopt(nowText)
    else setConflict(now)
  })
  useEffect(() => diskChanged(disk), [disk])

  async function write(contents: string, over: string | null) {
    if (writing.current) return
    writing.current = true
    setSaving(true)
    try {
      const result = await save(threadId, path, contents, over)
      if (result) setConflict('conflict' in result ? result.conflict : undefined)
    } finally {
      writing.current = false
      setSaving(false)
    }
  }

  function saveNow() {
    if (readOnly) return
    if (dirty || conflict) void write(text.current, base())
  }

  const root = useRef<HTMLElement>(null)
  const saveKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 's' || !(event.metaKey || event.ctrlKey) || event.altKey) return
    event.preventDefault()
    saveNow()
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    element.addEventListener('keydown', saveKey)
    return () => element.removeEventListener('keydown', saveKey)
  }, [])

  // The view that asked (now inert) dropped focus; the editor attaches a few frames after mount.
  // Focus the reader has since put somewhere live stays there.
  useEffect(() => {
    if (focus <= answeredFocus) return
    if (readOnly) {
      answeredFocus = focus
      return
    }
    let frame = 0
    let frames = 0
    function place() {
      const at = document.activeElement
      const lost = !at || at === document.body || !!at.closest('[inert]')
      if (!lost || root.current?.contains(at) || ++frames > 60) {
        answeredFocus = focus
        return
      }
      viewer.current?.getEditor(path)?.focus()
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [focus, path, readOnly])

  // CodeView takes new file contents as an outside edit to the document, so they change only on
  // purpose; its own edits stay in the editor.
  const items = useMemo(
    () => [
      {
        id: path,
        type: 'file' as const,
        file: { name: path, contents: source, cacheKey: `${path}:${contentKey(source)}` },
        edit: !readOnly,
        // CodeView only re-reads an item when its version changes.
        version: ++lastVersion,
      },
    ],
    [path, source, readOnly]
  )
  const selectedLines = useMemo(
    () => (line ? { id: path, range: { start: line, end: line } } : null),
    [path, line]
  )
  const viewport = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (line)
      viewer.current?.scrollTo({
        type: 'line',
        id: path,
        lineNumber: line,
        align: 'center',
        behavior: 'instant',
      })
  }, [target, path, line])
  const place = checkout.environment && environments[checkout.environment]
  return (
    <section
      ref={root}
      id={id}
      aria-label={path}
      className='file-changes-viewer relative isolate flex h-full min-h-0 flex-col bg-background'
    >
      {conflict && !readOnly && (
        <ConflictBar
          name={name}
          disk={conflict}
          busy={saving}
          onDiscard={() => discard(conflict)}
          onOverwrite={(over) => void write(text.current, over)}
        />
      )}
      {/* The scrollbar overlays the code only, never the conflict bar above it. */}
      <div className='relative flex min-h-0 flex-1 flex-col'>
        <EditProvider createEditor={createEditor}>
          <CodeView
            ref={viewer}
            containerRef={viewport}
            items={items}
            options={options}
            selectedLines={selectedLines}
            renderHeaderPrefix={() => (
              <span className='inline-flex size-7 items-center justify-center [--file-icon-opacity:1]'>
                <FileLanguageIcon path={path} />
              </span>
            )}
            renderHeaderMetadata={() => (
              <span className='flex items-center gap-2'>
                {readOnly && (
                  <span className='text-xs text-muted-foreground select-none'>
                    Read-only · not UTF-8
                  </span>
                )}
                {place && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className='flex cursor-default items-center gap-1.5 text-xs text-muted-foreground select-none' />
                      }
                    >
                      <place.Icon className='size-3 shrink-0' />
                      {place.label}
                    </TooltipTrigger>
                    <TooltipContent align='end' className='max-w-lg'>
                      <span className='flex flex-col'>
                        <span>
                          Saves to the{' '}
                          {checkout.environment === 'worktree'
                            ? "thread's worktree"
                            : 'project checkout'}
                          {checkout.branch && (
                            <>
                              {' on '}
                              <span className='font-mono'>{checkout.branch}</span>
                            </>
                          )}
                        </span>
                        {checkout.path && (
                          <span className='font-mono text-muted-foreground'>{checkout.path}</span>
                        )}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                )}
                {dirty && !readOnly && (
                  <Button
                    variant='ghost-text'
                    size='xs'
                    disabled={saving}
                    title='Go back to the file on disk (⌘Z undoes this)'
                    onClick={() => discard(disk)}
                  >
                    Discard
                  </Button>
                )}
                {dirty && !readOnly && (
                  <KeybindTooltip binding={keybinds.save}>
                    <Button
                      variant='ghost'
                      size='xs'
                      disabled={saving}
                      aria-keyshortcuts='Meta+S'
                      {...pressProps(saveNow)}
                    >
                      Save
                    </Button>
                  </KeybindTooltip>
                )}
              </span>
            )}
            onItemEditChange={(event) => edited(event.file.contents)}
            className='diff-scroll-viewport min-h-0 flex-1 overflow-auto'
          />
        </EditProvider>
        <ScrollOverlay viewport={viewport} controls={id} />
      </div>
    </section>
  )
}

// The file changed on disk under the edits: take the disk's text (undoable), or write over it. A
// file that's gone can be saved again; one that's no longer text can only be let go.
function ConflictBar({
  name,
  disk,
  busy,
  onDiscard,
  onOverwrite,
}: {
  name: string
  disk: ProjectFile
  busy: boolean
  onDiscard: () => void
  onOverwrite: (over: string | null) => void
}) {
  const text = 'contents' in disk ? disk.contents : undefined
  return (
    <div
      role='alert'
      className='flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4 py-1.5 text-xs'
    >
      <span className='min-w-0 flex-1 truncate'>
        {text === null
          ? `${name} was deleted on disk`
          : text === undefined
            ? `${name} on disk is no longer text`
            : `${name} changed on disk`}
        <span className='text-muted-foreground'> while you were editing</span>
      </span>
      <Button variant='ghost-text' size='xs' disabled={busy} onClick={onDiscard}>
        {typeof text === 'string' ? 'Reload' : 'Discard mine'}
      </Button>
      {text !== undefined && (
        <Button variant='outline' size='xs' disabled={busy} onClick={() => onOverwrite(text)}>
          {text === null ? 'Save anyway' : 'Overwrite'}
        </Button>
      )}
    </div>
  )
}
