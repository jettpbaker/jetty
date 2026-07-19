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
import { newId, type PermissionMode } from '@jetty/shared/wire'

import type { Agent, AgentImage, TurnInput } from './agent'
import type { Store } from './store'

import { createTranslateCtx, translate, type TranslateCtx } from './claude-translate'

const DEFAULT_TTL_MS = 10 * 60 * 1000
/** Fallback when a turn omits model — the composer normally always sends one. */
const DEFAULT_MODEL = 'haiku'

type SdkPermissionMode = NonNullable<Options['permissionMode']>

/** Map jetty wire PermissionMode → Claude Agent SDK permissionMode. */
function toSdkPermissionMode(mode: PermissionMode | undefined): SdkPermissionMode {
  switch (mode ?? 'auto') {
    case 'full_access':
      return 'bypassPermissions'
    case 'plan':
      return 'plan'
    case 'auto':
      return 'auto'
  }
}

type PendingApproval = {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
}

type TurnWaiter = {
  turnId: string
  resolve: () => void
}

type WarmSession = {
  threadId: string
  query: Query
  pushMessage: (text: string, images?: AgentImage[]) => void
  endQueue: () => void
  /** resolved model/effort/permission fingerprint the session was spawned with */
  spawnKey: string
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

/** Resolved options a session runs under; a mismatch means recycle. */
function turnOptionsKey(input: TurnInput): string {
  const model = input.model ?? process.env.JETTY_DEFAULT_MODEL ?? DEFAULT_MODEL
  return `${model}|${input.effort ?? ''}|${toSdkPermissionMode(input.permissionMode)}`
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
    push(text: string, images?: AgentImage[]) {
      if (done) return
      const content =
        images && images.length > 0
          ? [
              ...images.map((img) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: img.mimeType,
                  data: img.base64data,
                },
              })),
              { type: 'text' as const, text },
            ]
          : text
      pending.push({
        type: 'user',
        message: { role: 'user', content },
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

export function createClaudeAdapter(store: Store): Agent {
  const sessions = new Map<string, WarmSession>()
  const ttlMs = Number(process.env.JETTY_SESSION_TTL_MS ?? DEFAULT_TTL_MS)

  function clearIdle(session: WarmSession) {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
  }

  function settleTurn(session: WarmSession) {
    session.awaitingResult = false
    const waiter = session.turnWaiter
    if (waiter) {
      session.turnWaiter = null
      waiter.resolve()
    }
  }

  function denyPendingApprovals(session: WarmSession) {
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

  function closeSession(threadId: string, reason?: string) {
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

  function armIdle(session: WarmSession) {
    clearIdle(session)
    if (ttlMs === 0) {
      closeSession(session.threadId)
      return
    }
    session.idleTimer = setTimeout(() => {
      closeSession(session.threadId)
    }, ttlMs)
  }

  async function runLoop(session: WarmSession) {
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
        closeSession(session.threadId, session.failReason ?? 'stream ended')
      }
    } catch (err) {
      if (session.closed) return
      const message = err instanceof Error ? err.message : String(err)
      closeSession(session.threadId, session.failReason ?? message)
    }
  }

  function spawnSession(
    input: TurnInput,
    emit: (event: ThreadEvent) => void,
    projectPath: string
  ): WarmSession {
    const queue = createQueue()
    const sessionId = store.getThreadSessionId(input.threadId) ?? undefined
    const sessionRef: { current: WarmSession | null } = { current: null }

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

    const permissionMode = toSdkPermissionMode(input.permissionMode)
    const options: Options = {
      cwd: projectPath,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      model: input.model ?? process.env.JETTY_DEFAULT_MODEL ?? DEFAULT_MODEL,
      effort: input.effort,
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
      includePartialMessages: true,
      canUseTool,
      resume: sessionId,
    }

    const q = query({ prompt: queue.iterable, options })

    const session: WarmSession = {
      threadId: input.threadId,
      query: q,
      pushMessage: queue.push,
      endQueue: queue.end,
      spawnKey: turnOptionsKey(input),
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
    session: WarmSession,
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
      session.pushMessage(input.text, input.images)
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
        // mid-turn the options can't change anyway; otherwise a picker change
        // recycles the session — the fresh one resumes the stored CC
        // sessionId, so conversation context survives
        if (existing.awaitingResult || existing.spawnKey === turnOptionsKey(input)) {
          return beginTurn(existing, input, emit)
        }
        closeSession(input.threadId)
      }

      const session = spawnSession(input, emit, project.path)
      return beginTurn(session, input, emit)
    },

    steer(threadId: string, text: string, images?: AgentImage[]): boolean {
      const session = sessions.get(threadId)
      if (!session || session.closed) return false
      clearIdle(session)
      session.pushMessage(text, images)
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
          closeSession(threadId, session.failReason ?? reason)
        }
      }, 2000)
    },

    respondToApproval(
      threadId: string,
      itemId: string,
      decision: ApprovalDecision,
      message?: string,
      updatedPermissions?: unknown[]
    ): boolean {
      const session = sessions.get(threadId)
      if (!session || session.closed) return false
      const pending = session.pendingApprovals.get(itemId)
      if (!pending) return false
      session.pendingApprovals.delete(itemId)

      if (decision === 'allow') {
        session.emit({ type: 'item.completed', itemId, patch: { decision } })
        session.emit({ type: 'session.status', status: 'running' })
        pending.resolve({
          behavior: 'allow',
          updatedInput: pending.input,
          updatedPermissions: updatedPermissions as PermissionUpdate[] | undefined,
        })
      } else {
        const reason = message?.trim() ? message.trim() : undefined
        session.emit({
          type: 'item.completed',
          itemId,
          patch: { decision, ...(reason ? { deniedReason: reason } : {}) },
        })
        session.emit({ type: 'session.status', status: 'running' })
        pending.resolve({ behavior: 'deny', message: reason ?? 'Denied by user' })
      }
      return true
    },
  }
}
