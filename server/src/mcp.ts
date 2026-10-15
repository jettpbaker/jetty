import {
  SEARCH_WIKI_DESCRIPTION,
  SEARCH_THREADS_DESCRIPTION,
  SEARCH_DEFAULT_K,
  SEARCH_MAX_K,
  SEARCH_QUERY_MAX,
} from '@jetty/shared/bot-search'
import { SessionStatus } from '@jetty/shared/events'
import { heldByRestarts, type ThreadItem } from '@jetty/shared/items'
import { baseModelId, findProviderModel } from '@jetty/shared/model-name'
import {
  newId,
  worktreeSetupPrompt,
  type Bot,
  type BotTask,
  type ProviderModel,
  type ProviderId,
  type ThreadMeta,
  type WireError,
} from '@jetty/shared/wire'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Effect, FileSystem, Path, Scope } from 'effect'
import { ChildProcessSpawner } from 'effect/process'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import type { Attachments } from './attachments'
import type { Desktops } from './desktops'
import type { McpIdentity, McpSessions } from './mcp-sessions'
import type { Orchestrator } from './orchestrator'
import type { PullRequestLinks } from './pull-requests'
import type { SearchService } from './search/service'
import type { Store } from './store'
import type { Worktrees } from './worktrees'

import { approvalCommand, botApproval, lowerFirst } from './bot-approval'
import { commitManagedBotFiles, editManagedBotFiles, restoreManagedBotFiles } from './bot-home'
import { relayedMessage } from './jetty-instructions'
import { parsePullRequestUrl } from './pull-requests'
import { createSendImagesTool } from './send-images'
import { createSendVideoTool } from './send-video'
import { listProviderSkills } from './skills'
import { StoreError } from './store'
import { NUMBERED } from './titler'

const providerNames = { claude: 'Claude', codex: 'Codex', grok: 'Grok', copilot: 'GitHub Copilot' }
const modelKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function modelOptions(catalog: readonly ProviderModel[]) {
  return catalog
    .map(
      (m) =>
        `${providerNames[m.provider]} ${m.name} (${m.id}; efforts: ${m.efforts.join(', ') || 'none'})`
    )
    .join('; ')
}

function matchProject(
  projects: readonly { id: string; title: string; path: string }[],
  name: string | undefined,
  callerProjectId: string
) {
  if (!name) {
    const project = projects.find((item) => item.id === callerProjectId)
    return project
      ? Effect.succeed(project)
      : Effect.fail(new StoreError('not_found', 'Project not found'))
  }
  const key = name.toLowerCase()
  const matches = projects.filter((item) => item.title.toLowerCase() === key)
  if (matches.length === 1) return Effect.succeed(matches[0]!)
  const available = projects.map((item) => item.title).join(', ') || 'none'
  return Effect.fail(
    new StoreError(
      'invalid_params',
      matches.length === 0
        ? `Unknown project ${name}. Available: ${available}`
        : `Ambiguous project ${name}. Available: ${available}`
    )
  )
}

// A model more than one provider offers (gpt-6.1-sol on Codex and Copilot) needs the provider
// named: falling back to the caller's would quietly choose which subscription pays.
function requestedProvider(
  input: { provider?: ProviderId; model?: string },
  catalog: readonly ProviderModel[],
  fallback: ProviderId
) {
  if (input.provider) return Effect.succeed(input.provider)
  const providers = [
    ...new Set((input.model ? matchingModels(catalog, input.model) : []).map((m) => m.provider)),
  ]
  if (providers.length > 1)
    return Effect.fail(
      new StoreError(
        'invalid_params',
        `${input.model} is offered by ${providers.map((p) => providerNames[p]).join(' and ')}. Pass provider: ${providers.join(' or ')}.`
      )
    )
  return Effect.succeed(providers[0] ?? fallback)
}

function matchingModels(catalog: readonly ProviderModel[], name: string) {
  const key = modelKey(name)
  const exact = catalog.filter(
    (m) =>
      modelKey(m.id) === key ||
      modelKey(m.name) === key ||
      (m.resolvedId !== undefined && modelKey(m.resolvedId) === key)
  )
  if (exact.length) return exact
  const variant = catalog.filter(
    (m) =>
      baseModelId(m.id) === baseModelId(name) ||
      (m.resolvedId !== undefined && baseModelId(m.resolvedId) === baseModelId(name))
  )
  if (variant.length) return variant
  return catalog.filter((m) =>
    [m.id, m.name].some((label) =>
      label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((part) => part === name.toLowerCase())
    )
  )
}

function taskResult(task: BotTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    ...(task.note ? { note: task.note } : {}),
  }
}

const LIST_LIMIT = 50
const LIST_LIMIT_MAX = 200
const OUTLINE_TURNS = 30
const OUTLINE_CHARS = 200
const MESSAGE_PAGE = 10
const MESSAGE_CHARS = 1500
// Claude's shell tool. grok-translate and codex-translate name theirs Bash too.
const SHELL_TOOL = 'Bash'

function findBot(bots: readonly Bot[], name: string) {
  const byId = bots.find((bot) => bot.id === name)
  const matches = byId
    ? [byId]
    : bots.filter((bot) => bot.name.toLowerCase() === name.toLowerCase())
  if (matches.length === 1) return matches[0]!
  const available = bots.map((bot) => bot.name).join(', ') || 'none'
  return new StoreError(
    'invalid_params',
    matches.length === 0
      ? `Unknown bot ${name}. Available: ${available}`
      : `Ambiguous bot ${name}. Available: ${available}`
  )
}

