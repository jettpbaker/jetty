import { contentKey } from '@/lib/hash'
import { useResolvedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { CodeView } from '@pierre/diffs/react'
import { useMemo, useRef, type ReactNode } from 'react'

import type { ProposedChanges } from './composer_strip_model'
import type { FileChange } from './file_diff_model'

import { diffViewOptions, useCollapsedFiles } from './code_view'
import { primeDiffHighlights } from './diff_worker_pool'
import { diffItem, parseFileChanges } from './file_diff_model'
import { ScrollOverlay } from './scroll_overlay'

// A proposed patch names no blobs, so its cache key hashes the patch.
function parseProposedChanges(patch: string) {
  return parseFileChanges(patch, contentKey(patch))
}

export function primeProposedDiff(patch: string) {
  return primeDiffHighlights(parseProposedChanges(patch).map((file) => file.diff))
}

// Pierre paints −0 +0 for a hunkless file, and its header metadata can't hide that.
// Those files render outside CodeView. A rename with no hunks is not one of them.
function binaryFile(file: FileChange) {
  return file.diff.hunks.length === 0 && file.diff.type !== 'rename-pure'
}

type ProposedSegment =
  | { kind: 'binary'; file: FileChange }
  | { kind: 'text'; key: string; items: ReturnType<typeof diffItem>[] }

function proposedSegments(files: FileChange[], collapsedFiles: ReadonlySet<string>) {
  const segments: ProposedSegment[] = []
  for (const file of files) {
    if (binaryFile(file)) {
      segments.push({ kind: 'binary', file })
      continue
    }
    const item = diffItem(file.path, file.diff, collapsedFiles.has(file.path))
    const last = segments.at(-1)
    if (last?.kind === 'text') last.items.push(item)
    else segments.push({ kind: 'text', key: file.path, items: [item] })
  }
  return segments
}

function BinaryFileRow({
  file,
  collapsed,
  prefix,
}: {
  file: FileChange
  collapsed: boolean
  prefix: ReactNode
}) {
  return (
    <div className='border-b border-border last:border-b-0'>
      <div
        className={cn(
          'proposed-binary-file flex h-9 min-w-0 items-center gap-2 bg-background px-4',
          !collapsed && 'border-b border-border'
        )}
      >
        {prefix}
        <span className='min-w-0 flex-1 truncate text-xs' title={file.path}>
          {file.path}
        </span>
        <span className='shrink-0 text-xs text-muted-foreground'>Binary</span>
      </div>
      {!collapsed && <p className='p-4 text-xs text-muted-foreground'>Diff not shown</p>}
    </div>
  )
}

export function ProposedDiff({ id, changes }: { id: string; changes: ProposedChanges }) {
  const themeType = useResolvedTheme()
  const files = useMemo(() => parseProposedChanges(changes.patch), [changes.patch])
  // Only the first file opens, so a many-file change still reads as a list.
  const { collapsedFiles, renderFilePrefix } = useCollapsedFiles(
    () => new Set(files.slice(1).map((file) => file.path))
  )
  const segments = useMemo(() => proposedSegments(files, collapsedFiles), [files, collapsedFiles])
  const options = useMemo(
    () => diffViewOptions(themeType, { lineNumbers: changes.numbered }),
    [themeType, changes.numbered]
  )
  const viewport = useRef<HTMLDivElement>(null)
  const textOnly = segments.every((segment) => segment.kind === 'text')
  const textItems = segments[0]?.kind === 'text' ? segments[0].items : []
  return (
    <section
      id={id}
      aria-label='Proposed changes'
      className='file-changes-viewer relative isolate overflow-hidden rounded-sm border border-border bg-background'
    >
      {textOnly ? (
        <CodeView
          containerRef={viewport}
          items={textItems}
          options={options}
          renderHeaderPrefix={renderFilePrefix}
          className='diff-scroll-viewport max-h-72 overflow-auto'
        />
      ) : (
        <div ref={viewport} className='diff-scroll-viewport max-h-72 overflow-auto'>
          {segments.map((segment) => {
            if (segment.kind === 'binary') {
              const collapsed = collapsedFiles.has(segment.file.path)
              return (
                <BinaryFileRow
                  key={segment.file.path}
                  file={segment.file}
                  collapsed={collapsed}
                  prefix={renderFilePrefix({ id: segment.file.path, collapsed })}
                />
              )
            }
            return (
              <CodeView
                key={segment.key}
                items={segment.items}
                options={options}
                renderHeaderPrefix={renderFilePrefix}
              />
            )
          })}
        </div>
      )}
      <ScrollOverlay viewport={viewport} controls={id} />
    </section>
  )
}
