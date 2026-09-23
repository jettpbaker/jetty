import type { Project, ProjectIcon } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSetProjectIcon } from '@/state'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { lazy, Suspense, useState } from 'react'

import { GhostInput } from './ghost_input'
import { ProjectGlyph } from './project_glyph'
import { projectIcons } from './project_icon_set'

const ProjectEmojiPicker = lazy(() => import('./project_emoji_picker'))

function IconGrid({ selected, onSelect }: { selected?: string; onSelect: (name: string) => void }) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const results = projectIcons.filter((option) =>
    `${option.name} ${option.keywords}`.includes(search)
  )
  return (
    <div className='flex h-80 flex-col'>
      <div className='border-b border-border px-3'>
        <GhostInput
          icon={<MagnifyingGlassIcon className='size-3' />}
          aria-label='Search icons'
          placeholder='Search icons'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className='grid min-h-0 flex-1 auto-rows-min grid-cols-8 gap-1 overflow-y-auto overscroll-contain p-2'>
        {results.map((option) => (
          <Button
            key={option.name}
            variant='ghost'
            tone='muted'
            size='icon'
            aria-label={option.label}
            aria-pressed={option.name === selected}
            className='aria-pressed:bg-accent aria-pressed:text-foreground'
            onClick={() => onSelect(option.name)}
          >
            <option.icon />
          </Button>
        ))}
        {!results.length && (
          <p className='col-span-full px-1 py-2 text-xs text-muted-foreground'>No matches</p>
        )}
      </div>
    </div>
  )
}

export function ProjectIconPicker({ project }: { project: Project }) {
  const setProjectIcon = useSetProjectIcon()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ProjectIcon['type']>('emoji')

  function choose(icon: ProjectIcon | null) {
    setProjectIcon(project.id, icon)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setTab(project.icon?.type ?? 'emoji')
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            tone='muted'
            size='icon'
            aria-label={`Icon for ${project.title}`}
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
        <Tabs
          value={tab}
          onValueChange={(value: ProjectIcon['type']) => setTab(value)}
          className='gap-0'
        >
          <div className='flex items-center justify-between gap-2 border-b border-border p-1.5'>
            <TabsList className='h-7'>
              <TabsTrigger value='emoji' className='px-2.5 text-xs'>
                Emoji
              </TabsTrigger>
              <TabsTrigger value='icon' className='px-2.5 text-xs'>
                Icons
              </TabsTrigger>
            </TabsList>
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
          <TabsContent value='emoji'>
            <Suspense fallback={<div className='h-80' />}>
              <ProjectEmojiPicker onSelect={(emoji) => choose({ type: 'emoji', emoji })} />
            </Suspense>
          </TabsContent>
          <TabsContent value='icon'>
            <IconGrid
              selected={project.icon?.type === 'icon' ? project.icon.name : undefined}
              onSelect={(name) => choose({ type: 'icon', name })}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
