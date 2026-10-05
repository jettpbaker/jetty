import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import type { DiffFile } from './model'

import { ArrowDown01Icon, ArrowRight01Icon } from '../huge_icons'
import { FileGlyph, Filename } from './file_name'
import '../charmed_icons.css'
import './file_card.css'

export function DiffViewed({
  file,
  checked,
  onCheckedChange,
}: {
  file: DiffFile
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  // Per card: PR tabs stay mounted, and two PRs can share a path.
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex h-4 cursor-pointer items-center gap-1.5 text-xs leading-4',
        checked ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <Checkbox
        id={id}
        aria-label={`Mark ${file.path} viewed`}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className='size-3.5'
      />
      <span className='@max-[400px]:hidden'>Viewed</span>
    </label>
  )
}

export function DiffCounts({ files }: { files: Pick<DiffFile, 'additions' | 'deletions'>[] }) {
  return (
    <span className='inline-flex shrink-0 gap-1.5 font-mono text-xs tabular-nums'>
      <span className='text-status-success'>+{files.reduce((n, f) => n + f.additions, 0)}</span>
      <span className='text-status-error'>−{files.reduce((n, f) => n + f.deletions, 0)}</span>
    </span>
  )
}

export function DiffFileCard({
  file,
  open,
  collapsed,
  onToggle,
  beforeCounts,
  actions,
  height,
  initiallyNear = false,
  deferHeader = false,
  children,
}: {
  file: DiffFile
  open: boolean
  collapsed: boolean
  onToggle: () => void
  beforeCounts?: ReactNode
  actions?: ReactNode
  height: number
  initiallyNear?: boolean
  deferHeader?: boolean
  children: () => ReactNode
}) {
  const card = useRef<HTMLElement>(null)
  const [near, setNear] = useState(initiallyNear)
  useEffect(() => {
    const element = card.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setNear((near) => near || entry!.isIntersecting),
      { root: element.closest('[aria-label="File diffs"]'), rootMargin: '800px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const header = (
    <div className='sticky top-0 z-10 bg-background'>
      <header
        className={cn(
          'file-card-header flex min-h-11 items-center gap-2 border border-border bg-muted/30 px-3 py-2',
          open ? 'rounded-t-md' : 'rounded-md'
        )}
      >
        <Button
          variant='ghost-text'
          size='icon-sm'
          className='group/collapse relative -my-1 -ml-1'
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.path}`}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className='absolute inline-flex group-hover/collapse:opacity-0 group-focus-visible/collapse:opacity-0'>
            <FileGlyph file={file} />
          </span>
          {collapsed ? (
            <ArrowRight01Icon className='absolute opacity-0 group-hover/collapse:opacity-100 group-focus-visible/collapse:opacity-100' />
          ) : (
            <ArrowDown01Icon className='absolute opacity-0 group-hover/collapse:opacity-100 group-focus-visible/collapse:opacity-100' />
          )}
        </Button>
        <Filename file={file} rename />
        <div className='ml-auto flex shrink-0 items-center gap-3'>
          {beforeCounts}
          {file.binary ? (
            <span className='font-mono text-xs text-muted-foreground'>Binary</span>
          ) : (
            <DiffCounts files={[file]} />
          )}
          {actions}
        </div>
      </header>
    </div>
  )
  return (
    <section
      ref={card}
      id={`linear-file-${file.path}`}
      data-open={open || undefined}
      className='file-card relative scroll-mt-3 overflow-clip rounded-md'
    >
      {deferHeader && !near ? <div aria-hidden='true' className='h-11.5' /> : header}
      {open && (
        <div className='file-card-body overflow-clip border border-t-0 border-border'>
          {near ? children() : <div aria-hidden='true' style={{ height }} />}
        </div>
      )}
      <div aria-hidden='true' className='file-card-tail' />
    </section>
  )
}
