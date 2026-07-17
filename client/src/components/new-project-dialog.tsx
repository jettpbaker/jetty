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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FormEvent, useState } from 'react'

export function NewProjectDialog() {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [title, setTitle] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPath = path.trim()
    if (!trimmedPath) return
    void socket.request('project.create', {
      path: trimmedPath,
      title: title.trim() || undefined,
    })
    setPath('')
    setTitle('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant='outline' size='sm' className='w-full'>
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Point jetty at a project directory.</DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='project-path'>Path</Label>
              <Input
                id='project-path'
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder='/Users/me/code/project'
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='project-title'>Title (optional)</Label>
              <Input
                id='project-title'
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder='My project'
              />
            </div>
          </div>
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
