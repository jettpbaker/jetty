import type { Connection } from '@/net/connection'
import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { ThreadUpdate } from '@jetty/shared/rpc'
import type {
  Bot,
  ChromePushData,
  ParamsOf,
  Project,
  ThreadMeta,
  WireError,
} from '@jetty/shared/wire'

import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { methods, newId, worktreeSetupPrompt } from '@jetty/shared/wire'
import { Effect, Queue, Schema, Stream } from 'effect'

/* Quiet threads before the server has them (docs/bots/m2.md). VITE_BOTS_MOCK=quiet adds a bot,
   Forge, beside the real ones, with five workers in the first project: three quiet (a read-only
   lookup and a typo fix, both done, and a version bump that surfaces 15s after load by asking for
   approval), one ordinary, and one setup_worktrees thread. Forge's chat links a quiet thread and
   holds markers for every worker, quiet ones included, as the server writes them. Opening or
   pinning a quiet worker surfaces it, and each message to Forge starts a quiet read-only thread
   that it waits on, then answers. Traffic for Forge and its workers stays in this tab; everything
   else reaches the real server. Delete this file once M2's server lands. */

type MockThread = { state: ThreadState; listeners: Set<(update: ThreadUpdate) => void> }

const MINUTE = 60_000
const SURFACE_MS = 15_000
const WAIT_MS = 4000
const FORGE = 'mock-quiet-forge'
// Thread ids are uuids, as jetty://threads/ links need.
const TRACE = '0a2e0000-0000-4000-8000-000000000001'
const LOOKUP = '0a2e0000-0000-4000-8000-000000000002'
const TYPO = '0a2e0000-0000-4000-8000-000000000003'
const BUMP = '0a2e0000-0000-4000-8000-000000000004'
const SETUP = '0a2e0000-0000-4000-8000-000000000005'
const SETUP_GUIDE = '/Users/jett/code/projects/jetty/docs/worktree-setup.md'

const bots = new Map<string, Bot>()
const workers = new Map<string, ThreadMeta>()
const threads = new Map<string, MockThread>()
const chromeListeners = new Set<(push: ChromePushData) => void>()
const timers = new Set<ReturnType<typeof setTimeout>>()
let seeded = false
let workProject: string | undefined

// Local time, so stamps read "Yesterday 4:02 pm" whatever the zone.
function at(daysAgo: number, hour: number, minute: number) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

function ago(minutes: number) {
  return Date.now() - minutes * MINUTE
}

function done(turnId: string, createdAt: number) {
  return { id: newId(), turnId, createdAt, completedAt: createdAt }
}

function jett(turnId: string, createdAt: number, text: string, extra: object = {}): ThreadItem {
  return { ...done(turnId, createdAt), kind: 'user_message', text, attachments: [], ...extra }
}

function said(turnId: string, createdAt: number, text: string): ThreadItem {
  return { ...done(turnId, createdAt), kind: 'assistant_message', text }
}

function brief(turnId: string, createdAt: number, text: string): ThreadItem {
  return jett(turnId, createdAt, text, { from: { threadId: FORGE, title: 'Forge' } })
}

function marker(
  turnId: string,
  createdAt: number,
  action: 'started' | 'messaged',
  thread: ThreadMeta
): ThreadItem {
  return {
    ...done(turnId, createdAt),
    kind: 'thread_marker',
    action,
    threadId: thread.id,
    title: thread.title,
  }
}

function link(thread: ThreadMeta) {
  return `[${thread.title}](jetty://threads/${thread.id})`
}

function seedThread(id: string, items: readonly ThreadItem[], extra: Partial<ThreadState> = {}) {
  const turnOutcomes: Record<string, 'completed'> = {}
  for (const item of items) turnOutcomes[item.turnId] = 'completed'
  threads.set(id, {
    state: { ...emptyThread, items, turnOutcomes, lastTurnOutcome: 'completed', ...extra },
    listeners: new Set(),
  })
}

