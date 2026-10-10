import { ThreadEvent } from '@jetty/shared/events'
import { applyEvent, emptyThread } from '@jetty/shared/reducer'
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'

import { projectTurn, type TurnView } from '../src/components/custom/hybrid_v2/projection'
import { createThreadRows, singleTurnRows } from '../src/components/custom/thread_rows'
import { streamStates } from '../src/dev/stream_states'

const decode = Schema.decodeUnknownSync(ThreadEvent)

for (const name of ['one-turn', 'two-turns', 'opus-real']) {
  describe(name, () => {
    test('projects each event with truthful live rows, sealed batches and counts', async () => {
      const replay = await Bun.file(`${import.meta.dir}/../src/dev/replays/${name}.json`).json()
      const build = createThreadRows()
      let state = emptyThread
      let sandboxChecked = false
      let previous = new Map<string, TurnView>()
      for (const [index, { t, event }] of replay.events.entries()) {
        const decoded = decode(event)
        state = applyEvent(state, {
          seq: index + 1,
          ts: t,
          event:
            decoded.type === 'item.started'
              ? { ...decoded, item: { ...decoded.item, createdAt: t } }
              : decoded,
        })
        const rows = singleTurnRows(
          build(state.items, {
            status: state.status,
            running: state.activeTurnId !== null,
            outcomes: state.turnOutcomes,
            projectPath: replay.projectPath,
            threadId: name,
          }),
          state.items
        )
        expect(rows.filter((row) => row.kind === 'user').length).toBe(
          state.items.filter((item) => item.kind === 'user_message').length
        )
        const current = new Map<string, TurnView>()
        for (const [at, work] of rows.entries()) {
          if (work.kind !== 'work') continue
          const next = rows[at + 1]
          const answer = next?.kind === 'assistant' || next?.kind === 'plan' ? next : undefined
          const view = projectTurn({ work, answer, revealDone: false, now: t })
          if (view.elapsedSeconds !== undefined)
            expect(view.elapsedSeconds).toBeGreaterThanOrEqual(0)
          current.set(work.id, view)
          for (const row of view.rows.filter((row) => row.live))
            expect(row.id === view.cursor || row.runningCalls.length > 0).toBe(true)
          expect(view.cursor !== null).toBe(view.rows.some((row) => row.live) || view.now !== null)
          expect(view.folded).toBe(false)
          expect(projectTurn({ work, answer, revealDone: true }).folded).toBe(
            !view.running && !!answer
          )
          for (const [rowIndex, row] of view.rows.entries()) {
            if (row.label.tense === 'present' && rowIndex < view.rows.length - 1) {
              expect(row.runningCalls.length).toBeGreaterThan(0)
              expect(
                view.rows
                  .slice(rowIndex + 1)
                  .some((later) => later.live || later.runningCalls.length > 0)
              ).toBe(true)
            }
            if (row.entry?.type === 'tools') {
              expect(row.entry.sealed).toBe(rowIndex < view.rows.length - 1 || !view.running)
              if (row.entry.calls.length > 1) {
                expect(row.label.count).toBe(row.entry.calls.length)
                expect(row.label.target.startsWith(`${row.entry.calls.length} `)).toBe(true)
              } else expect(row.label.target).toBe(row.entry.calls[0]!.target)
              const old = previous.get(work.id)?.rows.find((before) => before.id === row.id)
              if (old?.entry?.type === 'tools' && old.entry.sealed)
                expect(row.entry.sealed).toBe(true)
            }
          }
          if (name === 'one-turn' && t >= 8676 && t < 9000) {
            const read = view.rows.find(
              (row) =>
                row.entry?.type === 'tools' &&
                row.entry.calls.some((call) => call.target === 'src/sandbox.ts')
            )
            if (read && view.rows.some((row) => row.label.verb === 'Thinking')) {
              expect(read.label.text).toBe('Read 2 files')
              expect(read.live).toBe(false)
              expect(read.shimmer).toBe(false)
              sandboxChecked = true
            }
          }
        }
        previous = current
      }
      if (name === 'one-turn') expect(sandboxChecked).toBe(true)
    })
  })
}

test('parallel tools keep their own tense while the tail alone owns the cursor', () => {
  const work = {
    kind: 'work' as const,
    id: 'work',
    turnId: 'turn',
    status: 'running' as const,
    activities: [
      {
        type: 'tool' as const,
        id: 'read',
        kind: 'read' as const,
        name: 'Read',
        target: 'src/a.ts',
        status: 'running' as const,
      },
      { type: 'thinking' as const, id: 'thinking', status: 'running' as const, summary: '' },
    ],
  }
  for (const line of ['today', '2a', '2b', 'both'] as const) {
    const view = projectTurn({ work, revealDone: false, line })
    expect(view.cursor).toBe('thinking')
    expect(view.rows.map((row) => row.live)).toEqual([true, true])
    expect(view.rows.map((row) => row.label.tense)).toEqual(['present', 'present'])
    expect(view.rows[0]!.shimmer).toBe(true)
    expect(view.rows[0]!.runningCalls).toEqual(['read'])
    expect(view.rows[0]!.entry?.type === 'tools' && view.rows[0]!.entry.sealed).toBe(true)
    expect(view.now?.text ?? null).toBe(line === 'today' || line === '2b' ? 'Thinking' : null)
  }
})

