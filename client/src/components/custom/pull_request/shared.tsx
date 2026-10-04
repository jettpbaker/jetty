import { Loading } from '@/components/custom/loading'
import { Markdown } from '@/components/custom/markdown'
import { PersonAvatar } from '@/components/custom/person_avatar'
import { contentKey } from '@/lib/hash'
import { cn } from '@/lib/utils'
import { parseDiffFromFile, type DiffLineAnnotation, type FileDiffMetadata } from '@pierre/diffs'
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import type { PrComment, PrFile, PrThread } from './adapter'

import { DiffBody } from '../diff/body'
import {
  hydratedDiff,
  loadedFiles,
  parseFileChanges,
  patchMatchesContents,
  withoutContext,
} from '../file_diff_model'
import { ago, filePatch, personName, visibleLines } from './model'
import { PrDiffLoaderContext, PrDiffRevisionContext } from './runtime'

// A relative time, set apart from the sentence before it without a dot: faint on the page, muted on a
// raised card, where faint is too faint.
export function Ago({ at, raised = false }: { at: string; raised?: boolean }) {
  return (
    <span className={raised ? 'text-muted-foreground' : 'text-faint-foreground'}>{ago(at)}</span>
  )
}

export function Section({
  title,
  className,
  action,
  children,
}: {
  title: string
  className?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className='flex h-4 items-center justify-between'>
        <h3 className='text-xs font-medium text-muted-foreground'>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}
export { DiffCounts as Counts } from '../diff/file_card'

export function Diff({
  file,
  patch,
  threads = [],
  renderThreads,
  suggestion = false,
  snippet = false,
}: {
  file: PrFile
  patch?: string
  threads?: PrThread[]
  renderThreads?: (threads: PrThread[]) => ReactNode
  suggestion?: boolean
  snippet?: boolean
}) {
  const revision = useContext(PrDiffRevisionContext)
  const hasPatch = patch === undefined ? file.patch : patch
  const text = filePatch(file, patch)
  const parsed = useMemo(
    () =>
      hasPatch ? parseFileChanges(text, `${revision}:${contentKey(text)}`)[0]?.diff : undefined,
    [text, revision, hasPatch]
  )
  const loadFile = useContext(PrDiffLoaderContext)
  const [deferred, setDeferred] = useState<{
    revision: string
    diff?: FileDiffMetadata
    error?: string
  }>()
  useEffect(() => {
    if (!file.patchDeferred || !loadFile || patch !== undefined) return
    let active = true
    loadFile(file.path, file.previousPath)
      .then((contents) => {
        if (!active) return
        if ('unavailable' in contents) {
          setDeferred({ revision, error: `Diff unavailable: ${contents.unavailable}` })
          return
        }
        const oldFile =
          contents.before === null
            ? null
            : {
                name: file.previousPath ?? file.path,
                contents: contents.before,
                cacheKey: `${revision}:${file.path}:before`,
              }
        const newFile =
          contents.after === null
            ? null
            : {
                name: file.path,
                contents: contents.after,
                cacheKey: `${revision}:${file.path}:after`,
              }
        const diff = parseDiffFromFile(oldFile, newFile)
        diff.cacheKey ??= `${revision}:${file.path}`
        setDeferred({ revision, diff })
      })
      .catch(() => active && setDeferred({ revision, error: 'Diff unavailable' }))
    return () => {
      active = false
    }
  }, [file.patchDeferred, file.path, file.previousPath, loadFile, patch, revision])
  const loaded = deferred?.revision === revision ? deferred : undefined
  const diff = parsed ?? loaded?.diff
  const loadDiffFiles = useMemo(() => {
    if (!loadFile || suggestion || patch !== undefined) return undefined
    return async (diff: import('@pierre/diffs').FileDiffMetadata) => {
      try {
        const contents = await loadFile(file.path, file.previousPath)
        if ('unavailable' in contents)
          throw new Error(`Diff context unavailable: ${contents.unavailable}`)
        if (!patchMatchesContents(diff, contents))
          throw new Error('Diff context no longer matches this patch')
        return loadedFiles(diff, contents)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not load diff context')
        throw error
      }
    }
  }, [loadFile, file.path, file.previousPath, suggestion, patch])
  // A mounted body fetches its file's contents, as the Changes view does, so folds and the trailing
  // context are exact rather than "may be available"; without them the hunks render bare.
  const [context, setContext] = useState<{ diff: FileDiffMetadata; shown: FileDiffMetadata }>()
  useEffect(() => {
    if (!loadFile || suggestion || patch !== undefined || !diff?.isPartial) return
    if (diff.type !== 'change' && diff.type !== 'rename-changed') return
    let active = true
    loadFile(file.path, file.previousPath).then(
      (contents) => {
        if (!active) return
        const usable = !('unavailable' in contents) && patchMatchesContents(diff, contents)
        setContext({
          diff,
          shown: usable ? hydratedDiff(diff, loadedFiles(diff, contents)) : withoutContext(diff),
        })
      },
      () => active && setContext({ diff, shown: withoutContext(diff) })
    )
    return () => {
      active = false
    }
  }, [loadFile, suggestion, patch, diff, file.path, file.previousPath])
  const shown = context && context.diff === diff ? context.shown : diff
  const threadPatch = patch ?? file.patch
  const lines = useMemo(() => {
    const lines = {
      LEFT: visibleLines({ status: 'removed', patch: threadPatch }),
      RIGHT: visibleLines({ status: 'modified', patch: threadPatch }),
    }
    if (threadPatch || !file.patchDeferred || !diff) return lines
    for (const hunk of diff.hunks) {
      for (let line = hunk.deletionStart; line < hunk.deletionStart + hunk.deletionCount; line++)
        lines.LEFT.add(line)
      for (let line = hunk.additionStart; line < hunk.additionStart + hunk.additionCount; line++)
        lines.RIGHT.add(line)
    }
    return lines
  }, [threadPatch, file.patchDeferred, diff])
  const showResolved = !!renderThreads
  const anchored = useMemo(
    () =>
      threads.filter(
        (thread) =>
          (showResolved || !thread.resolved) &&
          !thread.outdated &&
          thread.line !== null &&
          lines[thread.side].has(thread.line)
      ),
    [threads, lines, showResolved]
  )
  const annotations: DiffLineAnnotation<PrThread[]>[] = [
    ...new Set(anchored.map((t) => `${t.side}:${t.line}`)),
  ].map((key) => {
    const [side, line] = key.split(':')
    return {
      side: side === 'LEFT' ? 'deletions' : 'additions',
      lineNumber: Number(line),
      metadata: anchored.filter((t) => t.side === side && t.line === Number(line)),
    }
  })
  const remaining = threads.filter((t) => !anchored.includes(t))
  const unavailable = file.binary
    ? 'Binary file · preview unavailable'
    : file.patchDeferred && !diff
      ? (loaded?.error ?? 'Loading diff…')
      : !hasPatch && !diff
        ? file.status === 'renamed' && file.changes === 0
          ? 'No textual changes · renamed file'
          : 'Diff unavailable'
        : !diff
          ? 'Diff unavailable'
          : undefined
  if (unavailable)
    return (
      <div className='min-w-0 overflow-x-auto'>
        {unavailable === 'Loading diff…' ? (
          <Loading label={unavailable} />
        ) : (
          <p className='p-4 text-xs text-muted-foreground'>{unavailable}</p>
        )}
        {!!threads.length && (
          <div className='border-t border-border px-4 py-3'>{renderThreads?.(threads)}</div>
        )}
      </div>
    )
  return (
    <div className={cn('min-w-0 overflow-x-auto', snippet && '@container/diff')}>
      <DiffBody
        diff={shown!}
        loadDiffFiles={loadDiffFiles}
        suggestion={suggestion}
        snippet={snippet}
        annotations={annotations}
        renderAnnotation={({ metadata }) => (
          <div className='-ml-[calc(var(--diffs-column-number-width,0px)-4px)] py-2 pr-1 font-sans text-foreground'>
            {renderThreads?.(metadata)}
          </div>
        )}
      />
      {remaining.length > 0 && (
        <div className='border-t border-border px-4 py-3'>{renderThreads?.(remaining)}</div>
      )}
    </div>
  )
}
function threadLine(thread: PrThread) {
  const header = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(thread.diffHunk)
  if (!header) return undefined
  let line = Number(header[thread.side === 'LEFT' ? 1 : 2])
  for (const row of thread.diffHunk.split('\n').slice(1)) {
    if (row.startsWith('\\') || row.startsWith(thread.side === 'LEFT' ? '+' : '-')) continue
    if (!row.startsWith(' ') && !row.startsWith(thread.side === 'LEFT' ? '-' : '+')) continue
    if (line++ === thread.line) return row.slice(1)
  }
  return undefined
}

export function Body({
  body,
  thread,
  className = 'pr-comment-markdown text-sm leading-relaxed',
}: {
  body: string
  thread?: PrThread
  className?: string
}) {
  const suggestion = /```suggestion\n([\s\S]*?)```/.exec(body)
  if (
    !suggestion ||
    !thread ||
    (thread.startLine !== null && thread.startLine !== thread.line) ||
    thread.line === null ||
    thread.outdated
  )
    return <Markdown className={className}>{body}</Markdown>
  const old = threadLine(thread)
  if (old === undefined) return <Markdown className={className}>{body}</Markdown>
  const replacement = suggestion[1]!.trimEnd().split('\n')
  const patch = `@@ -${thread.line ?? 1},1 +${thread.line ?? 1},${replacement.length} @@\n-${old}\n${replacement.map((l) => `+${l}`).join('\n')}`
  return (
    <>
      <Markdown className={className}>{body.slice(0, suggestion.index)}</Markdown>
      {/* A bordered card like the comment's tables and code blocks: a label band, then just the change. */}
      <div className='my-2 overflow-hidden rounded-md border-[0.5px] border-border first:mt-0 last:mb-0'>
        <p className='border-b-[0.5px] border-border px-3 py-2 text-xs text-muted-foreground'>
          Suggested change
        </p>
        <Diff
          file={{
            path: thread.path,
            status: 'modified',
            additions: replacement.length,
            deletions: 1,
            binary: false,
            generated: false,
            changes: replacement.length + 1,
            viewed: false,
          }}
          patch={patch}
          suggestion
        />
      </div>
      {body.slice(suggestion.index + suggestion[0].length).trim() && (
        <Markdown className={className}>
          {body.slice(suggestion.index + suggestion[0].length)}
        </Markdown>
      )}
    </>
  )
}
// A reply's body lines up with its author's name, under the thread's first comment.
export function Comment({
  comment,
  thread,
  menu,
  reply = false,
}: {
  comment: PrComment
  thread?: PrThread
  menu?: ReactNode
  reply?: boolean
}) {
  return (
    <div className='py-3'>
      <div className='mb-2 flex items-center gap-2 text-xs'>
        <PersonAvatar login={comment.author.login} className='size-5' />
        <span>{personName(comment.author)}</span>
        <Ago at={comment.createdAt} raised />
        {menu && <span className='ml-auto'>{menu}</span>}
      </div>
      <div className={cn(reply && 'pl-7')}>
        <Body body={comment.body} thread={thread} />
      </div>
    </div>
  )
}
