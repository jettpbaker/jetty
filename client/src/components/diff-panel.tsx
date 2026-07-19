import { socket } from '@/app-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pressHandlers } from '@/lib/press-handlers'
import { registerCustomTheme, type ThemeRegistration } from '@pierre/diffs'
import { MultiFileDiff, PatchDiff } from '@pierre/diffs/react'
import {
  ArrowClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Component, useEffect, useState, type ReactNode } from 'react'

import dark2026Json from '@/themes/dark-2026.json'

// The same "VS Code 2026 Dark" Shiki theme the markdown fences use, handed to
// @pierre/diffs by name. The lib resolves themes async, so first paint is plain
// text and highlighting arrives after.
try {
  // the lib requires the registered key to equal the theme's internal name
  registerCustomTheme('dark-2026', async () => ({
    ...(dark2026Json as unknown as ThemeRegistration),
    name: 'dark-2026',
  }))
} catch {
  // already registered (HMR re-import)
}

const THEME = { dark: 'dark-2026', light: 'dark-2026' } as const

const PATCH_OPTIONS = {
  theme: THEME,
  themeType: 'dark',
  diffStyle: 'unified',
  stickyHeader: true,
} as const

const EDIT_OPTIONS = {
  theme: THEME,
  themeType: 'dark',
  diffStyle: 'unified',
  disableFileHeader: true,
  disableLineNumbers: true,
} as const

export type DiffData = { diff: string; truncatedPaths?: string[] }

// PatchDiff renders exactly one file diff (it throws on more), so a multi-file
// patch gets split on section boundaries and rendered file by file.
function splitPatch(diff: string): string[] {
  return diff.split(/(?=^diff --git )/m).filter((section) => section.trim().length > 0)
}

// React only exposes render-error recovery through a class component.
class DiffBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) return <DiffMessage>Couldn&apos;t render this diff.</DiffMessage>
    return this.props.children
  }
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return slash === -1 ? path : path.slice(slash + 1)
}

function DiffMessage({ children }: { children: React.ReactNode }) {
  return <div className='p-4 text-sm text-muted-foreground'>{children}</div>
}

function TruncatedList({ paths }: { paths: string[] }) {
  return (
    <div className='flex flex-col gap-1 rounded-md border bg-card p-2'>
      {paths.map((path) => (
        <div key={path} className='flex items-baseline justify-between gap-3 text-sm'>
          <span className='min-w-0 truncate font-mono text-muted-foreground'>{path}</span>
          <span className='shrink-0 text-xs text-muted-foreground/70'>diff hidden</span>
        </div>
      ))}
    </div>
  )
}

/** Presentational: renders whatever diff data it's handed. Reused by the live
 *  panel and the styleguide fixtures. */
export function DiffView({
  data,
  loading,
  error,
}: {
  data: DiffData | null
  loading?: boolean
  error?: boolean
}) {
  const diff = data?.diff.trim() ?? ''
  const truncated = data?.truncatedPaths ?? []

  if (error) return <DiffMessage>Couldn&apos;t load the diff.</DiffMessage>
  if (!data && loading) return <DiffMessage>Loading diff…</DiffMessage>
  if (diff.length === 0 && truncated.length === 0)
    return <DiffMessage>No uncommitted changes.</DiffMessage>

  return (
    <div className='flex flex-col gap-3 p-3'>
      {splitPatch(diff).map((section) => (
        <DiffBoundary key={section.slice(0, section.indexOf('\n'))}>
          <PatchDiff patch={section} options={PATCH_OPTIONS} />
        </DiffBoundary>
      ))}
      {truncated.length > 0 ? <TruncatedList paths={truncated} /> : null}
    </div>
  )
}

/** Compact old→new preview for an Edit tool row. */
export function EditDiff({
  filePath,
  oldString,
  newString,
}: {
  filePath: string
  oldString: string
  newString: string
}) {
  const name = baseName(filePath)
  return (
    <MultiFileDiff
      oldFile={{ name, contents: oldString }}
      newFile={{ name, contents: newString }}
      options={EDIT_OPTIONS}
    />
  )
}

export function DiffPanel({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  function refresh() {
    setLoading(true)
    setError(false)
    socket
      .request('thread.diff', { threadId })
      .then((res) => setData(res))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        fullscreen ? 'fixed inset-0 z-50' : 'h-full w-[480px] shrink-0 border-l'
      )}
    >
      <div className='flex h-11 shrink-0 items-center gap-1 border-b px-3'>
        <span className='text-sm font-medium'>Diff</span>
        <div className='min-w-0 flex-1' />
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          aria-label='Refresh diff'
          {...pressHandlers(refresh)}
        >
          <ArrowClockwiseIcon className={cn(loading && 'animate-spin')} />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          {...pressHandlers(() => setFullscreen((v) => !v))}
        >
          {fullscreen ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          aria-label='Close diff'
          {...pressHandlers(onClose)}
        >
          <XIcon />
        </Button>
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <DiffView data={data} loading={loading} error={error} />
      </div>
    </div>
  )
}
