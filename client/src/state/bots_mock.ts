import type { Connection } from '@/net/connection'
import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'
import type { ThreadUpdate } from '@jetty/shared/rpc'
import type {
  Bot,
  BotActivity,
  ChromePushData,
  ParamsOf,
  Project,
  ThreadMeta,
  WireError,
} from '@jetty/shared/wire'

import { applyEvent, emptyThread, type ThreadState } from '@jetty/shared/reducer'
import { methods, newId } from '@jetty/shared/wire'
import { Effect, Queue, Schema, Stream } from 'effect'

/* Bots before the server has them. VITE_BOTS_MOCK=bots serves five bots, one per face (working,
   unread, idle, needs you, failed) with Forge's workers; VITE_BOTS_MOCK=empty serves none. Bot
   traffic then stays in this tab: bot.*, and every thread call on a mock bot or worker. Everything
   else reaches the real server. Delete this file once M1's server lands. */

type MockThread = { state: ThreadState; listeners: Set<(update: ThreadUpdate) => void> }
type Step = {
  ms: number
  activity?: BotActivity
  say?: readonly string[]
  react?: string
  start?: string
}

const MINUTE = 60_000
const READ_MS = 450
const FORGE = 'mock-forge'

const bots = new Map<string, Bot>()
const workers = new Map<string, ThreadMeta>()
const threads = new Map<string, MockThread>()
const chromeListeners = new Set<(push: ChromePushData) => void>()
const timers = new Map<string, Set<ReturnType<typeof setTimeout>>>()
const replies = new Map<string, number>()
let seeded = false
// The first real project, where Forge's workers live.
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

function base(turnId: string, createdAt: number) {
  return { id: newId(), turnId, createdAt }
}

function done(turnId: string, createdAt: number) {
  return { ...base(turnId, createdAt), completedAt: createdAt }
}

function jett(turnId: string, createdAt: number, text: string, extra: object = {}): ThreadItem {
  return { ...done(turnId, createdAt), kind: 'user_message', text, attachments: [], ...extra }
}

function said(
  turnId: string,
  createdAt: number,
  text: string,
  hidden = false
): Extract<ThreadItem, { kind: 'assistant_message' }> {
  return {
    ...done(turnId, createdAt),
    kind: 'assistant_message',
    text,
    ...(hidden && { private: true as const }),
  }
}

