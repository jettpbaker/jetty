import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useChrome, useCreateProject } from '@/state'
import { ArrowUpRightIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'

import { ProjectFolderDialog } from './project_folder_dialog'
import { ProjectIconPicker } from './project_icon_picker'

export function SettingsProjects() {
  const projects = useChrome()?.projects ?? []
  const createProject = useCreateProject()
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  function setDialogOpen(open: boolean) {
    setAdding(open)
    if (!open) requestAnimationFrame(() => addButton.current?.focus())
  }
  return (
    <div className='overflow-hidden'>
      <table className='w-full table-fixed text-left text-13' aria-label='Projects'>
        <thead>
          <tr className='text-xs text-muted-foreground'>
            <th scope='col' className='w-[30%] px-2 pb-2 font-normal'>
              Project
            </th>
            <th scope='col' className='px-2 pb-2 font-normal'>
              Path
            </th>
            <th scope='col' className='w-28 px-2 pb-2 font-normal'>
              Containers
            </th>
            <th scope='col' className='w-9 pb-2'>
              <span className='sr-only'>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id} className='border-b border-border hover:bg-accent'>
              <td className='px-2 py-3'>
                <div className='flex min-w-0 items-center gap-3'>
                  <ProjectIconPicker project={project} />
                  <span className='truncate' title={project.title}>
                    {project.title}
                  </span>
                </div>
              </td>
              <td className='px-2 py-3 text-xs text-muted-foreground'>
                <span className='block truncate' title={project.path}>
                  {project.path}
                </span>
              </td>
              <td className='px-2 py-3 text-xs text-muted-foreground'>
                <Tooltip>
                  <TooltipTrigger render={<span className='inline-flex cursor-not-allowed' />}>
                    <Button
                      variant='ghost-text'
                      size='sm'
                      className='pointer-events-none -ml-2 h-7 gap-1 rounded-sm'
                      disabled
                    >
                      Set up
                      <ArrowUpRightIcon aria-hidden='true' className='size-3' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
              </td>
              <td className='py-3 text-right'>
                <Tooltip>
                  <TooltipTrigger render={<span className='inline-flex cursor-not-allowed' />}>
                    <Button
                      variant='ghost'
                      tone='muted'
                      size='icon'
                      aria-label={`Remove ${project.title}`}
                      className='pointer-events-none'
                      disabled
                    >
                      <TrashIcon aria-hidden='true' className='size-3.5 text-status-error' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Coming soon</TooltipContent>
                </Tooltip>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4} className='p-0'>
              <button
                ref={addButton}
                type='button'
                className='flex min-h-12 w-full items-center gap-3 rounded-sm px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                onClick={() => setAdding(true)}
              >
                <span className='flex size-7 items-center justify-center'>
                  <PlusIcon aria-hidden='true' className='size-4' />
                </span>
                New project
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setDialogOpen}
        existingPaths={projects.map((project) => project.path)}
        onAdd={(path) => createProject(path)}
      />
    </div>
  )
}