test('gaps have an immediate stand-in and an interim message owns the tail and seals the batch', () => {
  const build = createThreadRows()
  const events = [
    { type: 'turn.started', turnId: 'turn' },
    {
      type: 'item.started',
      item: {
        id: 'user',
        turnId: 'turn',
        createdAt: 0,
        kind: 'user_message',
        text: 'hello',
        attachments: [],
      },
    },
    {
      type: 'item.started',
      item: {
        id: 'read',
        turnId: 'turn',
        createdAt: 1,
        kind: 'tool_call',
        toolName: 'Read',
        input: { file_path: 'src/a.ts' },
        output: '',
        status: 'succeeded',
        completedAt: 2,
      },
    },
    {
      type: 'item.started',
      item: {
        id: 'interim',
        turnId: 'turn',
        createdAt: 3,
        kind: 'assistant_message',
        text: 'Next step',
        streaming: false,
      },
    },
  ]
  let state = emptyThread
  for (const [index, event] of events.entries())
    state = applyEvent(state, { seq: index + 1, ts: index, event: decode(event) })
  const rows = singleTurnRows(
    build(state.items, { status: state.status, running: true }),
    state.items
  )
  const work = rows.find((row) => row.kind === 'work')!
  if (work.kind !== 'work') throw new Error('Missing work')
  const view = projectTurn({ work, revealDone: false })
  expect(view.rows[0]!.label.text).toBe('Read src/a.ts')
  expect(view.rows[0]!.entry?.type === 'tools' && view.rows[0]!.entry.sealed).toBe(true)
  expect(view.now).toBeNull()
  expect(view.cursor).toBe('interim')
  const gap = projectTurn({ work: { ...work, flow: [], activities: [] }, revealDone: false })
  expect(gap.now?.text).toBe('Planning next moves')
  expect(gap.cursor).toBe('user:work:now')
})

function galleryView(id: string, elapsed: number) {
  const card = streamStates.find((card) => card.id === id)!
  let state = emptyThread
  const events = [
    ...card.initial,
    ...card.events.filter(({ t }) => t <= elapsed).map(({ event }) => event),
  ]
  for (const [index, event] of events.entries())
    state = applyEvent(state, { seq: index + 1, ts: index, event })
  const rows = singleTurnRows(
    createThreadRows()(state.items, {
      status: state.status,
      running: state.activeTurnId !== null,
    }).filter((row) => row.kind !== 'marker'),
    state.items
  )
  const work = rows.find((row) => row.kind === 'work')!
  if (work.kind !== 'work') throw new Error('Missing work')
  return projectTurn({ work, items: state.items, revealDone: false })
}

test('thinking projects ticking counts and preserves the total in past tense', () => {
  for (const [elapsed, count] of [
    [0, 5],
    [600, 10],
    [1200, 50],
  ]) {
    const row = galleryView('tokens', elapsed!).rows[0]!
    expect(row.label.count).toBe(count)
    expect(row.label.text).toBe(`Thinking for ${count} tokens`)
  }
  const thought = galleryView('thought-tokens', 600).rows[0]!
  expect(thought.label.count).toBe(50)
  expect(thought.label.text).toBe('Thought for 50 tokens')
  expect(thought.label.tense).toBe('past')
})

test('Bash descriptions stay prose while described batches use counts', () => {
  const active = galleryView('bash', 0).rows[0]!
  expect(active.label.text).toBe('Check the client')
  expect(active.label.mono).toBe(false)
  expect(active.label.tense).toBe('present')
  const past = galleryView('bash', 600).rows[0]!
  expect(past.label.text).toBe('Check the client')
  expect(past.label.tense).toBe('past')
  const batch = galleryView('commands', 600).rows[0]!
  expect(batch.label.text).toBe('Ran 2 commands')
  expect(batch.label.count).toBe(2)
})

test('approval and question waits own the now-line and project settled rows', () => {
  for (const [id, text] of [
    ['waiting', 'Waiting for approval'],
    ['question', 'Waiting for your answer'],
  ]) {
    const view = galleryView(id!, 600)
    expect(view.heading.text).toBe('Waiting for you')
    expect(view.now?.text).toBe(text)
    expect(view.cursor).toBe(`${view.id}:now`)
    expect(view.rows.every((row) => !row.live && !row.shimmer)).toBe(true)
    expect(view.rows.some((row) => row.kind === 'marker')).toBe(false)
  }
  for (const id of ['approved', 'answered']) {
    const view = galleryView(id, 600)
    expect(view.heading.text).toBe('Working')
    expect(view.rows.at(-1)?.kind).toBe('marker')
    expect(view.rows.at(-1)?.item?.id).toBe(id === 'approved' ? 'approval' : 'question')
  }
})

