import type { ComposerAttachment } from '@/hooks/use-attachments'

import { Cancel01Icon, Attachment01Icon, PlusSignIcon } from '@/components/custom/huge_icons'
import { CircleDotIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { pickFiles } from '@/platform'

import { FileChip, isImageAttachment } from './attachment_files'
import { DisabledTooltip } from './disabled_tooltip'

export function ComposerAttach({
  onAttach,
  disabledReason,
  className,
}: {
  onAttach: (files: File[]) => void
  disabledReason?: string
  className?: string
}) {
  return (
    <DropdownMenu modal={false}>
      <DisabledTooltip reason={disabledReason} wrap='flex'>
        <DropdownMenuTrigger
          aria-label='Add attachment'
          disabled={disabledReason !== undefined}
          render={<Button variant='ghost' size='icon' className={className} />}
        >
          <PlusSignIcon />
        </DropdownMenuTrigger>
      </DisabledTooltip>
      <DropdownMenuContent align='start' className='w-max min-w-32'>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void pickFiles({ multiple: true }).then(onAttach)}>
            <Attachment01Icon />
            Attach files
          </DropdownMenuItem>
          <DisabledTooltip reason='Coming soon' side='right'>
            <DropdownMenuItem disabled>
              <CircleDotIcon />
              Link issue
            </DropdownMenuItem>
          </DisabledTooltip>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Staged attachments: images as thumbnails, files as chips of the same height.
export function ComposerAttachments({
  items,
  onRemove,
}: {
  items: readonly ComposerAttachment[]
  onRemove: (url: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className='no-scrollbar scroll-fade-x flex w-full gap-2 overflow-x-auto px-2.5 pt-2.5'>
      {items.map((image) =>
        !isImageAttachment(image) ? (
          <FileChip
            key={image.url}
            name={image.name}
            mimeType={image.mimeType}
            error={image.error}
            className='h-12'
            onRemove={() => onRemove(image.url)}
          />
        ) : (
          <div key={image.url} className='group/image relative shrink-0'>
            <img src={image.url} alt={image.name} className='size-12 rounded-sm object-cover' />
            <div className='pointer-events-none absolute inset-0 rounded-sm bg-[radial-gradient(circle_at_top_right,rgb(0_0_0/0.6),transparent_55%)] opacity-0 transition-opacity group-focus-within/image:opacity-100 group-hover/image:opacity-100 [@media(hover:none)]:opacity-100' />
            <Button
              variant='ghost-text'
              size='icon-xs'
              aria-label={`Remove ${image.name}`}
              className='absolute top-0 right-0 text-white opacity-0 group-focus-within/image:opacity-100 group-hover/image:opacity-100 not-disabled:hover:text-white [@media(hover:none)]:opacity-100'
              onClick={() => onRemove(image.url)}
            >
              <Cancel01Icon />
            </Button>
          </div>
        )
      )}
    </div>
  )
}