function makeWorker(
  fields: Pick<ThreadMeta, 'id' | 'title' | 'projectId' | 'updatedAt'> & Partial<ThreadMeta>
): ThreadMeta {
  const environment = fields.environment ?? 'worktree'
  const status = fields.status ?? 'idle'
  return {
    environment,
    ...(environment === 'worktree' && {
      worktree: { state: 'ready', error: null, branch: `jetty/${fields.id}` },
    }),
    status,
    archived: false,
    pinned: false,
    turnStartedAt: fields.updatedAt - 2 * MINUTE,
    ...(status === 'idle' && { turnEndedAt: fields.updatedAt }),
    provider: 'claude',
    model: 'sonnet',
    effort: 'medium',
    parentThreadId: FORGE,
    createdBy: 'agent',
    botId: FORGE,
    ...fields,
  }
}

// A worker's first message is Forge's brief; a finished one ends on its report.
function seedWorker(worker: ThreadMeta, text: string, report?: string, extra: ThreadItem[] = []) {
  workers.set(worker.id, worker)
  const turn = newId()
  const items = [
    brief(turn, worker.turnStartedAt ?? worker.updatedAt, text),
    ...extra.map((item) => ({ ...item, turnId: turn })),
    ...(report ? [said(turn, worker.updatedAt, report)] : []),
  ]
  seedThread(
    worker.id,
    items,
    worker.status === 'idle'
      ? {}
      : { status: worker.status, activeTurnId: turn, turnOutcomes: {}, lastTurnOutcome: null }
  )
}

function seed(projects: readonly Project[]) {
  seeded = true
  const project = projects[0]?.id
  workProject = project
  const forge: ThreadItem[] = []
  if (project) {
    const lookup = makeWorker({
      id: LOOKUP,
      title: 'Where refund retries are configured',
      projectId: project,
      updatedAt: at(1, 16, 3),
      environment: 'local',
      model: 'haiku',
      quiet: true,
      readOnly: true,
    })
    const typo = makeWorker({
      id: TYPO,
      title: 'Fix refund error typo',
      projectId: project,
      updatedAt: ago(88),
      quiet: true,
    })
    const setup = makeWorker({
      id: SETUP,
      title: 'Set up worktrees',
      projectId: project,
      updatedAt: ago(55),
      environment: 'local',
    })
    const trace = makeWorker({
      id: TRACE,
      title: 'Trace ids in payout logs',
      projectId: project,
      updatedAt: ago(1),
      status: 'running',
      model: 'opus',
      effort: 'high',
    })
    const bump = makeWorker({
      id: BUMP,
      title: 'Bump payout-client to 4.2.1',
      projectId: project,
      updatedAt: ago(1),
      status: 'running',
      quiet: true,
    })
    seedWorker(
      lookup,
      "Find where refund retries are configured in paypa-stack: the attempt count, the delay, and what reads them. Don't change anything. Report file paths and line numbers.",
      "services/refunds/config.ts:12–18 sets `maxAttempts: 3`, `baseDelayMs: 2000` and `backoff: 'exponential'`. services/refunds/webhook.ts:41 reads it once, in `createWebhookHandler`, at boot."
    )
    seedWorker(
      typo,
      'The refund error copy in services/refunds/errors.ts says “refudn”. Fix the typo, run the refunds tests, and push it straight to main.',
      'Fixed “refudn” to “refund” in services/refunds/errors.ts:27. Refunds tests pass. Pushed 9c41e07 to main.'
    )
    seedWorker(
      setup,
      worktreeSetupPrompt(SETUP_GUIDE),
      'Wrote .jetty/worktree.json with `{ "setup": "bun install" }`, and a .worktreeinclude that copies .env.local.'
    )
    seedWorker(
      trace,
      'Add a trace id to every log line in services/payouts, taken from the incoming request’s `x-trace-id` header (generate one when it’s missing). Start with the logger, then payments and ledger. Report what changed and how you checked it.'
    )
    seedWorker(
      bump,
      'Bump @paypa/payout-client from 4.2.0 to 4.2.1 in services/payouts, run its tests, and push it straight to main.',
      undefined,
      [said('', ago(1), 'Bumping the version in services/payouts/package.json.')]
    )

    const y = newId()
    const which = newId()
    const fix = newId()
    const setUp = newId()
    const now = newId()
    forge.push(
      jett(y, at(1, 16, 2), 'Where do we configure refund retries?'),
      marker(y, at(1, 16, 2), 'started', lookup),
      said(
        y,
        at(1, 16, 3),
        'In `services/refunds/config.ts`: three tries, 2s apart, doubling each time. The webhook handler reads it once at boot, so a change needs a deploy.'
      ),
      jett(which, at(1, 16, 5), 'which thread looked that up?'),
      said(which, at(1, 16, 5), `${link(lookup)} read it for me.`),
      jett(fix, ago(90), 'The refund error says “refudn”, can you fix it?', { reaction: '👍' }),
      marker(fix, ago(90), 'started', typo),
      said(fix, ago(88), 'Fixed and pushed to main.'),
      jett(setUp, ago(57), 'Is paypa-stack set up for worktrees yet?'),
      said(setUp, ago(57), 'Not yet, so I’ve started a thread to set it up.'),
      marker(setUp, ago(57), 'started', setup),
      jett(now, ago(2), 'Can you get trace ids into the payout logs? Bump the payout client too.'),
      said(now, ago(2), 'I’ll start a thread for the trace ids and bump the client on the side.'),
      marker(now, ago(2), 'started', trace),
      marker(now, ago(2), 'started', bump)
    )
    later(SURFACE_MS, surfaceBump)
  }
  seedThread(FORGE, forge)
  bots.set(FORGE, {
    id: FORGE,
    name: 'Forge',
    shape: 'drop',
    color: 'teal',
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    fast: false,
    projectId: project ?? null,
    permissionMode: 'auto',
    createdAt: ago(60 * 24 * 7),
    activity: 'idle',
    needsYou: false,
    failed: false,
    unread: false,
    tasks: [],
  })
}

