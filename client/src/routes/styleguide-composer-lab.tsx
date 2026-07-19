import type { ChatStatus } from 'ai'
import type { MouseEvent } from 'react'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { composerShell } from '@/components/composer'
import { acceptImages } from '@/lib/attachments'
import { PaperclipIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'

// Bench for the composer: every state it can be in, side by side, plus a live
// instance that walks the ready → streaming → ready loop. Reuses the real
// PromptInput primitives and the real shell classes so this is visual truth,
// not a mockup.

function RackLabel({ name }: { name: string }) {
  return (
    <div className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
      {name}
    </div>
  )
}

function AttachButton() {
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton aria-label='Attach images' onClick={() => attachments.openFileDialog()}>
      <PaperclipIcon className='size-4' />
    </PromptInputButton>
  )
}

function Attachments() {
  return (
    <PromptInputAttachments>
      {(attachment) => <PromptInputAttachment data={attachment} />}
    </PromptInputAttachments>
  )
}

function BenchComposer({
  status,
  initialInput,
  disabled,
}: {
  status: ChatStatus
  initialInput?: string
  disabled?: boolean
}) {
  return (
    <div className={composerShell}>
      <PromptInputProvider initialInput={initialInput} validateFiles={acceptImages}>
        <PromptInput accept='image/*' multiple onSubmit={() => {}}>
          <Attachments />
          <PromptInputTextarea placeholder='Message the agent…' disabled={disabled} />
          <PromptInputFooter>
            <AttachButton />
            <PromptInputSubmit className='ml-auto' status={status} disabled={disabled} />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

const BENCH_STATES: Array<{
  label: string
  note: string
  status: ChatStatus
  initialInput?: string
  disabled?: boolean
}> = [
  { label: 'ready · empty', note: 'draft page and idle threads', status: 'ready' },
  {
    label: 'ready · with text',
    note: 'restored draft',
    status: 'ready',
    initialInput: 'Profile the timeline render and find what re-renders per token.',
  },
  {
    label: 'streaming',
    note: 'agent running — submit becomes interrupt',
    status: 'streaming',
    initialInput: 'also check the reducer',
  },
  {
    label: 'sending first turn',
    note: 'thread.create in flight — locked until it lands',
    status: 'submitted',
    initialInput: 'Profile the timeline render.',
    disabled: true,
  },
  {
    label: 'send failed',
    note: 'thread.create rejected — press send to retry',
    status: 'error',
    initialInput: 'Profile the timeline render.',
  },
]

// Ready → streaming on submit, back on interrupt-click or after a fake turn.
function LiveComposer() {
  const [streaming, setStreaming] = useState(false)
  const timer = useRef<number | null>(null)

  function stop() {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setStreaming(false)
  }

  function handleSubmit(message: PromptInputMessage) {
    if (!message.text.trim() && message.files.length === 0) return
    setStreaming(true)
    timer.current = window.setTimeout(stop, 4000)
  }

  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    if (!streaming) return
    event.preventDefault()
    stop()
  }

  return (
    <div className={composerShell}>
      <PromptInputProvider validateFiles={acceptImages}>
        <PromptInput accept='image/*' multiple onSubmit={handleSubmit}>
          <Attachments />
          <PromptInputTextarea placeholder='Message the agent…' />
          <PromptInputFooter>
            <AttachButton />
            <PromptInputSubmit
              className='ml-auto'
              status={streaming ? 'streaming' : 'ready'}
              onClick={handleSubmitClick}
            />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}

export function ComposerLab() {
  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-12 p-8'>
      <h1 className='text-2xl font-semibold tracking-tight'>Composer lab</h1>
      <section className='flex flex-col gap-6'>
        <RackLabel name='states' />
        {BENCH_STATES.map((bench) => (
          <div key={bench.label} className='flex flex-col gap-2'>
            <div className='text-xs text-muted-foreground'>
              <span className='text-foreground'>{bench.label}</span> — {bench.note}
            </div>
            <BenchComposer
              status={bench.status}
              initialInput={bench.initialInput}
              disabled={bench.disabled}
            />
          </div>
        ))}
      </section>
      <section className='flex flex-col gap-4'>
        <RackLabel name='live · submit streams for 4s, click again to interrupt' />
        <LiveComposer />
      </section>
    </div>
  )
}