function pullRequestQuery(value: string): { repo?: string; number: number } | undefined {
  const url = parsePullRequestUrl(value)
  if (url) return url
  const match = /^(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#|#)?(\d+)$/.exec(value.trim())
  if (!match) return undefined
  const number = Number(match[3])
  if (!Number.isSafeInteger(number) || number <= 0) return undefined
  return match[1] && match[2]
    ? { repo: `${match[1]}/${match[2]}`.toLowerCase(), number }
    : { number }
}

function threadSummary(thread: ThreadMeta, project: string, bot: string | undefined) {
  const branch = thread.worktree?.branch ?? thread.git?.branch
  return {
    id: thread.id,
    title: thread.title,
    project,
    status: thread.status,
    readyForReview: thread.readyForReview,
    provider: thread.provider,
    model: thread.model,
    parentThreadId: thread.parentThreadId,
    createdBy: thread.createdBy ?? 'user',
    ...(thread.pullRequests?.length && {
      pullRequests: thread.pullRequests.map((pr) => ({
        ref: `${pr.repo}#${pr.number}`,
        ...(pr.state ? { state: pr.state } : {}),
        ...(pr.checks ? { checks: pr.checks } : {}),
        ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
      })),
    }),
    ...(branch ? { branch } : {}),
    lastActivity: new Date(thread.updatedAt).toISOString(),
    ...(thread.status === 'awaiting_approval' ? { needsInput: true } : {}),
    ...(thread.awaitingParent ? { awaitingParent: true } : {}),
    ...(bot ? { bot } : {}),
    ...(thread.archived ? { archived: true } : {}),
  }
}

function singleLine(text: string, cap: number) {
  const line = text.replaceAll(/\s+/g, ' ').trim()
  return line.length > cap ? line.slice(0, cap) : line
}

function firstLine(text: string, cap: number) {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim())
      ?.trim() ?? ''
  return line.length > cap ? line.slice(0, cap) : line
}

function messageSender(item: Extract<ThreadItem, { kind: 'user_message' }>) {
  if (item.wake) return item.wake
  return item.from?.title ?? 'user'
}

function turnCounts(items: readonly ThreadItem[]) {
  const paths = new Set<string>()
  let commands = 0
  let started = 0
  let messaged = 0
  let pullRequests = 0
  for (const item of items) {
    if (item.kind === 'tool_call') {
      if (item.fileChange) paths.add(item.fileChange.path)
      if (item.toolName === SHELL_TOOL) commands++
    } else if (item.kind === 'thread_marker') {
      if (item.action === 'started') started++
      else messaged++
    } else if (item.kind === 'pull_request') pullRequests++
  }
  const did = {
    ...(paths.size > 0 ? { edited: paths.size } : {}),
    ...(commands > 0 ? { commands } : {}),
    ...(started > 0 ? { started } : {}),
    ...(messaged > 0 ? { messaged } : {}),
    ...(pullRequests > 0 ? { pullRequests } : {}),
  }
  return Object.keys(did).length > 0 ? did : undefined
}

function outlineTurn(items: readonly ThreadItem[]) {
  const asked = items.find((item) => item.kind === 'user_message')
  const answered = items.findLast((item) => item.kind === 'assistant_message')
  const did = turnCounts(items)
  return {
    at: new Date(items[0]!.createdAt).toISOString(),
    ...(asked?.kind === 'user_message'
      ? {
          asked: {
            id: asked.id,
            who: messageSender(asked),
            text: singleLine(asked.text, OUTLINE_CHARS),
          },
        }
      : {}),
    ...(answered?.kind === 'assistant_message'
      ? { answered: { id: answered.id, text: firstLine(answered.text, OUTLINE_CHARS) } }
      : {}),
    ...(did ? { did } : {}),
  }
}

function mainTurns(items: readonly ThreadItem[]) {
  const turns: ThreadItem[][] = []
  const byTurn = new Map<string, ThreadItem[]>()
  for (const item of items) {
    if (item.agentId) continue
    const turn = byTurn.get(item.turnId)
    if (turn) turn.push(item)
    else {
      const next = [item]
      byTurn.set(item.turnId, next)
      turns.push(next)
    }
  }
  return turns
}

function isChatMessage(
  item: ThreadItem
): item is Extract<ThreadItem, { kind: 'user_message' | 'assistant_message' }> {
  return item.kind === 'user_message' || item.kind === 'assistant_message'
}

const taskTitle = z.string().trim().min(1).max(200)
const taskStatus = z.enum(['todo', 'in_progress', 'done', 'dropped'])
const taskNote = z.string().trim().max(300)
const text = z.string().trim().min(1).max(32_000)
const requestId = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'Any unique string. Retrying with the same one returns the first result instead of acting twice.'
  )
const createInput = z.object({
  environment: z
    .enum(['local', 'worktree'])
    .optional()
    .describe(
      "worktree: a new branch and folder of its own. local: the project checkout itself, shared with the user and other threads there. Defaults to the project's default for bots or when you pass another project; otherwise yours."
    ),
  ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Worktree only: the branch, tag or commit to start from, local or on origin. Defaults to your HEAD when you're in a worktree, so commit anything the child should build on; otherwise origin's default branch, or the current branch when there's no origin."
    ),
  prompt: text.describe(
    'Everything the child needs. It sees this and the project, not your conversation.'
  ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Sidebar title: a few words naming what the thread is for, like 'Fix flaky login test'. You know its purpose better than a title generated from the prompt, which is the fallback. Titles never carry PR or issue numbers: if a number is all you know, leave title out and Jetty names the thread from that PR or issue's own title."
    ),
  project: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Create the thread in this project (name, case-insensitive). Defaults to yours. If it doesn't match or is ambiguous, the error lists the available names."
    ),
  provider: z
    .enum(['claude', 'codex', 'grok', 'copilot'])
    .optional()
    .describe('Required when the model is offered by more than one provider.'),
  model: z
    .string()
    .min(1)
    .optional()
    .describe('An id, name or unique short name from list_models.'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  fast: z
    .boolean()
    .optional()
    .describe("Turns on the model's Fast mode where the model offers one."),
  full_access: z
    .boolean()
    .optional()
    .describe('Start the worker in Full access; only callers in Full access may request this.'),
  skill: z
    .string()
    .regex(/^[^\s/]+$/, 'Use a skill name without the slash')
    .optional()
    .describe(
      'A skill for the thread to run, by name without the slash. It must be available to the chosen provider; Claude commands are not portable.'
    ),
  notify: z
    .boolean()
    .default(true)
    .describe(
      "Default true: when it's done with work you gave it, Jetty sends you its final message. Set false for a thread you won't follow up on."
    ),
  requestId,
})
const botCreateInput = createInput.extend({
  prompt: text
    .optional()
    .describe(
      'Everything the child needs. It sees this and the project, not your conversation. Required unless setup_worktrees.'
    ),
  setup_worktrees: z
    .boolean()
    .optional()
    .describe(
      "For a project with no .jetty/worktree.json yet: start a thread in the project checkout on Jetty's own worktree setup instructions. Leave out prompt."
    ),
})
type CreateThreadInput = z.infer<typeof botCreateInput>

const sendInput = z.object({
  threadId: z.string(),
  text,
  steer: z
    .boolean()
    .default(false)
    .describe(
      "Deliver into its running turn now, for a correction it shouldn't finish without. The result says if it was queued instead."
    ),
  requestId,
})