function push(data: ChromePushData) {
  for (const listener of chromeListeners) listener(data)
}

function setBot(patch: Partial<Bot>) {
  const bot = bots.get(FORGE)
  if (!bot) return
  const next = { ...bot, ...patch }
  bots.set(FORGE, next)
  push({ type: 'bot.upserted', bot: next })
}

function setWorker(id: string, patch: Partial<ThreadMeta>) {
  const worker = workers.get(id)
  if (!worker) return
  // The server drops quiet once a thread surfaces.
  const { quiet, ...rest } = { ...worker, ...patch }
  const next: ThreadMeta = quiet ? { ...rest, quiet } : rest
  workers.set(id, next)
  push({ type: 'thread.upserted', thread: next })
}

function emit(threadId: string, event: ThreadEvent) {
  const thread = threads.get(threadId)
  if (!thread) return
  const update = { seq: thread.state.lastSeq + 1, ts: Date.now(), event }
  thread.state = applyEvent(thread.state, update)
  for (const listener of thread.listeners) listener({ type: 'event', ...update })
}

function later(ms: number, task: () => void) {
  const timer = setTimeout(() => {
    timers.delete(timer)
    task()
  }, ms)
  timers.add(timer)
}

// Needing Jett is one of the things that surfaces a quiet thread.
function surfaceBump() {
  const bump = workers.get(BUMP)
  const turnId = threads.get(BUMP)?.state.activeTurnId
  if (!bump || !turnId) return
  emit(BUMP, {
    type: 'item.started',
    item: {
      id: newId(),
      turnId,
      createdAt: Date.now(),
      kind: 'approval',
      title: 'Install dependencies',
      toolName: 'Bash',
      input: { command: 'bun install', description: 'Install dependencies' },
      suggestions: [],
    },
  })
  emit(BUMP, { type: 'session.status', status: 'awaiting_approval' })
  setWorker(BUMP, { status: 'awaiting_approval', quiet: false, updatedAt: Date.now() })
  setBot({ needsYou: true })
  // Jetty wakes Forge with the news; only what it says shows.
  const wake = newId()
  emit(FORGE, { type: 'turn.started', turnId: wake })
  emit(FORGE, {
    type: 'item.started',
    item: said(
      wake,
      Date.now(),
      `The payout client bump wants to run \`bun install\` in its worktree, which fetches from the registry. I’d allow it: ${link(bump)}`
    ),
  })
  emit(FORGE, { type: 'turn.completed', turnId: wake })
  setBot({ unread: true })
}

