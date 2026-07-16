import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

import { newId } from '@jetty/shared/wire'

export type TurnInput = {
  threadId: string
  turnId: string
  text: string
}

export type Agent = {
  startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void>
  interrupt(threadId: string): void
}

const CHUNK_MS = 8
const STEP_MS = 5

export function createEchoAgent(): Agent {
  const controllers = new Map<string, AbortController>()

  async function emitChunks(
    emit: (event: ThreadEvent) => void,
    itemId: string,
    text: string,
    signal: AbortSignal
  ) {
    const size = Math.max(1, Math.ceil(text.length / 4))
    for (let i = 0; i < text.length; i += size) {
      await sleep(CHUNK_MS, signal)
      emit({ type: 'item.delta', itemId, delta: text.slice(i, i + size) })
    }
    await sleep(STEP_MS, signal)
  }

  return {
    interrupt(threadId: string) {
      controllers.get(threadId)?.abort()
    },

    async startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void> {
      controllers.get(input.threadId)?.abort()
      const ac = new AbortController()
      controllers.set(input.threadId, ac)
      const { signal } = ac

      try {
        emit({ type: 'turn.started', turnId: input.turnId })

        const reasoning: ThreadItem = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'reasoning',
          text: '',
        }
        emit({ type: 'item.started', item: reasoning })
        await emitChunks(emit, reasoning.id, 'Thinking about your message…', signal)
        emit({ type: 'item.completed', itemId: reasoning.id })

        const tool: ThreadItem = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'tool_call',
          toolName: 'echo',
          input: { text: input.text },
          output: '',
          status: 'running',
        }
        emit({ type: 'item.started', item: tool })
        await emitChunks(emit, tool.id, `echo: ${input.text}`, signal)
        emit({ type: 'item.completed', itemId: tool.id, patch: { status: 'succeeded' } })

        const assistant: ThreadItem = {
          id: newId(),
          turnId: input.turnId,
          createdAt: Date.now(),
          kind: 'assistant_message',
          text: '',
        }
        emit({ type: 'item.started', item: assistant })
        await emitChunks(emit, assistant.id, input.text, signal)
        emit({ type: 'item.completed', itemId: assistant.id })

        emit({
          type: 'turn.completed',
          turnId: input.turnId,
          usage: { inputTokens: input.text.length, outputTokens: input.text.length },
          costUsd: 0,
        })
      } catch (err) {
        if (!isAbortError(err)) throw err
        emit({ type: 'turn.failed', turnId: input.turnId, error: 'interrupted' })
      } finally {
        if (controllers.get(input.threadId) === ac) {
          controllers.delete(input.threadId)
        }
      }
    },
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
