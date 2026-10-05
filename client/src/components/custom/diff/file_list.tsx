import { cn } from '@/lib/utils'
import { useEffect, useRef, type ReactNode } from 'react'

import type { DiffFile } from './model'

import { ChangedFilesTree } from '../changed_files_tree'
import { DiffFileFilter } from './file_filter'

export function DiffFileList({
  files,
  pane,
  paneId,
  treeKey = '',
  filter,
  onFilter,
  selected,
  inView,
  onInView,
  onSelect,
  comments,
  listClassName,
  children,
}: {
  files: DiffFile[]
  pane: boolean
  paneId: string
  treeKey?: string
  filter: string
  onFilter: (filter: string) => void
  selected: string | null
  inView: string | null
  onInView: (path: string | null) => void
  onSelect: (path: string) => void
  comments?: Record<string, number>
  listClassName?: string
  children: ReactNode
}) {
  const scroller = useRef<HTMLElement>(null)
  const sections = useRef<HTMLElement[]>([])
  useEffect(() => {
    sections.current = [
      ...(scroller.current?.querySelectorAll<HTMLElement>('section[id^=linear-file-]') ?? []),
    ]
  }, [files])
  const active = useRef(inView)
  active.current = inView
  return (
    <div className='flex min-h-0 flex-1 pt-3'>
      {pane && (
        <nav
          id={paneId}
          aria-label='Changed files'
          className='flex w-[260px] shrink-0 flex-col pr-1.5 pb-4 pl-3 @max-[720px]:hidden'
        >
          <div className='mb-2'>
            <DiffFileFilter value={filter} onChange={onFilter} />
          </div>
          <div className='-mx-1.5 min-h-0 flex-1'>
            <ChangedFilesTree
              key={`${treeKey}:${files.map((f) => f.path).join()}`}
              icons='charmed'
              markers='names'
              files={files.map((f) => ({
                path: f.path,
                status: f.status === 'removed' ? 'deleted' : f.status,
              }))}
              comments={comments}
              selected={selected}
              active={inView}
              onSelect={onSelect}
            />
          </div>
        </nav>
      )}
      <main
        ref={scroller}
        aria-label='File diffs'
        onScroll={(event) => {
          const top = event.currentTarget.getBoundingClientRect().top + 24
          let low = 0
          let high = sections.current.length
          while (low < high) {
            const middle = (low + high) >>> 1
            if (sections.current[middle]!.getBoundingClientRect().bottom > top) high = middle
            else low = middle + 1
          }
          const path = sections.current[low]?.id.slice('linear-file-'.length) ?? null
          if (path !== active.current) onInView(path)
        }}
        className={cn(
          'scrollbar-subtle min-w-0 flex-1 space-y-3 overflow-auto pr-4 pb-4 pl-3 @max-[720px]:pl-4',
          listClassName
        )}
      >
        {children}
      </main>
    </div>
  )
}
