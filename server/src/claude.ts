import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'

import {
  query,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { newId } from '@jetty/shared/wire'

import type { Agent, TurnInput } from './agent'
import type { Store } from './store'

import { createTranslateCtx, translate, type TranslateCtx } from './claude-translate'

export {
  translate,
  createTranslateCtx,
  type TranslateCtx,
  type SdkLikeMessage,
} from './claude-translate'

const DEFAULT_TTL_MS = 5 * 60 * 1000

type PendingApproval = {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
}

type TurnWaiter = {
  turnId: string
  resolve: () => void
}

type BurstSession = {
  threadId: string
  query: Query
  pushMessage: (text: string) => void
  endQueue: () => void
  activeTurnId: string
  pendingApprovals: Map<string, PendingApproval>
  idleTimer: ReturnType<typeof setTimeout> | null
  ctx: TranslateCtx
  emit: (event: ThreadEvent) => void
  closed: boolean
  awaitingResult: boolean
  failReason: string | null
  turnWaiter: TurnWaiter | null
}

function createQueue() {
  const pending: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  let done = false

  function notify() {
    const w = wake
    wake = null
    w?.()
  }

  return {
    push(text: string) {
      if (done) return
      pending.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
      })
      notify()
    },
    end() {
      done = true
      notify()
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (pending.length > 0) {
            yield pending.shift()!
          }
          if (done) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
    },
  }
}

