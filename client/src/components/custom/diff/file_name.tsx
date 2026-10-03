import { cn } from '@/lib/utils'

import type { DiffFile } from './model'

import { charmedExtensions, charmedFileNames } from '../charmed_icons'

// File icons are Charmed Icons' Soft palette, drawn from the sprite JettyStyle renders once, scaled up
// from their native 16px to 20.
export function FileGlyph({ file }: { file: DiffFile }) {
  return (
    <span data-charmed='soft' className='inline-flex size-5 shrink-0'>
      <CharmedFileIcon path={file.path} />
    </span>
  )
}
function CharmedFileIcon({ path }: { path: string }) {
  const name = (path.split('/').at(-1) ?? path).toLowerCase()
  let icon = Object.hasOwn(charmedFileNames, name) ? charmedFileNames[name] : undefined
  if (!icon) {
    const parts = name.split('.')
    for (let i = 1; i < parts.length; i++) {
      const extension = parts.slice(i).join('.')
      if (Object.hasOwn(charmedExtensions, extension)) {
        icon = charmedExtensions[extension]
        break
      }
    }
  }
  return (
    <svg aria-hidden='true' className='size-full'>
      <use href={`#ci-${icon ?? '_file'}`} />
    </svg>
  )
}
const basename = (path: string) => path.split('/').at(-1) ?? path
export function Filename({ file, rename = false }: { file: DiffFile; rename?: boolean }) {
  const name = basename(file.path)
  const directory = file.path.slice(0, -name.length)
  const old = file.previousPath && basename(file.previousPath)
  let suffix = 0
  if (old)
    while (
      suffix < Math.min(old.length, name.length) &&
      old.at(-suffix - 1) === name.at(-suffix - 1)
    )
      suffix++
  // One line, never two: the folder path wraps onto a clipped second line, so it shows whole or not at all.
  return (
    <span
      className='flex h-[1lh] min-w-0 flex-1 flex-wrap overflow-hidden font-mono text-xs'
      title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
    >
      {rename && old ? (
        <span className='max-w-full truncate'>
          <span className='bg-status-error/10 text-status-error'>
            {old.slice(0, old.length - suffix)}
          </span>
          {old.slice(old.length - suffix)}
          <span className='text-muted-foreground'> → </span>
          <span className='bg-status-success/10 text-status-success'>
            {name.slice(0, name.length - suffix)}
          </span>
          {name.slice(name.length - suffix)}
        </span>
      ) : (
        <span
          className={cn(
            'max-w-full truncate',
            file.status === 'added' && 'text-status-success',
            file.status === 'removed' && 'text-muted-foreground line-through'
          )}
        >
          {name}
        </span>
      )}
      {directory && (
        <span className='ml-2 text-muted-foreground @max-[720px]:hidden'>{directory}</span>
      )}
    </span>
  )
}
