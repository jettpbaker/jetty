import type { DiffLineAnnotation, FileDiffMetadata } from '@pierre/diffs'

import { hugeIconMasks } from '@/components/custom/huge_icons'
import { Markdown } from '@/components/custom/markdown'
import { PersonAvatar } from '@/components/custom/person_avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { contentKey } from '@/lib/hash'
import { useResolvedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { FileDiff } from '@pierre/diffs/react'
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import type { PrComment, PrFile, PrThread } from './adapter'

import { useDiffWorkerPool } from '../diff_worker_pool'
import {
  hydratedDiff,
  loadedFiles,
  parseFileChanges,
  patchMatchesContents,
  withoutContext,
} from '../file_diff_model'
import { syntaxTheme } from './cursor_themes'
import {
  ago,
  countLabel,
  excerpt,
  filePatch,
  DiffStyleContext,
  DiffWrapContext,
  personName,
  visibleLines,
} from './model'
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
export function Counts({ files }: { files: PrFile[] }) {
  return (
    <span className='inline-flex shrink-0 gap-1.5 font-mono text-xs tabular-nums'>
      <span className='text-status-success'>+{files.reduce((n, f) => n + f.additions, 0)}</span>
      <span className='text-status-error'>−{files.reduce((n, f) => n + f.deletions, 0)}</span>
    </span>
  )
}
// Jetty's skin for Pierre's diffs, injected into its shadow root: Jetty's surface and status colours,
// line numbers tinted like their code with no gap between, so a changed line's tint runs unbroken, and a solid
// removed-line bar like the added one (Pierre stripes it).
// A comment's row is one colour across the gutter and the code: the diff background, or, between two
// added (or two removed) lines, their tint, so a run of changes reads as one block with the comment
// inside it; the gutter bar stays on the lines themselves. In split view the other side's spacer keeps
// the empty side's stripes when it sits inside them. Comments stack
// above the sticky line-number gutter (z-index 3) so their card can reach back over it.
const diffCSS = `
:host { --diffs-font-size: 12px; --diffs-line-height: 20px; --diffs-bg: var(--diff-surface) !important; --diffs-addition-color-override: var(--status-success); --diffs-deletion-color-override: var(--status-error); --diffs-gap-style: none; }
[data-line-annotation], [data-gutter-buffer="annotation"] { --diffs-annotation-bg: var(--diffs-bg); }
[data-line-annotation] { z-index: 4; }
[data-content-buffer] + [data-line-annotation]:has(+ [data-content-buffer]) {
  background-image: repeating-linear-gradient(-45deg, transparent, transparent calc(3px * 1.414), var(--diffs-bg-buffer) calc(3px * 1.414), var(--diffs-bg-buffer) calc(4px * 1.414));
  background-size: 8px 8px;
  background-position: 5px 0;
  background-origin: border-box;
}
[data-gutter-buffer="buffer"] + [data-gutter-buffer="annotation"]:has(+ [data-gutter-buffer="buffer"]) { --diffs-annotation-bg: var(--diffs-bg-context-gutter); }
[data-gutter] [data-column-number] { --mix-light: 88%; --mix-dark: 80%; }
[data-indicators="bars"] [data-line-type="change-deletion"][data-column-number]::before { background: var(--diffs-deletion-base); }
${(['addition', 'deletion'] as const)
  .map(
    (kind) => `
[data-line-type="change-${kind}"] + :is([data-line-annotation], [data-gutter-buffer="annotation"]):has(+ [data-line-type="change-${kind}"]) { --diffs-annotation-bg: var(--diffs-bg-${kind}); }`
  )
  .join('')}`
// Pierre's fold row as a chip on a hairline, at the left: the arrow says which way it expands (Pierre
// flips its chevron, so an "expand-down" button reveals the lines above). A short run has one button,
// stretched over the row, its arrow drawn in the chip; a run of over 100 lines comes in chunks: arrow
// buttons that show 100 more lines from their end, then the count, which shows the whole run (Pierre's
// Expand all button, laid invisibly over it in the same grid cell).
// Pierre renders each fold in both the gutter and the code column, and in split view on both sides; it
// draws the controls from the gutter of the unified or deletions side and a bare bar elsewhere, so the
// chip is scoped to that gutter and every other copy keeps Pierre's display and gets only the hairline.
const shown = ':is([data-unified], [data-deletions]) [data-gutter]'
const hairline =
  'background: var(--diffs-bg) linear-gradient(var(--border), var(--border)) center / 100% 0.5px no-repeat;'
const chip =
  'display: flex; flex: none; align-items: center; gap: 6px; height: 22px; padding: 0 10px 0 8px; border-radius: 999px; border: 0.5px solid var(--border); background: var(--diffs-bg); color: var(--muted-foreground); font-family: var(--font-sans);'
const arrow =
  'content: ""; width: 12px; height: 12px; background: currentColor; mask: var(--fold-arrow) center / 12px no-repeat;'
const hover =
  'background: color-mix(in oklch, var(--foreground) 6%, var(--diffs-bg)); color: var(--foreground);'
const chunked = `${shown} [data-separator-wrapper]:has([data-expand-all-button])`
const foldCSS = `
[data-separator="line-info"] { margin: 0; height: 32px; background: transparent; }
[data-separator="line-info"] [data-separator-wrapper] { height: 32px; margin: 0; border-radius: 0; ${hairline} }
${shown} [data-separator-wrapper] { display: flex; align-items: center; gap: 4px; width: 100cqi; padding: 0 0 0 8px; }
[data-expand-down], [data-expand-down] + [data-separator-content] { --fold-arrow: ${hugeIconMasks.arrowUp03}; }
[data-expand-up], [data-expand-up] + [data-separator-content] { --fold-arrow: ${hugeIconMasks.arrowDown03}; }
[data-expand-both], [data-expand-both] + [data-separator-content] { --fold-arrow: ${hugeIconMasks.arrowUpDown}; }
${shown} [data-expand-button] { position: absolute; inset: 0; width: auto; height: auto; background: transparent; border-radius: 0; cursor: pointer; }
${shown} [data-expand-button] svg { display: none; }
${shown} [data-separator-content] { ${chip} }
${shown} [data-expand-button] + [data-separator-content]::before { ${arrow} }
[data-unmodified-lines] { color: inherit; }
${shown} [data-separator-content]:hover { text-decoration: none; }
${shown} [data-separator-wrapper]:hover [data-separator-content] { ${hover} }
${chunked} { display: grid; grid-template: none / none; grid-auto-flow: column; grid-auto-columns: max-content; column-gap: 4px; }
${chunked} [data-expand-button] { position: static; grid-row: 1; grid-column: auto; align-self: center; ${chip} }
${chunked} :is([data-separator-content], [data-expand-all-button]) { grid-row: 1; grid-column: 2; }
${chunked}:has([data-expand-up] + [data-expand-down]) :is([data-separator-content], [data-expand-all-button]) { grid-column: 3; }
${chunked} [data-expand-all-button] { z-index: 1; justify-self: stretch; opacity: 0; }
${chunked} [data-expand-button]:not([data-expand-all-button]) { width: 22px; padding: 0; justify-content: center; }
${chunked} [data-expand-button]:not([data-expand-all-button])::before { ${arrow} }
${chunked} [data-separator-content]::before { display: none; }
${chunked}:hover [data-separator-content] { background: var(--diffs-bg); color: var(--muted-foreground); }
${chunked} [data-expand-button]:hover, ${chunked}:has([data-expand-all-button]:hover) [data-separator-content] { ${hover} }
`

export function Diff({
  file,
  patch,
  threads = [],
  renderThreads,
  suggestion = false,
}: {
  file: PrFile
  patch?: string
  threads?: PrThread[]
  renderThreads?: (threads: PrThread[]) => ReactNode
  suggestion?: boolean
}) {
  const pool = useDiffWorkerPool(syntaxTheme)
  const revision = useContext(PrDiffRevisionContext)
  const hasPatch = patch === undefined ? file.patch : patch
  const text = filePatch(file, patch)
  const diff = useMemo(
    () =>
      hasPatch ? parseFileChanges(text, `${revision}:${contentKey(text)}`)[0]?.diff : undefined,
    [text, revision, hasPatch]
  )
  const diffStyle = useContext(DiffStyleContext)
  const loadFile = useContext(PrDiffLoaderContext)
  const loadDiffFiles = useMemo(() => {
    if (!loadFile || suggestion || patch !== undefined) return undefined
    let pending: ReturnType<NonNullable<typeof loadFile>> | undefined
    return async (diff: import('@pierre/diffs').FileDiffMetadata) => {
      pending ??= loadFile(file.path, file.previousPath)
      try {
        const contents = await pending
        if ('unavailable' in contents)
          throw new Error(`Diff context unavailable: ${contents.unavailable}`)
        if (!patchMatchesContents(diff, contents))
          throw new Error('Diff context no longer matches this patch')
        return loadedFiles(diff, contents)
      } catch (error) {
        pending = undefined
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
  const wrap = useContext(DiffWrapContext)
  const threadPatch = patch ?? file.patch
  const lines = useMemo(
    () => ({
      LEFT: visibleLines({ status: 'removed', patch: threadPatch }),
      RIGHT: visibleLines({ status: 'modified', patch: threadPatch }),
    }),
    [threadPatch]
  )
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
  const resolvedTheme = useResolvedTheme()
  const unavailable = file.binary
    ? 'Binary file · preview unavailable'
    : !hasPatch
      ? file.status === 'renamed' && file.changes === 0
        ? 'No textual changes · renamed file'
        : 'Diff unavailable'
      : !diff
        ? 'Diff unavailable'
        : undefined
  if (unavailable)
    return (
      <div className='min-w-0 overflow-x-auto'>
        <p className='p-4 text-xs text-muted-foreground'>{unavailable}</p>
        {!!threads.length && (
          <div className='border-t border-border px-4 py-3'>
            {renderThreads ? renderThreads(threads) : <Threads threads={threads} />}
          </div>
        )}
      </div>
    )
  if (!pool)
    return (
      <div
        aria-hidden='true'
        style={{ height: Math.max(40, (patch ?? file.patch ?? '').split('\n').length * 20) }}
      />
    )
  return (
    <div className='min-w-0 overflow-x-auto'>
      <FileDiff
        fileDiff={shown!}
        lineAnnotations={annotations}
        renderAnnotation={({ metadata }) => (
          // Reaches back over the line numbers to where the change bar ends, and stops the same 4px short
          // of the right edge, so the card sits in the code.
          <div className='-ml-[calc(var(--diffs-column-number-width,0px)-4px)] py-2 pr-1 font-sans text-foreground'>
            {renderThreads ? renderThreads(metadata) : <Threads threads={metadata} />}
          </div>
        )}
        options={{
          // A suggestion is one line out, a few in: side by side would only cut both short.
          loadDiffFiles,
          diffStyle: suggestion ? 'unified' : diffStyle,
          theme: syntaxTheme,
          themeType: resolvedTheme === 'dark' ? 'dark' : 'light',
          disableFileHeader: true,
          hunkSeparators: suggestion ? 'simple' : 'line-info',
          overflow: wrap ? 'wrap' : 'scroll',
          unsafeCSS: diffCSS + foldCSS,
        }}
      />
      {remaining.length > 0 && (
        <div className='border-t border-border px-4 py-3'>
          {renderThreads ? renderThreads(remaining) : <Threads threads={remaining} />}
        </div>
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
  className = 'text-sm leading-6',
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
function Thread({ thread }: { thread: PrThread }) {
  return (
    <div className='overflow-hidden rounded-sm border border-border'>
      <div className='flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs'>
        <span className='min-w-0 break-all font-mono'>
          {thread.path}:{thread.line ?? '—'}
        </span>
        <span className='shrink-0 text-muted-foreground'>
          {thread.resolved ? 'Resolved' : countLabel(thread.comments.length, 'comment')}
          {thread.outdated ? ' · Outdated' : ''}
        </span>
      </div>
      <Diff
        file={{
          path: thread.path,
          status: 'modified',
          additions: 0,
          deletions: 0,
          generated: false,
          binary: false,
          changes: 0,
          viewed: false,
        }}
        patch={excerpt(thread)}
      />
      <div className='divide-y divide-border px-3'>
        {thread.comments.map((c) => (
          <Comment key={c.id} comment={c} thread={thread} />
        ))}
      </div>
      {!thread.resolved && (
        <div className='border-t border-border px-3 py-1'>
          <Tooltip>
            <TooltipTrigger render={<span className='inline-flex' />}>
              <Button disabled variant='ghost-text' size='sm' className='px-0'>
                Fix in a thread
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
function Threads({ threads }: { threads: PrThread[] }) {
  const open = threads.filter((t) => !t.resolved)
  const resolved = threads.filter((t) => t.resolved)
  return (
    <div className='space-y-3'>
      {open.map((t) => (
        <Thread key={t.id} thread={t} />
      ))}
      {resolved.length > 0 && (
        <details className='border-y border-border py-2'>
          <summary className='cursor-pointer text-xs text-muted-foreground'>
            {resolved.length} resolved
          </summary>
          <div className='mt-3 space-y-3'>
            {resolved.map((t) => (
              <Thread key={t.id} thread={t} />
            ))}
          </div>
        </details>
      )}
      {!threads.length && <p className='text-xs text-muted-foreground'>No review threads</p>}
    </div>
  )
}
