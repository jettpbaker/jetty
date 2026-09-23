import type { ComposerImage } from '@/hooks/use-image-attachments'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { imageAccept } from '@/hooks/use-image-attachments'
import { pickFiles } from '@/platform'
import { XIcon } from '@phosphor-icons/react'
import { IssueOpenedIcon, PaperclipIcon, PlusIcon } from '@primer/octicons-react'

export function ComposerAttach({ onAttach }: { onAttach: (files: File[]) => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label='Add attachment'
        render={<Button variant='ghost' tone='muted' size='icon' />}
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-max min-w-32'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => void pickFiles({ accept: imageAccept, multiple: true }).then(onAttach)}
          >
            <PaperclipIcon className='text-muted-foreground' />
            Attach images
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <IssueOpenedIcon className='text-muted-foreground' />
            Link issue
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ComposerImages({
  images,
  onRemove,
}: {
  images: readonly ComposerImage[]
  onRemove: (url: string) => void
}) {
  if (images.length === 0) return null
  return (
    <div className='no-scrollbar scroll-fade-x flex w-full gap-2 overflow-x-auto px-2.5 pt-2.5'>
      {images.map((image) => (
        <div key={image.url} className='group/image relative shrink-0'>
          <img src={image.url} alt={image.name} className='size-12 rounded-sm object-cover' />
          <Button
            variant='secondary'
            size='icon-xs'
            aria-label={`Remove ${image.name}`}
            className='absolute top-0.5 right-0.5 rounded-full opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
            onClick={() => onRemove(image.url)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  )
}
