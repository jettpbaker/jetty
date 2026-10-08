import { useEffect, useState } from 'react'

import type { Sources } from './lanes'
import type { StreamMessage } from './wire'

export type StreamState = { sources: Sources | null; error: string | null; connected: boolean }

function apply(sources: Sources | null, message: StreamMessage): Sources | null {
  switch (message.type) {
    case 'snapshot':
      return {
        bot: message.bot,
        threads: new Map(message.threads.map((thread) => [thread.id, thread])),
        events: message.events,
        transcript: message.transcript,
      }
    case 'append': {
      if (!sources) return sources
      const threads = new Map(sources.threads)
      for (const thread of message.threads ?? []) threads.set(thread.id, thread)
      return {
        ...sources,
        threads,
        events: message.events ? [...sources.events, ...message.events] : sources.events,
        transcript: message.transcript
          ? [...sources.transcript, ...message.transcript]
          : sources.transcript,
      }
    }
    case 'error':
      return sources
  }
}

// Live sources for one bot: a snapshot, then appends. A reconnect starts from a fresh snapshot.
export function useBotStream(botId: string | null) {
  const [state, setState] = useState<StreamState>({
    sources: null,
    error: null,
    connected: false,
  })
  useEffect(() => {
    setState({ sources: null, error: null, connected: false })
    if (!botId) return
    const source = new EventSource(`/api/stream?bot=${encodeURIComponent(botId)}`)
    source.onopen = () => setState((previous) => ({ ...previous, connected: true }))
    source.onerror = () => setState((previous) => ({ ...previous, connected: false }))
    source.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as StreamMessage
      setState((previous) => ({
        sources: apply(previous.sources, message),
        error: message.type === 'error' ? message.message : null,
        connected: true,
      }))
    }
    return () => source.close()
  }, [botId])
  return state
}
