import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useLinkPullRequest, useThreadMeta } from '@/state'
import { useProject } from '@/state/chrome'
import { useState, type FormEvent } from 'react'

function validReference(value: string) {
  const reference = value.trim()
  const number = reference.match(/^#?([0-9]+)$/)?.[1]
  if (number) return Number.isSafeInteger(Number(number)) && Number(number) > 0
  try {
    const url = new URL(reference.startsWith('github.com/') ? `https://${reference}` : reference)
    const parts = url.pathname.split('/').filter(Boolean)
    const pull = Number(parts[3])
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.hostname.toLowerCase() === 'github.com' &&
      /^[A-Za-z0-9_.-]+$/.test(parts[0] ?? '') &&
      /^[A-Za-z0-9_.-]+$/.test(parts[1] ?? '') &&
      parts[2] === 'pull' &&
      Number.isSafeInteger(pull) &&
      pull > 0
    )
  } catch {
    return false
  }
}

export function LinkPullRequestDialog({
  threadId,
  open,
  onOpenChange,
}: {
  threadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const link = useLinkPullRequest()
  const thread = useThreadMeta(threadId)
  const project = useProject(thread?.projectId)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  function change(next: boolean) {
    if (!next) {
      setDraft('')
      setError(undefined)
    }
    onOpenChange(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const reference = draft.trim()
    if (!validReference(reference) || pending) return
    setPending(true)
    const failure = await link(threadId, reference)
    setPending(false)
    if (failure) setError(failure)
    else change(false)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogTitle>Link pull request</DialogTitle>
        <form className='flex flex-col gap-4' onSubmit={submit}>
          <div className='flex flex-col gap-2'>
            <label htmlFor='pull-request-reference' className='sr-only'>
              Pull request
            </label>
            <Input
              id='pull-request-reference'
              aria-describedby={
                error ? 'pull-request-scope pull-request-error' : 'pull-request-scope'
              }
              aria-label='Pull request URL or number'
              aria-invalid={error ? true : undefined}
              placeholder='#123 or GitHub URL'
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setError(undefined)
              }}
            />
            <p id='pull-request-scope' className='text-xs leading-5 text-muted-foreground'>
              Enter a pull request number from {project ? `${project.title}’s` : 'this project’s'}{' '}
              GitHub repository, or a GitHub URL from any repository.
            </p>
            {error && (
              <p id='pull-request-error' role='alert' className='text-xs text-destructive'>
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type='button' variant='ghost' onClick={() => change(false)}>
              Cancel
            </Button>
            <Button
              type='submit'
              aria-describedby='pull-request-scope'
              aria-busy={pending}
              disabled={!validReference(draft) || pending}
            >
              Link pull request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