function approveBump(itemId: string, decision: string) {
  const turnId = threads.get(BUMP)?.state.activeTurnId
  if (!turnId) return
  emit(BUMP, { type: 'item.completed', itemId, patch: { decision } })
  emit(BUMP, { type: 'session.status', status: 'running' })
  setWorker(BUMP, { status: 'running', updatedAt: Date.now() })
  setBot({ needsYou: false })
  later(2000, () => {
    emit(BUMP, {
      type: 'item.started',
      item: said(
        turnId,
        Date.now(),
        decision === 'deny'
          ? 'Stopped: installing was denied, so the bump isn’t pushed.'
          : 'Bumped to 4.2.1; payouts tests pass. Pushed 3f2a91c to main.'
      ),
    })
    emit(BUMP, { type: 'turn.completed', turnId })
    setWorker(BUMP, { status: 'idle', turnEndedAt: Date.now(), updatedAt: Date.now() })
  })
}

// Opening or pinning a quiet thread makes it an ordinary one.
function surface(threadId: string, patch: Partial<ThreadMeta> = {}) {
  setWorker(threadId, { ...patch, ...(workers.get(threadId)?.quiet && { quiet: false }) })
}

// Each message gets a quiet read-only thread Forge waits on (no marker shows), then the answer.
function send({ messageId, text, replyTo }: ParamsOf<'bot.send'>) {
  const thread = threads.get(FORGE)
  if (!thread || thread.state.items.some((item) => item.id === messageId)) return
  const running = thread.state.activeTurnId
  const turnId = running ?? newId()
  emit(FORGE, {
    type: 'item.started',
    item: {
      id: messageId,
      turnId,
      createdAt: Date.now(),
      completedAt: Date.now(),
      kind: 'user_message',
      text,
      attachments: [],
      ...(replyTo && { replyTo }),
    },
  })
  if (running) return
  emit(FORGE, { type: 'turn.started', turnId })
  setBot({ unread: false, failed: false, activity: 'typing' })
  later(900, () => {
    emit(FORGE, { type: 'item.started', item: said(turnId, Date.now(), 'I’ll check.') })
    if (!workProject) return
    const lookup = makeWorker({
      id: newId(),
      title: 'Who calls refundPayment',
      projectId: workProject,
      updatedAt: Date.now(),
      environment: 'local',
      model: 'haiku',
      status: 'running',
      quiet: true,
      readOnly: true,
    })
    seedWorker(
      lookup,
      "List every caller of `refundPayment` in paypa-stack, with file paths and line numbers. Don't change anything."
    )
    push({ type: 'thread.upserted', thread: lookup })
    emit(FORGE, { type: 'item.started', item: marker(turnId, Date.now(), 'started', lookup) })
    setBot({ activity: 'working' })
    later(WAIT_MS, () => {
      const report =
        'services/refunds/webhook.ts:58 and jobs/reconcile.ts:112. Both go through `RefundService`.'
      const lookupTurn = threads.get(lookup.id)?.state.activeTurnId
      if (lookupTurn) {
        emit(lookup.id, { type: 'item.started', item: said(lookupTurn, Date.now(), report) })
        emit(lookup.id, { type: 'turn.completed', turnId: lookupTurn })
      }
      setWorker(lookup.id, { status: 'idle', turnEndedAt: Date.now(), updatedAt: Date.now() })
      setBot({ activity: 'typing' })
      later(1100, () => {
        emit(FORGE, {
          type: 'item.started',
          item: said(
            turnId,
            Date.now(),
            'Two places: the refund webhook handler and the nightly reconcile job. Both go through `RefundService`.'
          ),
        })
        emit(FORGE, { type: 'turn.completed', turnId })
        setBot({ activity: 'idle', unread: true })
      })
    })
  })
}

