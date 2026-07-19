import { socket } from '@/app-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

type NewProjectDialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
}

export function NewProjectDialog({
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: NewProjectDialogProps = {}) {
  const navigate = useNavigate()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const [path, setPath] = useState('')
  const [title, setTitle] = useState('')

  function setOpen(next: boolean) {
    setOpenState(next)
    onOpenChange?.(next)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPath = path.trim()
    if (!trimmedPath) return
    try {
      const { project } = await socket.request('project.create', {
        path: trimmedPath,
        title: title.trim() || undefined,
      })
      setPath('')
      setTitle('')
      setOpen(false)
      void navigate({ to: '/new/$projectId', params: { projectId: project.id } })
    } catch {
      toast.error('Couldn’t create the project.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger
          render={
            <Button variant='outline' size='sm' className='w-full'>
              New project
            </Button>
          }
        />
      )}
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Point jetty at a project directory.</DialogDescription>
          </DialogHeader>
          <FieldGroup className='py-4'>
            <Field>
              <FieldLabel htmlFor='project-path'>Path</FieldLabel>
              <Input
                id='project-path'
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder='/Users/me/code/project'
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='project-title'>Title (optional)</FieldLabel>
              <Input
                id='project-title'
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder='My project'
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type='submit' disabled={!path.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