function relayed(turnId: string, createdAt: number, from: ThreadMeta, text: string): ThreadItem {
  return jett(turnId, createdAt, text, { from: { threadId: from.id, title: from.title } })
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

function seedThread(id: string, items: readonly ThreadItem[], extra: Partial<ThreadState> = {}) {
  const turnOutcomes: Record<string, 'completed'> = {}
  for (const item of items) turnOutcomes[item.turnId] = 'completed'
  threads.set(id, {
    state: { ...emptyThread, items, turnOutcomes, lastTurnOutcome: 'completed', ...extra },
    listeners: new Set(),
  })
}

function makeBot(fields: Pick<Bot, 'id' | 'name' | 'shape' | 'color'> & Partial<Bot>): Bot {
  return {
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    fast: false,
    projectId: null,
    permissionMode: 'auto',
    createdAt: ago(60 * 24 * 7),
    activity: 'idle',
    needsYou: false,
    failed: false,
    unread: false,
    ...fields,
  }
}

function makeWorker(
  id: string,
  title: string,
  projectId: string,
  updatedAt: number,
  status: ThreadMeta['status'] = 'idle'
): ThreadMeta {
  return {
    id,
    projectId,
    environment: 'worktree',
    worktree: { state: 'ready', error: null, branch: `jetty/${id}` },
    title,
    status,
    archived: false,
    pinned: false,
    updatedAt,
    turnStartedAt: updatedAt - 3 * MINUTE,
    ...(status === 'idle' && { turnEndedAt: updatedAt }),
    provider: 'claude',
    model: 'sonnet',
    effort: 'high',
    parentThreadId: FORGE,
    createdBy: 'agent',
    botId: FORGE,
  }
}

// A worker's first message is the bot's brief: the chat shows it in the bot's colour.
function seedWorker(worker: ThreadMeta, brief: string, report?: string) {
  workers.set(worker.id, worker)
  const turn = newId()
  const from = { threadId: FORGE, title: 'Forge' }
  seedThread(
    worker.id,
    [
      jett(turn, worker.turnStartedAt ?? worker.updatedAt, brief, { from }),
      ...(report ? [said(turn, worker.updatedAt, report)] : []),
    ],
    worker.status === 'running'
      ? { status: 'running', activeTurnId: turn, turnOutcomes: {}, lastTurnOutcome: null }
      : {}
  )
}

function seed(projects: readonly Project[]) {
  seeded = true
  if (import.meta.env.VITE_BOTS_MOCK === 'empty') return
  const project = projects[0]?.id
  workProject = project
  const lint = project && makeWorker('mock-forge-lint', 'Fix lint', project, at(1, 16, 11))
  const stripe = project && makeWorker('mock-forge-stripe', 'Stripe SDK bump', project, ago(150))
  const flaky = project && makeWorker('mock-forge-flaky', 'Flaky checkout test', project, ago(148))
  const e2e = project && makeWorker('mock-forge-e2e', 'Checkout e2e timeout', project, ago(147))
  const webhook =
    project &&
    makeWorker('mock-forge-409', 'Refund webhook 409 retries', project, ago(1), 'running')
  if (lint && stripe && flaky && e2e && webhook) {
    seedWorker(
      lint,
      'Lint is red on main. Find which PRs break the new no-floating-promises rule, fix them on their branches, and report what changed.',
      'Two PRs were failing no-floating-promises. Both fixed and pushed; CI is green on both.'
    )
    seedWorker(stripe, 'Bump the Stripe SDK to 19.2 in services/payments.', 'Bumped; tests pass.')
    seedWorker(flaky, 'The checkout test flakes about one run in five. Find out why.', 'A race.')
    seedWorker(e2e, 'The checkout e2e suite times out on CI. Fix it.', 'Raised the timeout.')
    seedWorker(
      webhook,
      'Find out why the refund webhook retries twice when the processor returns 409, starting in services/refunds/webhook.ts. Report the cause before changing anything.'
    )
  }

  const y = newId()
  const yRich = newId()
  const morning = newId()
  const checkout = newId()
  const later = newId()
  const now = newId()
  const deploy = said(checkout, ago(118), 'Deploy’s clear from my side.')
  const forge: ThreadItem[] = [
    jett(y, at(1, 16, 2), 'Lint’s red on main again, can you look?'),
    said(y, at(1, 16, 3), 'I’ll look into that.'),
    ...(lint ? [marker(y, at(1, 16, 3), 'started', lint)] : []),
    ...(lint
      ? [
          relayed(
            y,
            at(1, 16, 11),
            lint,
            'Fix lint finished. Two PRs were failing no-floating-promises.'
          ),
        ]
      : []),
    said(y, at(1, 16, 11), 'Lint thread is done. Tell Jett both PRs are fixed.', true),
    said(
      y,
      at(1, 16, 12),
      'Two PRs were failing the new no-floating-promises rule. Both are fixed and CI’s green.'
    ),
    jett(y, at(1, 16, 14), 'Ship it', { reaction: '👍' }),
    jett(
      yRich,
      at(1, 16, 40),
      'What will the new decline messages say, and how often does each code come up?'
    ),
    said(
      yRich,
      at(1, 16, 41),
      [
        'Here’s the new copy, keyed by decline code, with how often each came up in the last 30 days.',
        '',
        '```ts payments/decline_copy.ts',
        'const declineCopy: Record<DeclineCode, string> = {',
        "  insufficient_funds: 'Your card has insufficient funds.',",
        "  card_declined: 'Your bank declined this card.',",
        "  expired_card: 'This card has expired.',",
        '}',
        '```',
        '',
        'Codes not in the map fall back to `card_declined`.',
        '',
        '| Code | New copy | Seen, 30d |',
        '| --- | --- | ---: |',
        '| `insufficient_funds` | Your card has insufficient funds. | 1,204 |',
        '| `card_declined` | Your bank declined this card. | 3,877 |',
        '| `expired_card` | This card has expired. | 412 |',
      ].join('\n')
    ),
    said(
      morning,
      ago(180),
      'Morning. The nightly build passed, and the refund retries are merged.'
    ),
    jett(checkout, ago(178), 'Can you get checkout green before the 3pm deploy?'),
    said(checkout, ago(177), 'On it. Three things are red, so three threads.'),
    ...(stripe && flaky && e2e
      ? [
          marker(checkout, ago(177), 'started', stripe),
          marker(checkout, ago(177), 'started', flaky),
          marker(checkout, ago(177), 'started', e2e),
          relayed(
            checkout,
            ago(150),
            flaky,
            'Flaky checkout test finished. A race in the refund retry path.'
          ),
          marker(checkout, ago(149), 'messaged', stripe),
        ]
      : []),
    said(
      checkout,
      ago(119),
      'All three are back and green. The flaky test was a real race in the refund retry path, and the fix is in the same PR.'
    ),
    deploy,
    jett(later, ago(116), 'Nice. Can you keep an eye on the payout logs today?', {
      replyTo: { itemId: deploy.id, text: deploy.text },
    }),
    said(later, ago(115), 'Will do. I’ll ping you if anything looks off.'),
    jett(now, ago(2), 'Why does the refund webhook retry twice on a 409?', { reaction: '👀' }),
    said(now, ago(2), 'I’ll look into that.'),
    ...(webhook ? [marker(now, ago(1), 'started', webhook)] : []),
  ]
  seedThread(FORGE, forge, {
    status: 'running',
    activeTurnId: now,
    turnOutcomes: Object.fromEntries(
      [y, yRich, morning, checkout, later].map((turn) => [turn, 'completed' as const])
    ),
    lastTurnOutcome: null,
  })

  const wrenTurn = newId()
  seedThread('mock-wren', [
    jett(wrenTurn, ago(50), 'tidy my dithering notes?'),
    said(wrenTurn, ago(49), 'Looking through your notes.'),
    said(wrenTurn, ago(40), 'Saved. Your dithering notes are one page now.'),
  ])

  const atlasTurn = newId()
  seedThread('mock-atlas', [
    jett(atlasTurn, at(1, 10, 5), 'Who owns the handbook’s onboarding section now?'),
    said(
      atlasTurn,
      at(1, 10, 6),
      'Priya, since the reorg in September. She’s also the one to ask about the new-starter checklist.'
    ),
  ])

  const probeTurn = newId()
  seedThread(
    'mock-probe',
    [
      jett(probeTurn, ago(15), 'pull last month’s statements'),
      said(probeTurn, ago(14), 'I can get them from the bank’s export or from the accounting app.'),
      {
        ...base(probeTurn, ago(14)),
        kind: 'question',
        questions: [
          {
            header: 'Source',
            question: 'Where should I pull last month’s statements from?',
            multiSelect: false,
            options: [
              { label: 'Bank export', description: 'Raw CSVs straight from the bank' },
              { label: 'Accounting app', description: 'Already categorised, a day behind' },
            ],
          },
        ],
      },
    ],
    {
      status: 'awaiting_approval',
      activeTurnId: probeTurn,
      turnOutcomes: {},
      lastTurnOutcome: null,
    }
  )

  const scoutTurn = newId()
  seedThread(
    'mock-scout',
    [
      jett(scoutTurn, ago(20), 'kick off the nightly build'),
      said(scoutTurn, ago(20), 'I’ll look into that.'),
      { ...done(scoutTurn, ago(19)), kind: 'error', message: 'The model provider is overloaded.' },
    ],
    { status: 'error', turnOutcomes: { [scoutTurn]: 'failed' }, lastTurnOutcome: 'failed' }
  )

  for (const bot of [
    makeBot({
      id: FORGE,
      name: 'Forge',
      shape: 'drop',
      color: 'teal',
      projectId: project ?? null,
      activity: 'working',
    }),
    makeBot({
      id: 'mock-wren',
      name: 'Wren',
      shape: 'flower',
      color: 'rose',
      model: 'sonnet',
      unread: true,
    }),
    makeBot({ id: 'mock-atlas', name: 'Atlas', shape: 'circle', color: 'blue' }),
    makeBot({ id: 'mock-probe', name: 'Probe', shape: 'hex', color: 'slate', needsYou: true }),
    makeBot({ id: 'mock-scout', name: 'Scout', shape: 'squircle', color: 'mint', failed: true }),
  ])
    bots.set(bot.id, bot)
}

function push(data: ChromePushData) {
  for (const listener of chromeListeners) listener(data)
}

function setBot(id: string, patch: Partial<Bot>) {
  const bot = bots.get(id)
  if (!bot) return
  const next = { ...bot, ...patch }
  bots.set(id, next)
  push({ type: 'bot.upserted', bot: next })
}

function setWorker(worker: ThreadMeta) {
  workers.set(worker.id, worker)
  push({ type: 'thread.upserted', thread: worker })
}

function emit(threadId: string, event: ThreadEvent) {
  const thread = threads.get(threadId)
  if (!thread) return
  const update = { seq: thread.state.lastSeq + 1, ts: Date.now(), event }
  thread.state = applyEvent(thread.state, update)
  for (const listener of thread.listeners) listener({ type: 'event', ...update })
}

function later(botId: string, ms: number, task: () => void) {
  const pending = timers.get(botId) ?? new Set()
  const timer = setTimeout(() => {
    pending.delete(timer)
    task()
  }, ms)
  pending.add(timer)
  timers.set(botId, pending)
}

function cancel(botId: string) {
  for (const timer of timers.get(botId) ?? []) clearTimeout(timer)
  timers.delete(botId)
}

function lastJettMessage(botId: string) {
  return threads
    .get(botId)
    ?.state.items.findLast((item) => item.kind === 'user_message' && !item.from)
}

function startWorker(botId: string, turnId: string, title: string) {
  if (!workProject) return
  const worker = {
    ...makeWorker(newId(), title, workProject, Date.now(), 'running'),
    parentThreadId: botId,
    botId,
  }
  seedWorker(worker, `${title}. Report what you find.`)
  setWorker(worker)
  emit(botId, { type: 'item.started', item: marker(turnId, Date.now(), 'started', worker) })
}

// A turn plays its steps one after another; a turn that said something ends unread.
function play(botId: string, turnId: string, steps: readonly Step[]) {
  cancel(botId)
  const spoke = steps.some((step) => step.say?.length)
  let wait = READ_MS
  for (const step of steps) {
    later(botId, wait, () => {
      if (step.activity) setBot(botId, { activity: step.activity })
    })
    wait += step.ms
    later(botId, wait, () => {
      const message = lastJettMessage(botId)
      if (step.react && message)
        emit(botId, { type: 'item.updated', itemId: message.id, patch: { reaction: step.react } })
      for (const text of step.say ?? [])
        emit(botId, { type: 'item.started', item: said(turnId, Date.now(), text) })
      if (step.start) startWorker(botId, turnId, step.start)
    })
  }
  later(botId, wait, () => {
    emit(botId, { type: 'turn.completed', turnId })
    setBot(botId, { activity: 'idle', ...(spoke && { unread: true }) })
  })
}

const scripts: readonly (readonly Step[])[] = [
  [{ ms: 1300, activity: 'typing', say: ['On it.'] }],
  [{ ms: 0, react: '👍' }],
  [
    { ms: 900, activity: 'typing', say: ['I’ll check what’s failing on those PRs.'] },
    { ms: 0, activity: 'working', start: 'Fix failing PR checks' },
    { ms: 2400 },
    {
      ms: 1200,
      activity: 'typing',
      say: ['Started a thread for that. I’ll tell you when it lands.'],
    },
  ],
  [
    { ms: 0, react: '👀' },
    {
      ms: 1300,
      activity: 'typing',
      say: [
        'Three things.',
        'The retry backoff needs a test for the max delay.',
        'And Priya wants the merchant queue behind a flag before it ships.',
      ],
    },
  ],
]

function createBot(params: ParamsOf<'bot.create'>) {
  const existing = bots.get(params.id)
  if (existing) return existing
  const bot: Bot = {
    ...params,
    createdAt: Date.now(),
    activity: 'typing',
    needsYou: false,
    failed: false,
    unread: false,
  }
  bots.set(bot.id, bot)
  seedThread(bot.id, [])
  push({ type: 'bot.upserted', bot })
  const turnId = newId()
  emit(bot.id, { type: 'turn.started', turnId })
  play(bot.id, turnId, [
    {
      ms: 1400,
      activity: 'typing',
      say: [
        `Hi, I’m ${bot.name}.`,
        'What should I look after? A project, a stream of issues, a chore you keep putting off? A sentence or two is plenty.',
      ],
    },
  ])
  return bot
}

function send({ botId, messageId, text, replyTo }: ParamsOf<'bot.send'>) {
  const thread = threads.get(botId)
  if (!thread) return
  if (thread.state.items.some((item) => item.id === messageId)) return
  const quoted = replyTo && thread.state.items.find((item) => item.id === replyTo)
  const running = thread.state.activeTurnId
  const turnId = running ?? newId()
  emit(botId, {
    type: 'item.started',
    item: {
      id: messageId,
      turnId,
      createdAt: Date.now(),
      completedAt: Date.now(),
      kind: 'user_message',
      text,
      attachments: [],
      ...(quoted && 'text' in quoted && { replyTo: { itemId: quoted.id, text: quoted.text } }),
    },
  })
  if (!running) emit(botId, { type: 'turn.started', turnId })
  setBot(botId, { unread: false, failed: false })
  const count = replies.get(botId) ?? 0
  replies.set(botId, count + 1)
  play(botId, turnId, scripts[count % scripts.length]!)
}

function interrupt(threadId: string) {
  const turnId = threads.get(threadId)?.state.activeTurnId
  cancel(threadId)
  if (turnId) emit(threadId, { type: 'turn.failed', turnId, error: 'interrupted' })
  setBot(threadId, { activity: 'idle' })
}

function answer(threadId: string, itemId: string, answers: Record<string, string> | null) {
  emit(threadId, {
    type: 'item.completed',
    itemId,
    patch: answers ? { answers } : { dismissed: true },
  })
  setBot(threadId, { needsYou: false })
  const turnId = threads.get(threadId)?.state.activeTurnId ?? newId()
  const choice = answers && Object.values(answers)[0]
  play(threadId, turnId, [
    {
      ms: 1300,
      activity: 'typing',
      say: [
        choice ? `Got it, pulling them from the ${choice.toLowerCase()}.` : 'Okay, leaving it.',
      ],
    },
  ])
}

const notFound: WireError = { code: 'not_found', message: 'Not in the bots mock' }

// What the mock answers; undefined passes the call to the server.
function handle(tag: string, payload: Record<string, unknown>) {
  switch (tag) {
    case 'bot.create':
      return Effect.sync(() => ({ bot: createBot(payload as ParamsOf<'bot.create'>) }))
    case 'bot.send':
      return Effect.sync(() => (send(payload as ParamsOf<'bot.send'>), null))
    case 'bot.markSeen':
      return Effect.sync(() => (setBot(String(payload.botId), { unread: false }), null))
  }
  const threadId = typeof payload.threadId === 'string' ? payload.threadId : undefined
  if (!threadId || !threads.has(threadId)) return undefined
  switch (tag) {
    case 'turn.interrupt':
      return Effect.sync(() => (interrupt(threadId), null))
    case 'question.respond':
      return Effect.sync(() => {
        const { itemId, answers } = payload as ParamsOf<'question.respond'>
        answer(threadId, itemId, answers)
        return null
      })
    case 'question.dismiss':
      return Effect.sync(() => (answer(threadId, String(payload.itemId), null), null))
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
      const listener = (push: ChromePushData) => Queue.offerUnsafe(queue, push)
      chromeListeners.add(listener)
      return listener
    }),
    (listener) => Effect.sync(() => chromeListeners.delete(listener))
  )
)

function withMock(push: ChromePushData): ChromePushData {
  if (push.type !== 'snapshot') return push
  if (!seeded) seed(push.projects)
  return {
    ...push,
    threads: [...push.threads, ...workers.values()],
    bots: [...bots.values()],
  }
}

export function withBotsMock(connection: Connection): Connection {
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
