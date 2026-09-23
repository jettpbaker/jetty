import { useResolvedTheme } from '@/lib/theme'
import { CodeView } from '@pierre/diffs/react'
import { useMemo, useRef } from 'react'

import type { ProposedChanges } from './composer_strip_model'

import { diffViewOptions, useCollapsedFiles } from './file_changes_viewer'
import { diffItem, parseFileChanges } from './file_diff_model'
import { ScrollOverlay } from './scroll_overlay'

export function ProposedDiff({ id, changes }: { id: string; changes: ProposedChanges }) {
  const themeType = useResolvedTheme()
  const files = useMemo(() => parseFileChanges(changes.patch), [changes.patch])
  // Only the first file opens, so a many-file change still reads as a list.
  const { collapsedFiles, renderFilePrefix } = useCollapsedFiles(
    () => new Set(files.slice(1).map((file) => file.path))
  )
  const items = useMemo(
    () => files.map((file) => diffItem(file.path, file.diff, collapsedFiles.has(file.path))),
    [files, collapsedFiles]
  )
  const options = useMemo(
    () => diffViewOptions(themeType, { lineNumbers: changes.numbered }),
    [themeType, changes.numbered]
  )
  const viewport = useRef<HTMLDivElement>(null)
  return (
    <section
      id={id}
      aria-label='Proposed changes'
      className='file-changes-viewer relative isolate overflow-hidden rounded-sm border border-border bg-background'
    >
      <CodeView
        containerRef={viewport}
        items={items}
        options={options}
        renderHeaderPrefix={renderFilePrefix}
        className='diff-scroll-viewport max-h-72 overflow-auto'
      />
      <ScrollOverlay viewport={viewport} controls={id} />
    </section>
  )
}
