import type { Project, ProjectIcon } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useSetProjectIcon } from '@/state'
import { lazy, Suspense } from 'react'

import { ProjectGlyph } from './project_glyph'
import './option_picker.css'

const ProjectEmojiPicker = lazy(() => import('./project_emoji_picker'))

// Open from its own button, or from elsewhere (a menu's "Change icon") through `open`.
export function ProjectIconPicker({
  project,
  open,
  onOpenChange,
  className,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}) {
  const setProjectIcon = useSetProjectIcon()
  function choose(icon: ProjectIcon | null) {
    setProjectIcon(project.id, icon)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            aria-label={`Icon for ${project.title}`}
            className={className}
          />
        }
      >
        <ProjectGlyph icon={project.icon} className='size-4' />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-80 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border'
      >
        <PopoverTitle className='sr-only'>{`Icon for ${project.title}`}</PopoverTitle>
        <div className='flex items-center justify-end border-b border-border p-1.5'>
          <Button
            variant='ghost-text'
            size='sm'
            className='rounded-sm'
            disabled={!project.icon}
            onClick={() => choose(null)}
          >
            Remove
          </Button>
        </div>
        <Suspense fallback={<div className='h-80' />}>
          <ProjectEmojiPicker onSelect={(emoji) => choose({ type: 'emoji', emoji })} />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
