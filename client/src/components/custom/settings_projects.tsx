import { PlusSignIcon, Delete02Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { inComposition } from '@/lib/composition'
import { useChrome, useCreateProject, useRenameProject } from '@/state'
import { useDeleteProject } from '@/state/mutations'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ProjectFolderDialog } from './project_folder_dialog'
import { ProjectIconPicker } from './project_icon_picker'

export function SettingsProjects() {
  const chrome = useChrome()
  const projects = chrome?.projects ?? []
  const createProject = useCreateProject()
  const deleteProject = useDeleteProject()
  const renameProject = useRenameProject()
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  function remove(projectId: string, title: string) {
    const threads = chrome?.threads.filter((thread) => thread.projectId === projectId).length ?? 0
    const deletion = deleteProject(projectId)
    toast(
      `Deleted ${title}${threads ? ` and its ${threads === 1 ? 'thread' : `${threads} threads`}` : ''}`,
      {
        action: { label: 'Undo', onClick: deletion.undo },
        onAutoClose: deletion.commit,
        onDismiss: deletion.commit,
      }
    )
  }
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
                  <ProjectName
                    title={project.title}
                    onRename={(title) => renameProject(project.id, title)}
                  />
                </div>
              </td>
              <td className='px-2 py-3 font-mono text-xs text-muted-foreground'>
                <ProjectPath path={project.path} />
              </td>
              <td className='py-3 text-right'>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={`Delete ${project.title}`}
                  onClick={() => remove(project.id, project.title)}
                >
                  <Delete02Icon aria-hidden='true' className='size-3.5 text-status-error' />
                </Button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className='p-0'>
              <button
                ref={addButton}
                type='button'
                className='flex min-h-12 w-full items-center gap-3 rounded-sm px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
                onClick={() => setAdding(true)}
              >
                <span className='flex size-7 items-center justify-center'>
                  <PlusSignIcon aria-hidden='true' className='size-4' />
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

function ProjectName({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurRef = useRef(false)
  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [editing])
  function begin() {
    skipBlurRef.current = false
    setDraft(title)
    setEditing(true)
  }
  function cancel() {
    skipBlurRef.current = true
    setDraft(title)
    setEditing(false)
  }
  function save() {
    if (skipBlurRef.current) return
    skipBlurRef.current = true
    const next = draft.trim()
    setEditing(false)
    if (next && next !== title) onRename(next)
    else setDraft(title)
  }
  if (!editing)
    return (
      <button
        type='button'
        className='min-w-0 truncate rounded-sm text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
        title={title}
        onClick={begin}
      >
        {title}
      </button>
    )
  return (
    <Input
      ref={inputRef}
      aria-label='Project name'
      value={draft}
      className='h-7 px-1.5 text-13 md:text-13'
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (inComposition(event.nativeEvent)) return
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      }}
      onBlur={save}
    />
  )
}

// The folder name is what tells projects apart, so a long path gives way before it does.
function ProjectPath({ path }: { path: string }) {
  const slash = path.lastIndexOf('/', path.length - 2)
  return (
    <span className='flex min-w-0' title={path}>
      <span className='truncate'>{path.slice(0, slash)}</span>
      <span className='max-w-full shrink-0 truncate'>{path.slice(slash)}</span>
    </span>
  )
}
