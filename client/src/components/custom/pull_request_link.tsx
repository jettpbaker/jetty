import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useLinkPullRequest } from '@/state'
import { useState, type FormEvent } from 'react'

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
    if (!reference || pending) return
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
            <Input
              aria-label='Pull request URL or number'
              aria-invalid={error ? true : undefined}
              placeholder='URL or number'
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                setError(undefined)
              }}
            />
            {error && <p className='text-xs text-destructive'>{error}</p>}
          </div>
          <DialogFooter>
            <Button type='button' variant='ghost' onClick={() => change(false)}>
              Cancel
            </Button>
            <Button type='submit' disabled={!draft.trim() || pending}>
              Link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
