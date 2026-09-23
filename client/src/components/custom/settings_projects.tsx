import { Button } from '@/components/ui/button'
import { ArrowUpRightIcon, CheckIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { RepoIcon } from '@primer/octicons-react'
import { useRef, useState } from 'react'

import { ProjectFolderDialog } from './project_folder_dialog'

const initialProjects = [
  { name: 'jetty', path: '~/code/jetty', emoji: '🛶', containers: true },
  { name: 'jetty-design', path: '~/code/scratch/jetty-design', emoji: null, containers: false },
]

export function SettingsProjects() {
  const [projects, setProjects] = useState(initialProjects)
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  function setDialogOpen(open: boolean) {
    setAdding(open)
    if (!open) requestAnimationFrame(() => addButton.current?.focus())
  }
  function add(path: string) {
    setProjects((current) => [
      ...current,
      { name: path.split('/').pop() || path, path, emoji: null, containers: false },
    ])
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
            <tr key={project.path} className='border-b border-border hover:bg-accent'>
              <td className='px-2 py-3'>
                <div className='flex min-w-0 items-center gap-3'>
                  <span
                    aria-hidden='true'
                    className='flex size-7 shrink-0 items-center justify-center text-muted-foreground'
                  >
                    {project.emoji ? (
                      <span className='text-lg leading-none'>{project.emoji}</span>
                    ) : (
                      <RepoIcon className='size-4' />
                    )}
                  </span>
                  <span className='truncate' title={project.name}>
                    {project.name}
                  </span>
                </div>
              </td>
              <td className='px-2 py-3 text-xs text-muted-foreground'>
                <span className='block truncate' title={project.path}>
                  {project.path}
                </span>
              </td>
              <td className='px-2 py-3 text-xs text-muted-foreground'>
                {project.containers ? (
                  <span role='img' aria-label='Containers configured'>
                    <CheckIcon
                      aria-hidden='true'
                      weight='bold'
                      className='size-4 text-status-success'
                    />
                  </span>
                ) : (
                  <Button
                    variant='ghost-text'
                    size='sm'
                    className='-ml-2 h-7 gap-1 rounded-sm'
                    onClick={() =>
                      document
                        .getElementById('settings-containers-heading')
                        ?.scrollIntoView({ block: 'start' })
                    }
                  >
                    Set up
                    <ArrowUpRightIcon aria-hidden='true' className='size-3' />
                  </Button>
                )}
              </td>
              <td className='py-3 text-right'>
                <Button
                  variant='ghost'
                  tone='muted'
                  size='icon'
                  aria-label={`Remove ${project.name}`}
                  aria-disabled='true'
                >
                  <TrashIcon aria-hidden='true' className='size-3.5 text-status-error' />
                </Button>
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
        onAdd={add}
      />
    </div>
  )
}
