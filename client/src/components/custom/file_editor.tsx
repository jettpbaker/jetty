import type { ProjectFile } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { contentKey } from '@/lib/hash'
import { pressProps } from '@/lib/press'
import { useResolvedTheme } from '@/lib/theme'
import { readFileDraft, useSaveProjectFile, useWriteFileDraft } from '@/state'
import { Editor, type EditorFactory } from '@pierre/diffs/edit'
import { CodeView, EditProvider, type CodeViewHandle } from '@pierre/diffs/react'
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'

import type { FileTarget } from './file_link'

import { diffViewOptions, FileLanguageIcon } from './code_view'
import { environments } from './composer_environment'
import { KeybindTooltip, keybinds } from './keybinds'
import { ScrollOverlay } from './scroll_overlay'

let lastVersion = 0

// The active line as a quiet band and a foreground caret, not the theme's selection blue.
const editorCSS = `
  [data-line][data-editor-active-line], [data-column-number][data-editor-active-line] {
    --diffs-computed-editor-active-line-bg: color-mix(in lab, var(--diffs-bg) 95%, var(--diffs-fg));
  }
  [data-column-number][data-editor-active-line] { color: var(--diffs-fg); }
  [data-caret] { --diffs-bg-caret-override: var(--diffs-fg); }
`

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)

export type Checkout = { environment?: 'local' | 'worktree'; branch?: string; path?: string }

// The file as it is in the thread's checkout, edited in place. Edits not yet saved are a draft
// that outlives this view; saving writes only over the text the edits started from, so a file
// that changed on disk meanwhile (agents edit files too) comes back as a conflict, never lost.
export function FileEditor({
  threadId,
  target,
  disk,
  checkout,
}: {
  threadId: string
  target: FileTarget
  disk: ProjectFile
  checkout: Checkout
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
  const [opened] = useState(() => {
    const text = 'contents' in disk ? (disk.contents ?? '') : ''
    return readFileDraft(threadId, path) ?? { base: text, text }
  })
  // The disk text the edits descend from, and the text as last typed.
  const base = useRef(opened.base)
  const text = useRef(opened.text)
  // The document's text from outside, before an editor holds it.
  const [source, setSource] = useState(opened.text)
  const [dirty, setDirty] = useState(opened.text !== opened.base)
  const [conflict, setConflict] = useState<ProjectFile>()
  const [saving, setSaving] = useState(false)
  const writing = useRef(false)
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)

  function storeDraft() {
    writeDraft(
      threadId,
      path,
      text.current === base.current ? undefined : { base: base.current, text: text.current }
    )
  }

  function edited(next: string) {
    text.current = next
    setDirty(next !== base.current)
    storeDraft()
  }

  // Taking the disk's text is one more edit, so ⌘Z brings back what it replaced.
  function adopt(next: string) {
    base.current = next
    const editor = viewer.current?.getEditor(path)
    const document = editor?.getEditState()?.document
    if (document && text.current !== next)
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: document.positionAt(text.current.length),
          },
          newText: next,
        },
      ])
    else if (!document) setSource(next)
    text.current = next
    setDirty(false)
    setConflict(undefined)
    storeDraft()
  }

  // Lets go of the edits for the disk's text; a file that's gone or no longer text just drops them.
  function discard(now: ProjectFile) {
    if ('contents' in now && now.contents !== null) return adopt(now.contents)
    text.current = base.current
    storeDraft()
  }

  function settle(saved: string) {
    base.current = saved
    setDirty(text.current !== saved)
    setConflict(undefined)
    storeDraft()
  }

  const diskChanged = useEffectEvent((now: ProjectFile) => {
    const nowText = 'contents' in now ? now.contents : undefined
    if (nowText === base.current) setConflict(undefined)
    else if (typeof nowText === 'string' && nowText === text.current) settle(nowText)
    else if (typeof nowText === 'string' && text.current === base.current) adopt(nowText)
    else setConflict(now)
  })
  useEffect(() => diskChanged(disk), [disk])

  async function write(contents: string, over: string | null) {
    if (writing.current) return
    writing.current = true
    setSaving(true)
    try {
      const result = await save(threadId, path, contents, over)
      if (result && 'saved' in result) settle(contents)
      else if (result) setConflict(result.conflict)
    } finally {
      writing.current = false
      setSaving(false)
    }
  }

  function saveNow() {
    if (dirty || conflict) void write(text.current, base.current)
  }

  const root = useRef<HTMLElement>(null)
  const saveKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 's' || !(event.metaKey || event.ctrlKey) || event.altKey) return
    event.preventDefault()
    saveNow()
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    element.addEventListener('keydown', saveKey)
    return () => element.removeEventListener('keydown', saveKey)
  }, [])

  // CodeView takes new file contents as an outside edit to the document, so they change only on
  // purpose; its own edits stay in the editor.
  const items = useMemo(
    () => [
      {
        id: path,
        type: 'file' as const,
        file: { name: path, contents: source, cacheKey: `${path}:${contentKey(source)}` },
        edit: true,
        // CodeView only re-reads an item when its version changes.
        version: ++lastVersion,
      },
    ],
    [path, source]
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
      {conflict && (
        <ConflictBar
          name={name}
          disk={conflict}
          busy={saving}
          onDiscard={() => discard(conflict)}
          onOverwrite={(over) => void write(text.current, over)}
        />
      )}
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
              {dirty && (
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
              {dirty && (
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
      className='flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 py-1.5 pr-2 pl-3 text-xs'
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