test('parallel rows are live only while their calls run or they own the cursor', () => {
  const parallel = galleryView('parallel', 600)
  expect(parallel.rows.map((row) => row.live)).toEqual([true, true])
  expect(parallel.rows.map((row) => row.shimmer)).toEqual([true, true])
  expect(parallel.cursor).toBe('cmd')
  for (const id of ['parallel', 'sequential']) {
    const view = galleryView(id, 1400)
    expect(view.rows.map((row) => row.live)).toEqual([false, true])
    expect(view.rows.map((row) => row.shimmer)).toEqual([false, true])
    expect(view.rows.map((row) => row.label.tense)).toEqual(['past', 'present'])
  }
})

test('settled requests appear once in order as work continues, excluding subagent requests', () => {
  const card = streamStates.find((card) => card.id === 'approved')!
  let state = emptyThread
  const events = [
    ...card.initial,
    ...card.events.map(({ event }) => event),
    decode({
      type: 'item.started',
      item: {
        id: 'bash',
        turnId: 'turn',
        createdAt: 20,
        kind: 'tool_call',
        toolName: 'Bash',
        input: { command: 'bun run lint' },
        output: '',
        status: 'running',
      },
    }),
  ]
  for (const [index, event] of events.entries())
    state = applyEvent(state, { seq: index + 1, ts: index, event })
  const rows = singleTurnRows(
    createThreadRows()(state.items, { status: state.status, running: true }).filter(
      (row) => row.kind !== 'marker'
    ),
    state.items
  )
  const works = rows.filter((row) => row.kind === 'work')
  expect(works).toHaveLength(1)
  const work = works[0]!
  const approval = state.items.find((item) => item.kind === 'approval')!
  const view = projectTurn({
    work,
    items: [...state.items, { ...approval, id: 'subagent', agentId: 'child' }],
    revealDone: false,
  })
  expect(view.rows.map((row) => row.id)).toEqual(['read', 'approval', 'bash'])
  expect(view.cursor).toBe('bash')
  expect(view.now).toBeNull()
})

test('thinking supports unknown and singular counts and Bash failures retain descriptions', () => {
  const work = {
    kind: 'work' as const,
    id: 'work',
    turnId: 'turn',
    status: 'running' as const,
    activities: [
      { type: 'thinking' as const, id: 'thinking', status: 'running' as const, summary: '' },
    ],
  }
  expect(projectTurn({ work, revealDone: false }).rows[0]!.label.text).toBe('Thinking')
  expect(
    projectTurn({
      work: { ...work, activities: [{ ...work.activities[0]!, tokens: 1 }] },
      revealDone: false,
    }).rows[0]!.label.text
  ).toBe('Thinking for 1 token')
  const call = {
    type: 'tool' as const,
    id: 'bash',
    kind: 'terminal' as const,
    name: 'Bash',
    target: 'bun run lint',
    description: 'Check the client',
    status: 'failed' as const,
  }
  const row = projectTurn({ work: { ...work, activities: [call] }, revealDone: false }).rows[0]!
  expect(row.label.text).toBe('Failed Check the client')
  expect(row.label.failed).toBe(true)
  expect(row.label.mono).toBe(false)
})

test('empty thinking uses its own timestamps, ticks seconds, and freezes at completion', () => {
  const thinking = {
    type: 'thinking' as const,
    id: 'thinking',
    status: 'running' as const,
    summary: '',
    startedAt: 5000,
  }
  const work = {
    kind: 'work' as const,
    id: 'work',
    turnId: 'turn',
    status: 'running' as const,
    startedAt: 0,
    activities: [thinking],
  }
  for (const tokens of [undefined, 0]) {
    for (const [now, text, count] of [
      [5000, 'Thinking', undefined],
      [5999, 'Thinking', undefined],
      [6000, 'Thinking for 1s', 1],
      [7999, 'Thinking for 2s', 2],
    ] as const) {
      const row = projectTurn({
        work: { ...work, activities: [{ ...thinking, tokens }] },
        revealDone: false,
        now,
      }).rows[0]!
      expect(row.label.text).toBe(text)
      expect(row.label.count).toBe(count)
    }
    for (const [endedAt, text] of [
      [5999, 'Thought'],
      [7200, 'Thought for 2s'],
    ] as const) {
      const row = projectTurn({
        work: {
          ...work,
          activities: [{ ...thinking, status: 'complete', tokens, endedAt }],
        },
        revealDone: false,
        now: 20000,
      }).rows[0]!
      expect(row.label.text).toBe(text)
      expect(row.label.tense).toBe('past')
    }
  }
  const tokens = projectTurn({
    work: { ...work, activities: [{ ...thinking, tokens: 50 }] },
    revealDone: false,
    now: 20000,
  }).rows[0]!
  expect(tokens.label.text).toBe('Thinking for 50 tokens')
})