function result(value: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) },
    ],
  }
}

export function createMcpHandler(
  sessions: McpSessions,
  store: Store,
  orch: Orchestrator,
  attachments: Attachments,
  models: () => readonly ProviderModel[] | null,
  pullRequestLinks: PullRequestLinks,
  archiveThread: (threadId: string) => Effect.Effect<unknown, WireError>,
  worktrees?: Worktrees,
  search?: SearchService,
  desktops?: Desktops
) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
    >()
    const run = Effect.runPromiseWith(context)
    const fs = yield* FileSystem.FileSystem
    const paths = yield* Path.Path

    // Reading may open an archived thread. The caller still has to be live, and a tool that acts
    // on a thread leaves `archived` off, so it keeps refusing archived targets.
    function accessible(identity: McpIdentity, targetId: string, opts?: { archived?: boolean }) {
      return Effect.gen(function* () {
        const caller = yield* store.requireThread(identity.threadId)
        const target = yield* store.requireThread(targetId)
        if (caller.archived || (!opts?.archived && target.archived)) {
          const party = [caller, target].find(
            (thread) => thread.archived && thread.botId === thread.id
          )
          return yield* Effect.fail(
            new StoreError(
              'not_found',
              party ? `${party.title} is archived` : `Thread ${targetId} is archived`
            )
          )
        }
        return target
      })
    }

    function ownChild(identity: McpIdentity, threadId: string) {
      return Effect.gen(function* () {
        const caller = yield* accessible(identity, identity.threadId)
        const target = yield* store.requireThread(threadId)
        if (target.parentThreadId !== caller.id)
          return yield* Effect.fail(
            new StoreError('invalid_params', 'Only your own direct child threads can be stopped')
          )
        return target
      })
    }

    // A turn in progress, including one waiting on the user, or background work the archive would stop.
    function stillWorking(status: string) {
      return (
        status === 'starting' ||
        status === 'running' ||
        status === 'awaiting_approval' ||
        status === 'monitoring'
      )
    }

    function archiveTarget(identity: McpIdentity, threadId: string) {
      return Effect.gen(function* () {
        const caller = yield* accessible(identity, identity.threadId)
        const target = yield* store.requireThread(threadId)
        if (target.archived)
          return yield* Effect.fail(new StoreError('invalid_params', 'Thread is already archived'))
        // Archiving a thread archives everything under it, so the caller and anything above it are out.
        const underTarget = yield* store.threadTree(target.id)
        if (underTarget.some((thread) => thread.id === caller.id))
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              target.id === caller.id
                ? "You can't archive this thread. It would stop you mid-turn."
                : "You can't archive a thread above yours. It would archive you too."
            )
          )
        const underCaller = yield* store.threadTree(caller.id)
        const ownDescendant = underCaller.some((thread) => thread.id === target.id)
        if (!ownDescendant && underTarget.some((thread) => stillWorking(thread.status)))
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              `${target.title} is still working. Ask the user, or wait until it's done.`
            )
          )
        return target
      })
    }

    function accessLevel(thread: { provider?: string; model?: string }, mode?: string) {
      if (findProviderModel(models() ?? [], thread.provider, thread.model)?.autoMode === false)
        return 0
      return mode === 'full_access' ? 2 : 1
    }

    function createThread(identity: McpIdentity, input: CreateThreadInput) {
      let baseCommit: string | undefined
      let projectId = ''
      let prompt = input.prompt
      const create = store.transaction(
        Effect.gen(function* () {
          const caller = yield* accessible(identity, identity.threadId)
          if (input.requestId) {
            const previous = yield* store.getRequest(caller.id, input.requestId, 'create_thread')
            if (previous) return previous
          }
          const turn = yield* store.turnContext(caller.id)
          if ((yield* store.lineageDepth(caller.id)) >= 3)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                "This thread is already three levels below the user's thread, so it can't create threads. Do the work here, or say in your final message what should be delegated."
              )
            )
          if (turn.createdCount >= 5)
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Maximum 5 threads per turn')
            )
          const catalog = models()
          const bot = yield* store.getBot(caller.id)
          if (bot && input.effort === 'max')
            return yield* Effect.fail(
              new StoreError('invalid_params', "max isn't available to bots; use xhigh")
            )
          if (!catalog)
            return yield* Effect.fail(
              new StoreError('invalid_params', 'Provider discovery is still running; retry shortly')
            )
          const matches = input.model ? matchingModels(catalog, input.model) : []
          const provider = yield* requestedProvider(input, catalog, identity.provider)
          const available = catalog.filter((m) => m.provider === provider)
          if (!available.length)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `${providerNames[provider]} isn't available here. Available: ${[...new Set(catalog.map((m) => providerNames[m.provider]))].join(', ') || 'none'}`
              )
            )
          const selected = input.model
            ? matches.filter((m) => m.provider === provider)
            : provider === caller.provider
              ? [findProviderModel(available, provider, caller.model)].filter(
                  (m) => m !== undefined
                )
              : []
          if (input.model && selected.length !== 1)
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `Unknown or ambiguous model ${input.model}. Available: ${modelOptions(catalog)}`
              )
            )
          const model = selected[0]?.id
          if (input.effort && selected[0] && !selected[0].efforts.includes(input.effort))
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `Unsupported effort for ${selected[0].name}. Choose: ${selected[0].efforts.join(', ') || 'none'}`
              )
            )
          const callerMode = (yield* store.getPermissionMode(caller.id)) ?? 'auto'
          if (input.full_access && callerMode !== 'full_access')
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                'Only callers in Full access can set full_access to true'
              )
            )
          const mode =
            selected[0]?.autoMode === false ||
            findProviderModel(catalog, caller.provider, caller.model)?.autoMode === false
              ? 'auto'
              : input.full_access
                ? 'full_access'
                : 'auto'
          if (accessLevel({ provider, model }, mode) > accessLevel(caller, callerMode))
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                'This thread asks before acting, so its threads must too: leave out model and provider to use your own model'
              )
            )
          const id = newId()
          yield* store.createThread(projectId, id)
          yield* store.setThreadEnvironment(id, baseCommit)
          yield* store.markAgentThread(id, caller.id, input.notify)
          yield* store.setThreadProviderIfAbsent(id, provider)
          yield* store.setThreadLoadout(id, {
            model,
            effort: input.effort,
            fast: selected[0]?.fast ? input.fast : undefined,
          })
          yield* store.setPermissionMode(id, mode)
          // A title with a PR or issue number falls back to the titler, which names the work from that
          // item's own title.
          const given = input.title && !NUMBERED.test(input.title)
          const title = given ? input.title : input.setup_worktrees ? 'Set up worktrees' : undefined
          if (title) yield* store.setThreadTitle(id, title)
          yield* store.enqueue(id, {
            id: newId(),
            text: prompt!,
            ...(input.skill && { skill: input.skill }),
            from: { threadId: caller.id, title: caller.title },
            hop: turn.hop + 1,
            createdAt: Date.now(),
          })
          yield* store.countCreation(turn.turnId)
          const response = { threadId: id, link: `jetty://threads/${id}` }
          if (input.requestId)
            yield* store.saveRequest(caller.id, input.requestId, 'create_thread', response)
          return { ...response, created: true }
        })
      )
      return Effect.gen(function* () {
        const caller = yield* accessible(identity, identity.threadId)
        if (input.requestId) {
          const previous = yield* store.getRequest(caller.id, input.requestId, 'create_thread')
          if (previous) return previous
        }
        const bot = yield* store.getBot(caller.id)
        if (bot && input.effort === 'max')
          return yield* Effect.fail(
            new StoreError('invalid_params', "max isn't available to bots; use xhigh")
          )
        if (
          input.setup_worktrees &&
          ['prompt', 'skill', 'environment', 'ref'].some(
            (key) => input[key as keyof CreateThreadInput] !== undefined
          )
        )
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              "setup_worktrees starts a thread in the project checkout on Jetty's own prompt, so leave out prompt, skill, environment and ref."
            )
          )
        if (!input.prompt && !input.setup_worktrees)
          return yield* Effect.fail(new StoreError('invalid_params', 'prompt is required.'))
        if (input.full_access && (yield* store.getPermissionMode(caller.id)) !== 'full_access')
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              'Only callers in Full access can set full_access to true'
            )
          )
        const projects = yield* store.listProjects()
        if (bot && !bot.projectId && !input.project)
          return yield* Effect.fail(
            new StoreError(
              'invalid_params',
              `Name a project. Available: ${projects.map((project) => project.title).join(', ') || 'none'}`
            )
          )
        const target = yield* matchProject(
          projects,
          input.project,
          bot?.projectId ?? caller.projectId
        )
        projectId = target.id
        if (input.skill) {
          const provider = yield* requestedProvider(input, models() ?? [], identity.provider)
          const skills =
            provider === 'grok'
              ? []
              : yield* listProviderSkills({ projectPath: target.path, provider }).pipe(
                  Effect.provideContext(context)
                )
          if (!skills.some((skill) => skill.name === input.skill)) {
            const supported: string[] = []
            for (const candidate of ['claude', 'codex', 'copilot'] satisfies ProviderId[]) {
              if (candidate === provider) continue
              const available = yield* listProviderSkills({
                projectPath: target.path,
                provider: candidate,
              }).pipe(Effect.provideContext(context))
              if (available.some((skill) => skill.name === input.skill))
                supported.push(providerNames[candidate])
            }
            return yield* Effect.fail(
              new StoreError(
                'invalid_params',
                `Skill ${input.skill} cannot run on ${providerNames[provider]} for this project. Providers that can run it: ${supported.join(', ') || 'none'}.`
              )
            )
          }
        }
        if (input.setup_worktrees) {
          if (!worktrees)
            return yield* Effect.fail(new StoreError('not_found', 'Project not found'))
          if (yield* Effect.promise(() => worktrees.configured(target.path)))
            return yield* Effect.fail(
              new StoreError('invalid_params', `${target.title} is already set up for worktrees.`)
            )
          prompt = worktreeSetupPrompt(worktrees.setupGuide)
        }
        const sameProject = target.id === caller.projectId
        const environment =
          (input.setup_worktrees ? 'local' : input.environment) ??
          (!bot && sameProject
            ? caller.environment
            : worktrees
              ? yield* store
                  .getDefaultEnvironment()
                  .pipe(
                    Effect.flatMap((fallback) =>
                      Effect.promise(() => worktrees.defaultEnvironment(target.path, fallback))
                    )
                  )
              : yield* store.getDefaultEnvironment())
        if (environment === 'local') return yield* orch.withAdmission(caller.id, create)
        if (!worktrees) return yield* Effect.fail(new StoreError('not_found', 'Project not found'))
        const fromWorktree = !bot && sameProject && caller.environment === 'worktree'
        const cwd = fromWorktree
          ? yield* Effect.promise(() => worktrees.root(caller.id))
          : target.path
        baseCommit = yield* Effect.tryPromise({
          try: () => worktrees.resolveRef(cwd, input.ref ?? (fromWorktree ? 'HEAD' : undefined)),
          catch: (error) =>
            new StoreError(
              'invalid_params',
              error instanceof Error ? error.message : String(error)
            ),
        })
        return yield* orch.withAdmission(caller.id, create)
      })
    }

    function sendMessage(identity: McpIdentity, input: z.infer<typeof sendInput>) {
      return Effect.gen(function* () {
        const response = yield* store.transaction(
          Effect.gen(function* () {
            const target = yield* accessible(identity, input.threadId)
            if (input.requestId) {
              const previous = yield* store.getRequest(
                identity.threadId,
                input.requestId,
                'send_message'
              )
              if (previous)
                return {
                  ...previous,
                  title: target.title,
                  duplicate: true,
                  busy: false,
                  ownChild: false,
                  resumed: false,
                }
            }
            const caller = yield* store.requireThread(identity.threadId)
            if (
              !((yield* store.isBot(caller.id)) && (yield* store.isBot(target.id))) &&
              accessLevel(target, yield* store.getPermissionMode(target.id)) >
                accessLevel(caller, yield* store.getPermissionMode(caller.id))
            )
              return yield* Effect.fail(
                new StoreError(
                  'invalid_params',
                  'Cannot send_message to a thread with a higher access mode than the sender'
                )
              )
            const turn = yield* store.turnContext(caller.id)
            const ownChild = target.parentThreadId === caller.id
            // A parent's message restarts a child it stopped, in the transaction that queues it, so
            // a crash can't keep one without the other. One the restart guard holds waits for the
            // user's Resume.
            const resumed =
              ownChild &&
              target.queuePaused &&
              !heldByRestarts((yield* store.getThreadState(target.id)).items)
            const messageId = newId()
            yield* store.enqueue(target.id, {
              id: messageId,
              text: input.text,
              from: { threadId: caller.id, title: caller.title },
              hop: turn.hop + 1,
              createdAt: Date.now(),
            })
            if (resumed) yield* store.setQueuePaused(target.id, false)
            const response = { threadId: target.id, title: target.title, messageId }
            if (input.requestId)
              yield* store.saveRequest(caller.id, input.requestId, 'send_message', response)
            return {
              ...response,
              duplicate: false,
              busy: ['starting', 'running', 'awaiting_approval'].includes(target.status),
              ownChild,
              resumed,
            }
          })
        )
        if (response.resumed) yield* orch.publishQueuedThread(response.threadId)
        let delivery = 'queued'
        if (input.steer && !response.duplicate && response.messageId) {
          const sent = yield* orch.sendQueuedNow(response.threadId, response.messageId, false).pipe(
            Effect.as(true),
            Effect.catchCause(() => Effect.succeed(false))
          )
          if (sent) delivery = 'delivered'
        }
        const detail =
          delivery === 'delivered'
            ? response.busy
              ? 'Steered into the running turn.'
              : 'Delivered in a new turn.'
            : (yield* store.isQueuePaused(response.threadId))
              ? 'Queued, but the thread is paused, so this waits until the user resumes it.'
              : response.busy
                ? 'Queued; it reads this when its current turn ends.'
                : 'Queued; it starts on this within a second or so.'
        if ((yield* store.isBot(identity.threadId)) && !response.duplicate)
          yield* orch.botMarker(
            identity.threadId,
            'messaged',
            yield* store.requireThread(response.threadId),
            response.messageId
          )
        return {
          threadId: response.threadId,
          title: response.title,
          messageId: response.messageId,
          delivery,
          detail: response.ownChild
            ? `${detail} Its report reaches you only once your turn ends, so end it now instead of waiting.`
            : detail,
        }
      })
    }

    async function register(server: McpServer, identity: McpIdentity) {
      const parentId = (await run(accessible(identity, identity.threadId))).parentThreadId
      const bot = await run(store.getBot(identity.threadId))
      const toolMeta = bot ? { _meta: { 'anthropic/alwaysLoad': true } } : {}
      function invoke<A>(effect: Effect.Effect<A, Error>) {
        return run(
          effect.pipe(
            Effect.map(result),
            Effect.catch((error) =>
              Effect.succeed({
                content: [
                  {
                    type: 'text' as const,
                    text:
                      error instanceof StoreError
                        ? error.message
                        : `Jetty tool failed: ${error.message}`,
                  },
                ],
                isError: true,
              })
            )
          )
        ).catch((error: unknown) => ({
          content: [
            {
              type: 'text' as const,
              text: `Jetty tool failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }))
      }
      server.registerTool(
        'list_threads',
        {
          ...toolMeta,
          description:
            'List threads across projects, yours first and newest activity first, each with its status, model, parent, project, linked pull requests, branch and last activity. Filter by project, status, bot (name or id) and pullRequest (#123, owner/repo#123 or a URL); archived threads stay out unless includeArchived, and the result stops at limit (default 50, max 200) and says how many more match.',
          inputSchema: {
            project: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe('Filter by project name (case-insensitive).'),
            status: z
              .enum(SessionStatus.literals)
              .optional()
              .describe('Only threads in this status.'),
            bot: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe("A bot's name (case-insensitive) or id."),
            pullRequest: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe('#123, 123, owner/repo#123, or a pull request URL.'),
            includeArchived: z
              .boolean()
              .default(false)
              .describe('Include archived threads. Default false.'),
            limit: z
              .number()
              .int()
              .min(1)
              .max(LIST_LIMIT_MAX)
              .default(LIST_LIMIT)
              .describe('How many threads to return. Default 50, max 200.'),
          },
        },
        ({ project, status, bot, pullRequest, includeArchived, limit }) =>
          invoke(
            Effect.gen(function* () {
              const caller = yield* accessible(identity, identity.threadId)
              const titles = new Map(
                (yield* store.listProjects()).map((item) => [item.id, item.title])
              )
              const bots = yield* store.listBots()
              const names = new Map(bots.map((item) => [item.id, item.name]))
              const found = bot ? findBot(bots, bot) : undefined
              if (found instanceof StoreError) return yield* Effect.fail(found)
              const query = pullRequest ? pullRequestQuery(pullRequest) : undefined
              if (pullRequest && !query)
                return yield* Effect.fail(
                  new StoreError(
                    'invalid_params',
                    'Use #123, owner/repo#123, or a pull request URL'
                  )
                )
              const key = project?.toLowerCase()
              const listed = (yield* store.listThreads()).filter((thread) => {
                if (!includeArchived && thread.archived) return false
                if (key && titles.get(thread.projectId)?.toLowerCase() !== key) return false
                if (status && thread.status !== status) return false
                if (found && thread.botId !== found.id) return false
                if (
                  query &&
                  !(thread.pullRequests ?? []).some(
                    (pr) =>
                      pr.number === query.number &&
                      (query.repo === undefined || pr.repo.toLowerCase() === query.repo)
                  )
                )
                  return false
                return true
              })
              const ordered = [
                ...listed.filter((thread) => thread.projectId === caller.projectId),
                ...listed.filter((thread) => thread.projectId !== caller.projectId),
              ]
              const page = ordered.slice(0, limit)
              const more = ordered.length - page.length
              return {
                threads: page.map((thread) =>
                  threadSummary(
                    thread,
                    titles.get(thread.projectId) ?? thread.projectId,
                    thread.botId ? names.get(thread.botId) : undefined
                  )
                ),
                ...(more > 0 ? { more } : {}),
              }
            })
          )
      )
      server.registerTool(
        'read_thread',
        {
          ...toolMeta,
          description:
            "Returns an outline of the thread's turns by default, the latest 30, with message ids to open any message in full. Pass view 'messages' for the latest 10 user and assistant messages, each cut at 1,500 characters; after pages those forward and before pages the outline back.",
          inputSchema: {
            threadId: z.string(),
            view: z
              .enum(['outline', 'messages'])
              .default('outline')
              .describe(
                'outline summarizes each turn. messages returns recent user and assistant messages.'
              ),
            before: z
              .string()
              .optional()
              .describe(
                'A message id from an outline. Returns the 30 turns before the turn that holds it.'
              ),
            after: z
              .string()
              .optional()
              .describe(
                'A message id from an earlier messages read. Returns the messages after it. Implies view messages.'
              ),
            messageId: z
              .string()
              .optional()
              .describe('Returns that one message in full, whatever the view.'),
          },
        },
        (input) =>
          invoke(
            Effect.gen(function* () {
              const thread = yield* accessible(identity, input.threadId, { archived: true })
              const state = yield* store.getThreadState(input.threadId)
              if (input.messageId || input.after || input.view === 'messages') {
                const messages = state.items.filter(isChatMessage)
                const cursor = input.messageId ?? input.after
                const index = cursor ? messages.findIndex((item) => item.id === cursor) : -1
                if (cursor && index < 0)
                  return yield* Effect.fail(
                    new StoreError('invalid_params', `No message ${cursor} in this thread`)
                  )
                const page = input.messageId
                  ? [messages[index]!]
                  : input.after
                    ? messages.slice(index + 1, index + 1 + MESSAGE_PAGE)
                    : messages.slice(-MESSAGE_PAGE)
                const cap = input.messageId ? Infinity : MESSAGE_CHARS
                return {
                  title: thread.title,
                  messages: page.map((item) => ({
                    id: item.id,
                    role: item.kind === 'user_message' ? 'user' : 'assistant',
                    text: relayedMessage(
                      (item.kind === 'user_message' && item.from) || {
                        threadId: thread.id,
                        title: thread.title,
                      },
                      item.text.slice(0, cap)
                    ),
                    truncated: item.text.length > cap,
                  })),
                  after: page.at(-1)?.id ?? input.after ?? null,
                }
              }
              const turns = mainTurns(state.items)
              let end = turns.length
              if (input.before) {
                const at = turns.findIndex((turn) => turn.some((item) => item.id === input.before))
                if (at < 0)
                  return yield* Effect.fail(
                    new StoreError('invalid_params', `No message ${input.before} in this thread`)
                  )
                end = at
              }
              const start = Math.max(0, end - OUTLINE_TURNS)
              return {
                title: thread.title,
                turns: turns.slice(start, end).map(outlineTurn),
                ...(start > 0 ? { earlier: start } : {}),
              }
            })
          )
      )
      server.registerTool(
        'list_models',
        {
          ...toolMeta,
          description:
            'List live Jetty providers, model IDs and names, and supported effort levels for create_thread.',
          inputSchema: {},
        },
        () =>
          invoke(
            Effect.gen(function* () {
              const catalog = models()
              if (!catalog)
                return yield* Effect.fail(
                  new StoreError(
                    'invalid_params',
                    'Provider discovery is still running; retry shortly'
                  )
                )
              return catalog.map(({ provider, id, name, efforts, defaultEffort }) => ({
                provider,
                id,
                name,
                efforts: bot ? efforts.filter((effort) => effort !== 'max') : efforts,
                defaultEffort,
              }))
            })
          )
      )
      server.registerTool(
        'create_thread',
        {
          ...toolMeta,
          description:
            "Create a child thread and start it on your prompt. This project unless you pass project (a name). It uses your provider and model unless you set them. For bots or another project, it uses the project's environment default and worktree base; otherwise your environment and HEAD. list_models has the options. Up to 5 per turn, and nesting stops three levels below the user's thread.",
          ...(bot ? { annotations: { readOnlyHint: true } } : {}),
          inputSchema: bot ? botCreateInput : createInput,
        },
        (input: z.infer<typeof botCreateInput>) =>
          invoke(
            Effect.gen(function* () {
              const created = yield* createThread(identity, input)
              if (!('created' in created)) return created
              yield* orch.publishQueuedThread(created.threadId)
              if (bot)
                yield* orch.botMarker(
                  identity.threadId,
                  'started',
                  yield* store.requireThread(created.threadId)
                )
              return created
            })
          )
      )
      server.registerTool(
        'send_message',
        {
          ...toolMeta,
          description:
            'Send a message to another thread. An idle thread starts on it right away; a busy one reads it after its current turn, unless you steer.',
          inputSchema: sendInput,
        },
        (input) => invoke(sendMessage(identity, input))
      )
      if (bot) {
        const searchInput = {
          query: z.string().trim().min(1).max(SEARCH_QUERY_MAX),
          k: z.number().int().min(1).max(SEARCH_MAX_K).default(SEARCH_DEFAULT_K),
        }
        for (const kind of ['wiki', 'threads'] as const) {
          server.registerTool(
            `search_${kind}`,
            {
              ...toolMeta,
              description: kind === 'wiki' ? SEARCH_WIKI_DESCRIPTION : SEARCH_THREADS_DESCRIPTION,
              inputSchema: searchInput,
            },
            async (input) => {
              try {
                if (!search) throw new Error('search service unavailable')
                const value =
                  kind === 'wiki'
                    ? await search.wiki(
                        bot.id,
                        (await run(
                          store.getProject((await run(store.requireThread(bot.id))).projectId)
                        ))!.path,
                        input
                      )
                    : await search.threads(
                        bot.id,
                        bot.name,
                        input,
                        orch.currentTurn(identity.threadId)
                      )
                return result(value)
              } catch (error) {
                const reason = (error instanceof Error ? error.message : String(error))
                  .replace(/\s+/g, ' ')
                  .trim()
                  .replace(/\.+$/, '')
                const fallback =
                  kind === 'wiki'
                    ? 'Read your index.md or grep your pages meanwhile.'
                    : 'Use list_threads and read_thread meanwhile.'
                return { ...result(`Search isn't ready: ${reason}. ${fallback}`), isError: true }
              }
            }
          )
        }
        server.registerTool(
          'add_instruction',
          {
            ...toolMeta,
            description:
              "Add one standing instruction to your instructions.md, which loads every session. One rule per call, written as something you can follow, with a short reason. Lines can't be edited or removed; to change one, add one that replaces it and say which.",
            inputSchema: {
              instruction: z
                .string()
                .trim()
                .min(1)
                .max(1000)
                .regex(/^[^\r\n]+$/),
              reason: z
                .string()
                .trim()
                .min(1)
                .max(200)
                .regex(/^[^\r\n]+$/),
            },
          },
          ({ instruction, reason }) =>
            invoke(
              Effect.gen(function* () {
                const thread = yield* store.requireThread(bot.id)
                const home = yield* store.getProject(thread.projectId)
                if (!home)
                  return yield* Effect.fail(new StoreError('not_found', 'Bot home not found'))
                const date = new Date().toISOString().slice(0, 10)
                const restored = yield* Effect.tryPromise(() =>
                  editManagedBotFiles(home.path, async () => {
                    const restored = await restoreManagedBotFiles(home.path, ['instructions.md'])
                    const path = join(home.path, 'instructions.md')
                    const current = await readFile(path, 'utf8')
                    await appendFile(
                      path,
                      `${current && !current.endsWith('\n') ? '\n' : ''}- ${instruction} (${date}, ${reason})\n`
                    )
                    await commitManagedBotFiles(home.path, ['instructions.md'])
                    return restored
                  })
                )
                if (restored)
                  yield* store.updateBotLifecycle(bot.id, { managedFilesRestored: true })
                return 'Instruction added.'
              })
            )
        )
        server.registerTool(
          'add_project',
          {
            ...toolMeta,
            description: 'Add a local folder as a Jetty project, so threads can work in it.',
            inputSchema: { path: z.string().trim().min(1) },
          },
          ({ path }) =>
            invoke(
              orch.addBotProject(bot.id, path).pipe(
                Effect.map((result) => {
                  if (typeof result === 'string') return result
                  const { id, title, path, created } = result
                  return {
                    id,
                    title,
                    path,
                    detail: created
                      ? 'The project is ready for create_thread.'
                      : `${title} was already a project; it's ready for create_thread.`,
                  }
                })
              )
            )
        )
        server.registerTool(
          'add_task',
          {
            ...toolMeta,
            description: 'Add a task to your list, which the user sees beside your chat.',
            inputSchema: {
              title: taskTitle,
              status: taskStatus.optional().default('todo'),
              note: taskNote.optional(),
            },
          },
          (input) => invoke(orch.addBotTask(bot.id, input).pipe(Effect.map(taskResult)))
        )
        server.registerTool(
          'update_task',
          {
            ...toolMeta,
            description: "Change a task's title, status or note; an empty note clears it.",
            inputSchema: {
              id: z.string(),
              title: taskTitle.optional(),
              status: taskStatus.optional(),
              note: taskNote.optional(),
            },
          },
          ({ id, ...input }) =>
            invoke(orch.updateBotTask(bot.id, id, input).pipe(Effect.map(taskResult)))
        )
        server.registerTool(
          'list_bots',
          {
            ...toolMeta,
            description: "List the other bots, with each one's project and job.",
            inputSchema: {},
          },
          () =>
            invoke(
              Effect.gen(function* () {
                const titles = new Map(
                  (yield* store.listProjects()).map((project) => [project.id, project.title])
                )
                const listed = []
                for (const other of yield* store.listBots()) {
                  if (other.id === bot.id || other.archived) continue
                  const home = yield* store.getProject(other.id)
                  const brief = home
                    ? yield* fs
                        .readFileString(paths.join(home.path, 'brief.md'))
                        .pipe(
                          Effect.catchTag('PlatformError', (error) =>
                            error.reason._tag === 'NotFound'
                              ? Effect.succeed('')
                              : Effect.fail(error)
                          )
                        )
                    : ''
                  listed.push({
                    id: other.id,
                    name: other.name,
                    project: other.projectId ? (titles.get(other.projectId) ?? null) : null,
                    job:
                      brief
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .find(
                          (line) =>
                            line &&
                            !/^#{1,6}(?:\s|$)/.test(line) &&
                            !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(line)
                        )
                        ?.slice(0, 120) || null,
                  })
                }
                return listed
              })
            )
        )
        server.registerTool(
          'list_tasks',
          {
            ...toolMeta,
            description: 'List your open tasks and the ones closed in the last day.',
            inputSchema: {},
          },
          () =>
            invoke(store.listBotTasks(bot.id).pipe(Effect.map((tasks) => tasks.map(taskResult))))
        )
        server.registerTool(
          'answer_approval',
          {
            ...toolMeta,
            description:
              "Answer a pending approval on a worker you own. The note names the worker and the approval's item id. Allow it, or deny it with a reason the worker can act on. You can't choose always.",
            inputSchema: {
              threadId: z.string(),
              itemId: z.string(),
              decision: z.enum(['allow', 'deny']),
              reason: z.string().optional(),
            },
          },
          ({ threadId, itemId, decision, reason }) =>
            invoke(
              Effect.gen(function* () {
                if (bot.archived)
                  return yield* Effect.fail(new StoreError('conflict', `${bot.name} is archived`))
                const thread = yield* store.getThread(threadId)
                if (!thread)
                  return yield* Effect.fail(
                    new StoreError('not_found', `Thread ${threadId} not found`)
                  )
                const owner = yield* store.getOwningBot(threadId)
                if (!owner || owner.id !== bot.id || threadId === bot.id)
                  return yield* Effect.fail(
                    new StoreError(
                      'invalid_params',
                      "You can only answer your own workers' approvals"
                    )
                  )
                const { items } = yield* store.getThreadState(threadId)
                const item = items.find((candidate) => candidate.id === itemId)
                if (
                  item?.kind !== 'approval' ||
                  item.decision ||
                  item.withdrawn ||
                  item.completedAt
                )
                  return yield* Effect.fail(
                    new StoreError('invalid_params', "That approval isn't waiting anymore")
                  )
                const note = reason?.trim() || undefined
                yield* orch.respondApproval(
                  threadId,
                  itemId,
                  decision,
                  decision === 'deny' ? note : undefined,
                  { botId: bot.id, name: bot.name }
                )
                const command = approvalCommand(item.toolName, item.input)
                const input =
                  item.input && typeof item.input === 'object'
                    ? (item.input as Record<string, unknown>)
                    : {}
                return {
                  decision,
                  threadId,
                  title: thread.title,
                  ...(command
                    ? { command }
                    : { action: lowerFirst(botApproval(item.toolName, input, [], []).title) }),
                }
              })
            )
        )
        server.registerTool(
          'message_user',
          {
            ...toolMeta,
            description:
              "Message the user during a turn they didn't start, when they need to know or decide something.",
            inputSchema: { text },
          },
          ({ text: message }) =>
            invoke(
              Effect.gen(function* () {
                for (const match of message.matchAll(
                  /jetty:\/\/(threads|bots)\/([^\s)\]<>"'?#/]+)/g
                )) {
                  const [, kind, id] = match
                  const found =
                    kind === 'threads' ? yield* store.getThread(id!) : yield* store.getBot(id!)
                  if (!found) {
                    const entity = kind === 'threads' ? 'thread' : 'bot'
                    return yield* Effect.fail(
                      new StoreError(
                        'invalid_params',
                        `No ${entity} has the id ${id}. Link a ${entity} only with an id from ${kind === 'threads' ? 'create_thread or another tool result' : 'a tool result'}.`
                      )
                    )
                  }
                }
                yield* orch.botMessage(bot.id, message)
                return { sent: true }
              })
            )
        )
      }
      if (parentId)
        server.registerTool(
          'ask_parent',
          {
            ...toolMeta,
            description:
              'Ask the thread that created yours a question, such as a decision you need from it. Jetty sends it when your turn ends, and its answer arrives as your next message.',
            inputSchema: { question: text },
          },
          ({ question }) =>
            invoke(
              Effect.gen(function* () {
                const parent = yield* accessible(identity, parentId)
                yield* store.askParent(identity.threadId, question)
                return {
                  threadId: parent.id,
                  title: parent.title,
                  detail:
                    'Jetty sends your question when this turn ends, so end your turn now. The answer arrives as your next message.',
                }
              })
            )
        )
      if (!bot)
        server.registerTool(
          'link_pull_request',
          {
            ...toolMeta,
            description:
              "Each pull request belongs to one Jetty thread: the one that opened it or last pushed to its branch, and its CI, review and merge news go to that thread. Linking moves it here, so only do that to take a pull request over, with a URL or a number in this project's GitHub repo. To look at one, such as a child's, use `gh pr view`, which never takes it.",
            inputSchema: { pullRequest: z.string().trim().min(1).max(500) },
          },
          ({ pullRequest }) =>
            invoke(
              pullRequestLinks.link(identity.threadId, pullRequest).pipe(
                Effect.map(({ ref }) => ({
                  linked: `${ref.repo}#${ref.number}`,
                  url: `https://github.com/${ref.repo}/pull/${ref.number}`,
                }))
              )
            )
        )
      server.registerTool(
        'archive_thread',
        {
          ...toolMeta,
          description:
            "Archive a thread and everything under it. Not this thread, and not one above it. A thread that isn't under yours has to be idle, and so does everything under it. Work stops with no report back, worktree folders are removed and branches kept, so every worktree in the tree must be clean. The user can restore them.",
          inputSchema: { threadId: z.string() },
        },
        ({ threadId }) =>
          invoke(
            Effect.gen(function* () {
              const target = yield* archiveTarget(identity, threadId)
              yield* archiveThread(threadId).pipe(
                Effect.mapError((error) => new StoreError(error.code, error.message))
              )
              return { threadId, title: target.title, archived: true }
            })
          )
      )
      server.registerTool(
        'stop_thread',
        {
          ...toolMeta,
          description:
            'Stop one of your children: its turn and background tasks end, with no report back. Your next message to it starts it again. Safe to repeat.',
          inputSchema: { threadId: z.string() },
        },
        ({ threadId }) =>
          invoke(
            Effect.gen(function* () {
              yield* ownChild(identity, threadId)
              yield* orch.stopThread(threadId)
              return { threadId, stopped: true }
            })
          )
      )
      const media = await run(
        Effect.gen(function* () {
          const caller = yield* accessible(identity, identity.threadId)
          const project = yield* store.getProject(caller.projectId)
          if (!project) return yield* Effect.fail(new StoreError('not_found', 'Project not found'))
          const host = {
            attachments,
            resolveAttachment: (id: string, kind: 'image' | 'video') =>
              Effect.gen(function* () {
                const found = yield* store.reserveAttachment(caller.id, id, kind)
                if (yield* attachments.resolve(id)) return found
                return yield* Effect.fail(
                  new StoreError('not_found', `No ${kind} attachment ${id} in this project`)
                )
              }),
            projectPath: worktrees
              ? yield* Effect.promise(() => worktrees.root(caller.id))
              : project.path,
            turnId: () => orch.currentTurn(caller.id) ?? '',
            emit: (
              event: Parameters<typeof orch.emitMedia>[2],
              turnId: string,
              onCommit: Effect.Effect<void>
            ) => orch.emitMedia(caller.id, turnId, event, onCommit),
          }
          return [yield* createSendImagesTool(host), yield* createSendVideoTool(host)] as const
        })
      )
      const [images, video] = media
      server.registerTool(
        images.name,
        { ...toolMeta, description: images.description, inputSchema: images.inputSchema },
        images.handler
      )
      server.registerTool(
        video.name,
        { ...toolMeta, description: video.description, inputSchema: video.inputSchema },
        video.handler
      )
      if (!bot && desktops)
        server.registerTool(
          'desktop_session',
          {
            ...toolMeta,
            description:
              "Get this thread's Linux desktop, a virtual display the user can watch and drive live inside Jetty, starting it if it isn't running. Set DISPLAY to its display to run a headed browser or any other app there. Calling again returns the same desktop while it runs; it stops when the thread is archived or deleted.",
            inputSchema: {},
          },
          () =>
            invoke(
              Effect.tryPromise({
                try: () => desktops.ensure(identity.threadId),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              }).pipe(
                Effect.map(({ id, display }) => ({
                  id,
                  display,
                  link: `jetty://desktops/${id}`,
                }))
              )
            )
        )
    }

    async function handle(request: Request): Promise<Response> {
      const identity = sessions.authenticate(request.headers.get('authorization'))
      if (!identity) return new Response('Unauthorized', { status: 401 })
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as {
        method?: string
        params?: { name?: string; arguments?: { wait?: boolean } }
      } | null
      const waiting =
        body?.method === 'tools/call' &&
        body.params?.name === 'create_thread' &&
        body.params?.arguments?.wait === true
      const server = new McpServer({ name: 'jetty', version: '1.0.0' })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: !waiting,
      })
      try {
        await register(server, identity)
        await server.connect(transport)
        const response = await transport.handleRequest(request)
        if (!waiting || !response.body) {
          await server.close()
          return response
        }
        const reader = response.body.getReader()
        return new Response(
          new ReadableStream({
            async pull(controller) {
              try {
                const next = await reader.read()
                if (next.done) {
                  controller.close()
                  await server.close()
                } else controller.enqueue(next.value)
              } catch (error) {
                controller.error(error)
                await server.close()
              }
            },
            async cancel() {
              await reader.cancel()
              await server.close()
            },
          }),
          { status: response.status, headers: response.headers }
        )
      } catch (error) {
        await server.close()
        return new Response(error instanceof Error ? error.message : 'Thread unavailable', {
          status: 404,
        })
      }
    }
    return Object.assign(handle, { register })
  })
}
