import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'
import type { EffortLevel, PermissionMode, UploadAttachment } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'

/** Image payload for the agent seam — no SDK types. */
export type AgentImage = {
  mimeType: UploadAttachment['mimeType']
  base64data: string
}

export type TurnInput = {
  threadId: string
  turnId: string
  text: string
  images?: AgentImage[]
  model?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
}

export type Agent = {
  startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void>
  /** Optional reason becomes the turn.failed error (default 'interrupted'). */
  interrupt(threadId: string, reason?: string): void
  steer(threadId: string, text: string, images?: AgentImage[]): boolean
  respondToApproval(
    threadId: string,
    itemId: string,
    decision: ApprovalDecision,
    message?: string,
    updatedPermissions?: unknown[]
  ): boolean
  respondToQuestion(threadId: string, itemId: string, answers: Record<string, string>): boolean
}

const CHUNK_MS = 8
const STEP_MS = 5

type EchoSession = {
  ac: AbortController
  emit: (event: ThreadEvent) => void
  assistantId: string | null
  pendingSteer: string[]
}

export function createEchoAdapter(): Agent {
  const sessions = new Map<string, EchoSession>()

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
      sessions.get(threadId)?.ac.abort()
    },

    steer(threadId: string, text: string, _images?: AgentImage[]): boolean {
      const session = sessions.get(threadId)
      if (!session) return false
      if (session.assistantId) {
        session.emit({ type: 'item.delta', itemId: session.assistantId, delta: text })
      } else {
        session.pendingSteer.push(text)
      }
      return true
    },

    respondToApproval(): boolean {
      return false
    },

    respondToQuestion(): boolean {
      return false
    },

    async startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void> {
      sessions.get(input.threadId)?.ac.abort()
      const ac = new AbortController()
      const session: EchoSession = {
        ac,
        emit,
        assistantId: null,
        pendingSteer: [],
      }
      sessions.set(input.threadId, session)
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
        session.assistantId = assistant.id
        emit({ type: 'item.started', item: assistant })
        await emitChunks(emit, assistant.id, input.text, signal)
        for (const steered of session.pendingSteer) {
          await emitChunks(emit, assistant.id, steered, signal)
        }
        session.pendingSteer = []
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
        if (sessions.get(input.threadId) === session) {
          sessions.delete(input.threadId)
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