function interrupt() {
  const turnId = threads.get(FORGE)?.state.activeTurnId
  if (turnId) emit(FORGE, { type: 'turn.failed', turnId, error: 'interrupted' })
  setBot({ activity: 'idle' })
}

const notFound: WireError = { code: 'not_found', message: 'Not in the quiet threads mock' }

// What the mock answers; undefined passes the call to the server.
function handle(tag: string, payload: Record<string, unknown>) {
  const botId = typeof payload.botId === 'string' ? payload.botId : undefined
  if (botId === FORGE)
    switch (tag) {
      case 'bot.send':
        return Effect.sync(() => (send(payload as ParamsOf<'bot.send'>), null))
      case 'bot.markSeen':
        return Effect.sync(() => (setBot({ unread: false }), null))
    }
  const threadId = typeof payload.threadId === 'string' ? payload.threadId : undefined
  if (!threadId || !threads.has(threadId)) return undefined
  switch (tag) {
    case 'thread.markSeen':
      return Effect.sync(() => (surface(threadId), null))
    case 'thread.pin':
      return Effect.sync(() => {
        const { pinned } = payload as ParamsOf<'thread.pin'>
        surface(threadId, pinned ? { pinned } : {})
        if (!pinned) setWorker(threadId, { pinned })
        return null
      })
    case 'thread.archive':
      return Effect.sync(() => {
        setWorker(threadId, { archived: (payload as ParamsOf<'thread.archive'>).archived })
        return null
      })
    case 'thread.rename':
      return Effect.sync(() => {
        setWorker(threadId, { title: (payload as ParamsOf<'thread.rename'>).title })
        return null
      })
    case 'thread.worktreeChanges':
      return Effect.succeed({ count: 0 })
    case 'turn.interrupt':
      return Effect.sync(() => {
        if (threadId === FORGE) interrupt()
        return null
      })
    case 'approval.respond':
      return Effect.sync(() => {
        const { itemId, decision } = payload as ParamsOf<'approval.respond'>
        if (threadId === BUMP) approveBump(itemId, decision)
        return null
      })
  }
  const method = methods[tag as keyof typeof methods]
  return method && method.result === Schema.Null ? Effect.succeed(null) : Effect.fail(notFound)
}

function threadStream(threadId: string) {
  return Stream.callback<ThreadUpdate>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const thread = threads.get(threadId)!
        Queue.offerUnsafe(queue, {
          type: 'snapshot',
          snapshot: thread.state,
          seq: thread.state.lastSeq,
        })
        const listener = (update: ThreadUpdate) => Queue.offerUnsafe(queue, update)
        thread.listeners.add(listener)
        return listener
      }),
      (listener) => Effect.sync(() => threads.get(threadId)?.listeners.delete(listener))
    )
  )
}

const chromePushes = Stream.callback<ChromePushData>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const listener = (data: ChromePushData) => Queue.offerUnsafe(queue, data)
      chromeListeners.add(listener)
      return listener
    }),
    (listener) => Effect.sync(() => chromeListeners.delete(listener))
  )
)

function withMock(data: ChromePushData): ChromePushData {
  if (data.type !== 'snapshot') return data
  if (!seeded) seed(data.projects)
  return {
    ...data,
    threads: [...data.threads, ...workers.values()],
    bots: [...(data.bots ?? []), ...bots.values()],
  }
}

export function withQuietMock(connection: Connection): Connection {
  const request = ((tag: string, payload: Record<string, unknown>, options?: unknown) =>
    handle(tag, payload) ??
    (connection.request as (...args: unknown[]) => unknown)(
      tag,
      payload,
      options
    )) as Connection['request']
  return {
    ...connection,
    request,
    subscribeChrome: () =>
      Stream.merge(connection.subscribeChrome().pipe(Stream.map(withMock)), chromePushes),
    subscribeThread: (threadId, afterSeq) =>
      threads.has(threadId)
        ? threadStream(threadId)
        : connection.subscribeThread(threadId, afterSeq),
  }
}
