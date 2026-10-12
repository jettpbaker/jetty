import type { ThreadItem, WorkflowAgent } from '@jetty/shared/items'
import type { BackgroundTask } from '@jetty/shared/wire'

import { newId } from '@jetty/shared/wire'
import { Effect, Semaphore } from 'effect'

import type { Agent, AgentError, AgentHooks, Emit, TurnInput } from './agent'

type Preview = {
  tasks: BackgroundTask[]
  working: () => boolean
  endTasks: (taskId?: string) => Effect.Effect<void, AgentError>
  endWorkflow: (taskId: string) => Effect.Effect<boolean, AgentError>
  stop: Effect.Effect<void, AgentError>
}

// Echo can keep live UI visible without launching real commands or agents.
export function createEchoBusy(hooks: AgentHooks, durationMs: number) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope
    const publication = yield* Semaphore.make(1)
    const previews = new Map<string, Set<Preview>>()

    function publishTasks(threadId: string) {
      const tasks = [...(previews.get(threadId) ?? [])].flatMap((preview) => preview.tasks)
      return hooks.onBackgroundTasks?.(threadId, tasks) ?? Effect.void
    }

    function start(input: TurnInput, emit: Emit) {
      return publication.withPermit(
        Effect.gen(function* () {
          const startedAt = Date.now()
          const itemBase = () => ({ id: newId(), turnId: input.turnId, createdAt: startedAt })
          const backgrounds = [
            {
              ...itemBase(),
              kind: 'background',
              taskId: newId(),
              task: 'monitor',
              label: 'Watch the deploy logs for errors',
            },
            {
              ...itemBase(),
              kind: 'background',
              taskId: newId(),
              task: 'command',
              label: 'bun test --watch',
            },
          ] satisfies ThreadItem[]
          const subagent = {
            ...itemBase(),
            kind: 'subagent',
            title: 'Reproduce the flaky-network drop',
            prompt: 'Reproduce the flaky-network drop and report the reconnect behavior.',
            status: 'running',
          } satisfies ThreadItem
          const workflow = {
            ...itemBase(),
            kind: 'workflow',
            taskId: newId(),
            name: 'reconnect-review',
            description: 'Reproduce the drop and review reconnect handling.',
            provider: 'claude',
            status: 'running',
            phases: [
              { index: 0, title: 'Reproduce' },
              { index: 1, title: 'Review' },
            ],
            agents: [
              'Reproduce the drop',
              'Trace reconnect events',
              'Review recovery',
              'Check regression coverage',
            ].map(
              (label, index): WorkflowAgent => ({
                id: newId(),
                label,
                phase: Math.floor(index / 2),
                state: 'queued',
                tokens: 0,
                toolCalls: 0,
              })
            ),
            tokens: 0,
            durationMs: 0,
          } satisfies ThreadItem
          let agents = workflow.agents
          let agentRunning = true
          let workflowRunning = true

          function endTasks(taskId?: string) {
            return Effect.gen(function* () {
              for (const item of backgrounds) {
                if (taskId && item.taskId !== taskId) continue
                if (!preview.tasks.some((task) => task.id === item.taskId)) continue
                yield* emit({
                  type: 'item.completed',
                  itemId: item.id,
                  patch: { endedAt: Date.now() },
                })
                preview.tasks = preview.tasks.filter((task) => task.id !== item.taskId)
              }
              yield* publishTasks(input.threadId)
            })
          }

          function endWorkflow(status: 'completed' | 'stopped') {
            return Effect.gen(function* () {
              if (!workflowRunning) return
              yield* emit({
                type: 'item.completed',
                itemId: workflow.id,
                patch: {
                  status,
                  durationMs: Date.now() - startedAt,
                  ...(status === 'completed'
                    ? {
                        agents: agents.map((agent) => ({ ...agent, state: 'done' as const })),
                        summary:
                          'Reconnect review complete. Recovery and regression coverage checked.',
                      }
                    : { stopReason: 'you' }),
                },
              })
              workflowRunning = false
            })
          }

          function finish(status: 'completed' | 'stopped') {
            return Effect.gen(function* () {
              if (agentRunning) {
                yield* emit({
                  type: 'item.completed',
                  itemId: subagent.id,
                  patch: {
                    status,
                    durationMs: Date.now() - startedAt,
                    ...(status === 'completed'
                      ? {
                          result:
                            'Reproduced the drop; reconnect recovered without losing the message.',
                        }
                      : {}),
                  },
                })
                agentRunning = false
              }
              yield* endWorkflow(status)
              yield* endTasks()
              previews.get(input.threadId)?.delete(preview)
              if (!previews.get(input.threadId)?.size) previews.delete(input.threadId)
            })
          }

          const preview: Preview = {
            tasks: backgrounds.map((item) => ({
              id: item.taskId,
              kind: item.task,
              label: item.label,
              startedAt,
            })),
            working: () => agentRunning || workflowRunning,
            endTasks,
            endWorkflow: (taskId) =>
              workflow.taskId === taskId && workflowRunning
                ? endWorkflow('stopped').pipe(Effect.as(true))
                : Effect.succeed(false),
            stop: finish('stopped'),
          }
          const live = previews.get(input.threadId) ?? new Set<Preview>()
          live.add(preview)
          previews.set(input.threadId, live)

          yield* Effect.gen(function* () {
            for (const item of [...backgrounds, subagent, workflow])
              yield* emit({ type: 'item.started', item })
            yield* publishTasks(input.threadId)
          }).pipe(Effect.onError(() => finish('stopped').pipe(Effect.ignore)))

          yield* Effect.gen(function* () {
            let elapsed = 0
            let step = 0
            while (
              elapsed < durationMs &&
              (agentRunning || workflowRunning || preview.tasks.length)
            ) {
              const delay = Math.min(3000, durationMs - elapsed)
              yield* Effect.sleep(delay)
              elapsed += delay
              step++
              yield* publication.withPermit(
                Effect.gen(function* () {
                  if (!workflowRunning) return
                  const stage = Math.min(step, 7)
                  agents = agents.map((agent, index) => {
                    const state =
                      index < Math.floor(stage / 2)
                        ? 'done'
                        : index === Math.floor(stage / 2) && stage % 2
                          ? 'active'
                          : 'queued'
                    return {
                      ...agent,
                      state,
                      ...(state === 'active'
                        ? {
                            startedAt: agent.startedAt ?? Date.now(),
                            tokens: agent.tokens + 64,
                            toolCalls: agent.toolCalls + 1,
                          }
                        : {}),
                    }
                  })
                  yield* emit({
                    type: 'item.updated',
                    itemId: workflow.id,
                    patch: {
                      agents,
                      tokens: agents.reduce((sum, agent) => sum + agent.tokens, 0),
                      durationMs: elapsed,
                    },
                  })
                })
              )
            }
            yield* publication.withPermit(finish('completed'))
          }).pipe(
            Effect.onExit(() => publication.withPermit(finish('stopped')).pipe(Effect.ignore)),
            Effect.forkIn(scope)
          )
        })
      )
    }

    return {
      start,
      busy: (threadId) => [...(previews.get(threadId) ?? [])].some((preview) => preview.working()),
      stopBackgroundTasks(threadId, taskId?: string) {
        return publication.withPermit(
          Effect.gen(function* () {
            for (const preview of previews.get(threadId) ?? [])
              yield* taskId ? preview.endTasks(taskId) : preview.stop
          })
        )
      },
      stopWorkflow(threadId, taskId) {
        return publication.withPermit(
          Effect.gen(function* () {
            for (const preview of previews.get(threadId) ?? [])
              if (yield* preview.endWorkflow(taskId)) return true
            return false
          })
        )
      },
    } satisfies Pick<Agent, 'busy' | 'stopBackgroundTasks' | 'stopWorkflow'> & {
      start: typeof start
    }
  })
}