export function createClaudeAgent(store: Store): Agent {
  const sessions = new Map<string, BurstSession>()
  const ttlMs = Number(process.env.JETTY_SESSION_TTL_MS ?? DEFAULT_TTL_MS)

  function clearIdle(session: BurstSession) {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  function settleTurn(session: BurstSession) {
    session.awaitingResult = false
    const waiter = session.turnWaiter
    if (waiter) {
      session.turnWaiter = null
      waiter.resolve()
    }
  }

  function denyPendingApprovals(session: BurstSession) {
    for (const [itemId, pending] of session.pendingApprovals) {
      try {
        session.emit({
          type: 'item.completed',
          itemId,
          patch: { decision: 'deny' satisfies ApprovalDecision },
        })
      } catch {
        // emit may fail if store is gone
      }
      pending.resolve({ behavior: 'deny', message: 'Denied by user' })
    }
    session.pendingApprovals.clear()
  }

  function closeBurst(threadId: string, reason?: string) {
    const session = sessions.get(threadId)
    if (!session || session.closed) return
    session.closed = true
    clearIdle(session)
    denyPendingApprovals(session)
    session.endQueue()
    try {
      session.query.close()
    } catch {
      // already closed
    }
    if (session.awaitingResult) {
      const error = reason ?? session.failReason ?? 'stream ended'
      try {
        session.emit({ type: 'turn.failed', turnId: session.activeTurnId, error })
      } catch {
        // store may be gone
      }
    }
    settleTurn(session)
    if (sessions.get(threadId) === session) {
      sessions.delete(threadId)
    }
  }

  function armIdle(session: BurstSession) {
    clearIdle(session)
    if (ttlMs === 0) {
      closeBurst(session.threadId)
      return
    }
    session.idleTimer = setTimeout(() => {
      closeBurst(session.threadId)
    }, ttlMs)
  }

  async function runLoop(session: BurstSession) {
    try {
      for await (const msg of session.query) {
        if (session.closed) break

        const events = translate(msg as Parameters<typeof translate>[0], session.ctx)

        if (session.ctx.sessionId) {
          store.setThreadSessionId(session.threadId, session.ctx.sessionId)
          session.ctx.sessionId = null
        }

        for (const event of events) {
          session.emit(event)
          if (event.type === 'turn.completed' || event.type === 'turn.failed') {
            settleTurn(session)
          }
        }

        if (msg.type === 'result' && !session.closed) {
          if (session.awaitingResult) {
            // result message without translate emitting (shouldn't happen) — still settle
            settleTurn(session)
          }
          armIdle(session)
        }
      }

      if (!session.closed) {
        closeBurst(session.threadId, session.failReason ?? 'stream ended')
      }
    } catch (err) {
      if (session.closed) return
      const message = err instanceof Error ? err.message : String(err)
      closeBurst(session.threadId, session.failReason ?? message)
    }
  }

  function spawnBurst(
    input: TurnInput,
    emit: (event: ThreadEvent) => void,
    projectPath: string
  ): BurstSession {
    const queue = createQueue()
    const sessionId = store.getThreadSessionId(input.threadId) ?? undefined
    const sessionRef: { current: BurstSession | null } = { current: null }

    const canUseTool: NonNullable<Options['canUseTool']> = async (toolName, toolInput, options) => {
      const session = sessionRef.current
      if (!session || session.closed) {
        return { behavior: 'deny', message: 'Session closed' }
      }

      const itemId = newId()
      const item: ThreadItem = {
        id: itemId,
        turnId: session.activeTurnId,
        createdAt: Date.now(),
        kind: 'approval',
        title: options.title ?? toolName,
        toolName,
        input: toolInput,
        suggestions: options.suggestions ?? [],
      }
      session.emit({ type: 'item.started', item })
      session.emit({ type: 'session.status', status: 'awaiting_approval' })

      return new Promise<PermissionResult>((resolve) => {
        session.pendingApprovals.set(itemId, { resolve, input: toolInput })
      })
    }

    const permissionMode = (input.permissionMode ?? 'auto') as NonNullable<
      Options['permissionMode']
    >
    const options: Options = {
      cwd: projectPath,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      model: input.model,
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
      includePartialMessages: true,
      canUseTool,
      resume: sessionId,
    }

    const q = query({ prompt: queue.iterable, options })

    const session: BurstSession = {
      threadId: input.threadId,
      query: q,
      pushMessage: queue.push,
      endQueue: queue.end,
      activeTurnId: input.turnId,
      pendingApprovals: new Map(),
      idleTimer: null,
      ctx: createTranslateCtx(input.turnId),
      emit,
      closed: false,
      awaitingResult: true,
      failReason: null,
      turnWaiter: null,
    }
    sessionRef.current = session
    sessions.set(input.threadId, session)
    void runLoop(session)
    return session
  }

  function beginTurn(
    session: BurstSession,
    input: TurnInput,
    emit: (event: ThreadEvent) => void
  ): Promise<void> {
    clearIdle(session)
    session.activeTurnId = input.turnId
    session.ctx = createTranslateCtx(input.turnId)
    session.emit = emit
    session.awaitingResult = true
    session.failReason = null

    return new Promise<void>((resolve) => {
      session.turnWaiter = { turnId: input.turnId, resolve }
      emit({ type: 'turn.started', turnId: input.turnId })
      session.pushMessage(input.text)
    })
  }

  return {
    async startTurn(input: TurnInput, emit: (event: ThreadEvent) => void): Promise<void> {
      const thread = store.getThread(input.threadId)
      if (!thread) throw new Error(`Thread ${input.threadId} not found`)
      const project = store.getProject(thread.projectId)
      if (!project) throw new Error(`Project ${thread.projectId} not found`)

      const existing = sessions.get(input.threadId)
      if (existing && !existing.closed) {
        return beginTurn(existing, input, emit)
      }

      const session = spawnBurst(input, emit, project.path)
      return beginTurn(session, input, emit)
    },

    steer(threadId: string, text: string): boolean {
      const session = sessions.get(threadId)
      if (!session || session.closed) return false
      clearIdle(session)
      session.pushMessage(text)
      return true
    },

    interrupt(threadId: string, reason = 'interrupted') {
      const session = sessions.get(threadId)
      if (!session || session.closed) return
      session.failReason = reason
      const interruptedTurnId = session.activeTurnId
      denyPendingApprovals(session)
      void session.query.interrupt().catch(() => {})
      setTimeout(() => {
        if (
          sessions.get(threadId) === session &&
          !session.closed &&
          session.activeTurnId === interruptedTurnId
        ) {
          closeBurst(threadId, session.failReason ?? reason)
        }
      }, 2000)
    },

    respondToApproval(
      threadId: string,
      itemId: string,
      decision: ApprovalDecision,
      updatedPermissions?: unknown[]
    ): boolean {
      const session = sessions.get(threadId)
      if (!session || session.closed) return false
      const pending = session.pendingApprovals.get(itemId)
      if (!pending) return false
      session.pendingApprovals.delete(itemId)

      session.emit({ type: 'item.completed', itemId, patch: { decision } })
      session.emit({ type: 'session.status', status: 'running' })

      if (decision === 'allow') {
        pending.resolve({
          behavior: 'allow',
          updatedInput: pending.input,
          updatedPermissions: updatedPermissions as PermissionUpdate[] | undefined,
        })
      } else {
        pending.resolve({ behavior: 'deny', message: 'Denied by user' })
      }
      return true
    },
  }
}
