import type { SessionStatus } from '@jetty/shared/events'
import type { ChatStatus } from 'ai'
import type { MouseEvent } from 'react'

import { socket } from '@/app-state'
import {
  PromptInput,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'

function chatStatus(status: SessionStatus): ChatStatus {
  return status === 'running' || status === 'starting' ? 'streaming' : 'ready'
}

export function Composer({ threadId, status }: { threadId: string; status: SessionStatus }) {
  const busy = status === 'running' || status === 'starting'

  function handleSubmit(message: PromptInputMessage) {
    const text = message.text.trim()
    if (!text) return
    void socket.request('turn.start', { threadId, text })
  }

  // The submit control sends while idle; while a turn runs it stops instead of
  // starting another (Enter still starts — the server steers the active turn).
  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    if (!busy) return
    event.preventDefault()
    void socket.request('turn.interrupt', { threadId })
  }

  return (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea placeholder='Message the agent…' />
      <PromptInputFooter>
        <PromptInputSubmit
          className='ml-auto'
          status={chatStatus(status)}
          onClick={handleSubmitClick}
        />
      </PromptInputFooter>
    </PromptInput>
  )
}
