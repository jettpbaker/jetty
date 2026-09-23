import { useResolvedTheme } from '@/lib/theme'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import { useEffect, useId, useMemo, useRef } from 'react'

import type { FileTarget } from './file_link'

import { diffViewOptions, useCollapsedFiles } from './file_changes_viewer'
import { ScrollOverlay } from './scroll_overlay'

let lastVersion = 0

export function FileViewer({ target, contents }: { target: FileTarget; contents: string }) {
  const { path, line } = target
  const themeType = useResolvedTheme()
  const options = useMemo(() => diffViewOptions(themeType, {}), [themeType])
  const { collapsedFiles, renderFilePrefix } = useCollapsedFiles(() => new Set())
  const collapsed = collapsedFiles.has(path)
  // CodeView only re-reads an item when its version changes.
  const items = useMemo(
    () => [
      {
        id: path,
        type: 'file' as const,
        file: { name: path, contents },
        collapsed,
        version: ++lastVersion,
      },
    ],
    [path, contents, collapsed]
  )
  const selectedLines = useMemo(
    () => (line ? { id: path, range: { start: line, end: line } } : null),
    [path, line]
  )
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
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
  return (
    <section
      id={id}
      aria-label={path}
      className='file-changes-viewer relative isolate flex h-full min-h-0 flex-col bg-background'
    >
      <CodeView
        ref={viewer}
        containerRef={viewport}
        items={items}
        options={options}
        selectedLines={selectedLines}
        renderHeaderPrefix={renderFilePrefix}
        className='diff-scroll-viewport min-h-0 flex-1 overflow-auto'
      />
      <ScrollOverlay viewport={viewport} controls={id} />
    </section>
  )
}
