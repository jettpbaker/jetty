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

export class EchoAgent implements Agent {
  #controllers = new Map<string, AbortController>()

  interrupt(threadId: string) {
    this.#controllers.get(threadId)?.abort()
  }

  async startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void> {
    const prev = this.#controllers.get(input.threadId)
    prev?.abort()
    const ac = new AbortController()
    this.#controllers.set(input.threadId, ac)
    const { signal } = ac

    try {
      emit({ type: 'turn.started', turnId: input.turnId })

      const reasoningId = newId()
      const reasoning: ThreadItem = {
        id: reasoningId,
        turnId: input.turnId,
        createdAt: Date.now(),
        kind: 'reasoning',
        text: '',
      }
      emit({ type: 'item.started', item: reasoning })
      await this.#emitChunks(emit, reasoningId, 'Thinking about your message…', signal)
      emit({ type: 'item.completed', itemId: reasoningId })

      const toolId = newId()
      const tool: ThreadItem = {
        id: toolId,
        turnId: input.turnId,
        createdAt: Date.now(),
        kind: 'tool_call',
        toolName: 'echo',
        input: { text: input.text },
        output: '',
        status: 'running',
      }
      emit({ type: 'item.started', item: tool })
      await this.#emitChunks(emit, toolId, `echo: ${input.text}`, signal)
      emit({ type: 'item.completed', itemId: toolId, patch: { status: 'succeeded' } })

      const assistantId = newId()
      const assistant: ThreadItem = {
        id: assistantId,
        turnId: input.turnId,
        createdAt: Date.now(),
        kind: 'assistant_message',
        text: '',
      }
      emit({ type: 'item.started', item: assistant })
      await this.#emitChunks(emit, assistantId, input.text, signal)
      emit({ type: 'item.completed', itemId: assistantId })

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
      if (this.#controllers.get(input.threadId) === ac) {
        this.#controllers.delete(input.threadId)
      }
    }
  }

  async #emitChunks(
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
