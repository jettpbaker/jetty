import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'

import { ToolCallField } from '@/components/tool-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pressHandlers } from '@/lib/press-handlers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type ApprovalItem = Extract<ThreadItem, { kind: 'approval' }>

export function ApprovalDock({
  item,
  respond,
  defaultMessageOpen = false,
}: {
  item: ApprovalItem
  respond: (decision: ApprovalDecision, message?: string) => Promise<unknown>
  defaultMessageOpen?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [messageOpen, setMessageOpen] = useState(defaultMessageOpen)
  const [message, setMessage] = useState('')
  const allowRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const run = useCallback(
    (decision: ApprovalDecision, text?: string) => {
      setPending(true)
      respond(decision, text).catch(() => {
        setPending(false)
        toast.error('Couldn’t respond to the approval.')
      })
    },
    [respond]
  )

  const closeMessage = useCallback(() => {
    setMessageOpen(false)
    setMessage('')
  }, [])

  useEffect(() => {
    if (messageOpen) inputRef.current?.focus()
    else allowRef.current?.focus()
  }, [messageOpen])

  // Enter/Esc drive the dock; while the message input is open they steer that
  // sub-state instead (Enter submits the deny, Esc backs out to the buttons).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (pending) return
      if (messageOpen) {
        if (event.key === 'Enter') {
          event.preventDefault()
          run('deny', message.trim() || undefined)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          closeMessage()
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        run('allow')
      } else if (event.key === 'Escape') {
        event.preventDefault()
        run('deny')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pending, messageOpen, message, run, closeMessage])

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-border bg-card/70 p-3 backdrop-blur-lg'>
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='truncate text-sm text-foreground'>{item.title}</span>
        <ToolCallField toolName={item.toolName} input={item.input} />
      </div>

      {messageOpen ? (
        <div className='flex items-center gap-2'>
          <Input
            ref={inputRef}
            disabled={pending}
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder='Tell Claude what to do differently'
          />
          <Button variant='ghost' size='sm' disabled={pending} {...pressHandlers(closeMessage)}>
            Back
          </Button>
          <Button
            variant='destructive'
            size='sm'
            disabled={pending}
            onClick={() => run('deny', message.trim() || undefined)}
          >
            Deny
          </Button>
        </div>
      ) : (
        <div className='flex items-center gap-2'>
          <Button
            variant='ghost-text'
            size='sm'
            disabled={pending}
            className='mr-auto'
            {...pressHandlers(() => setMessageOpen(true))}
          >
            Deny with a message
          </Button>
          <Button
            variant='ghost'
            size='sm'
            disabled={pending}
            {...pressHandlers(() => run('deny'))}
          >
            Deny
          </Button>
          <Button ref={allowRef} disabled={pending} {...pressHandlers(() => run('allow'))}>
            Allow
          </Button>
        </div>
      )}
    </div>
  )
}
