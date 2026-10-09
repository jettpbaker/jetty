import type { Attachment } from '@jetty/shared/items'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isImageMimeType } from '@jetty/shared/wire'
import { createContext, use } from 'react'

import { Alert02Icon, Cancel01Icon, File01Icon, FileTextIcon } from './huge_icons'
import { mediaUrl } from './media_layout'

// The images an agent sees inline; anything else, an SVG included, is a file it gets as a path.
export function isImageAttachment(attachment: { mimeType: string }) {
  return isImageMimeType(attachment.mimeType)
}

// Opens a text attachment read-only in the thread's file viewer; false where there's none.
export const OpenAttachment = createContext<(attachment: Attachment) => boolean>(() => false)

const textTypes = new Set([
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/sql',
  'application/graphql',
])
const textExtensions = new Set(
  (
    'txt md mdx log csv tsv json jsonl ndjson yaml yml toml ini cfg conf env xml html css scss ' +
    'js jsx mjs cjs ts tsx mts cts py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh ' +
    'fish sql graphql gql proto lua dart ex exs erl hs ml scala clj vue svelte diff patch'
  ).split(' ')
)
// The file viewer's own limit for a project file.
const MAX_VIEW_BYTES = 1024 * 1024

function viewable(attachment: Attachment) {
  const type = attachment.mimeType.split(';')[0]!.trim().toLowerCase()
  const dot = attachment.name.lastIndexOf('.')
  const extension = dot > 0 ? attachment.name.slice(dot + 1).toLowerCase() : ''
  return (
    attachment.sizeBytes <= MAX_VIEW_BYTES &&
    (type.startsWith('text/') || textTypes.has(type) || textExtensions.has(extension))
  )
}

// Text opens in the viewer; anything else, or text with nowhere to open, downloads.
export function useOpenAttachmentFile() {
  const open = use(OpenAttachment)
  return (attachment: Attachment) => {
    if (viewable(attachment) && open(attachment)) return
    const link = document.createElement('a')
    link.href = mediaUrl(attachment)
    link.download = attachment.name
    link.click()
  }
}

export function bytes(size: number) {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`
  return `${Math.round(size / 1024)} KB`
}

function FileGlyph({ mimeType, className }: { mimeType: string; className?: string }) {
  const Glyph = mimeType === 'application/pdf' ? FileTextIcon : File01Icon
  return <Glyph className={className} />
}

// A sent file as one quiet line, opened on click.
export function FileLine({ attachment }: { attachment: Attachment }) {
  const open = useOpenAttachmentFile()
  return (
    <button
      type='button'
      title={attachment.name}
      onClick={() => open(attachment)}
      className='flex max-w-75 items-center gap-1.5 rounded-full border border-border py-1 pr-2.5 pl-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <FileGlyph mimeType={attachment.mimeType} className='shrink-0 text-muted-foreground' />
      <span className='min-w-0 truncate'>{attachment.name}</span>
      <span className='shrink-0 font-mono text-muted-foreground'>
        {bytes(attachment.sizeBytes)}
      </span>
    </button>
  )
}

export function FileLines({ files }: { files: readonly Attachment[] }) {
  if (files.length === 0) return null
  return (
    <div className='flex flex-col items-end gap-1'>
      {files.map((attachment) => (
        <FileLine key={attachment.id} attachment={attachment} />
      ))}
    </div>
  )
}

// A staged file in a composer's row. One that can't be sent is ringed in red, as an image is.
export function FileChip({
  name,
  mimeType,
  error,
  onRemove,
  className,
}: {
  name: string
  mimeType: string
  error?: string
  onRemove: () => void
  className?: string
}) {
  return (
    <span
      title={error ?? name}
      className={cn(
        'group/file flex h-10 max-w-40 shrink-0 items-center gap-1.5 rounded-lg bg-foreground/8 pr-1 pl-2.5 text-xs',
        error && 'text-destructive ring-2 ring-destructive ring-inset',
        className
      )}
    >
      {error ? (
        <Alert02Icon className='shrink-0' />
      ) : (
        <FileGlyph mimeType={mimeType} className='shrink-0 text-muted-foreground' />
      )}
      <span className='min-w-0 truncate'>{name}</span>
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label={`Remove ${name}`}
        className='shrink-0 opacity-0 group-focus-within/file:opacity-100 group-hover/file:opacity-100 [@media(hover:none)]:opacity-100'
        onClick={onRemove}
      >
        <Cancel01Icon />
      </Button>
    </span>
  )
}
