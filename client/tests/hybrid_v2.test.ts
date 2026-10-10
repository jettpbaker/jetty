import { ThreadEvent } from '@jetty/shared/events'
import { applyEvent, emptyThread } from '@jetty/shared/reducer'
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'

import { projectTurn, type TurnView } from '../src/components/custom/hybrid_v2/projection'
import { createThreadRows, singleTurnRows } from '../src/components/custom/thread_rows'

const decode = Schema.decodeUnknownSync(ThreadEvent)

for (const name of ['one-turn', 'two-turns', 'opus-real']) {
  describe(name, () => {
    test('projects each event with one cursor, truthful tense, sealed batches and counts', async () => {
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
          expect(
            view.rows.filter((row) => row.live).length + Number(view.now !== null)
          ).toBeLessThanOrEqual(1)
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
            if (read && view.rows.some((row) => row.label.text === 'Thinking')) {
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
    expect(view.rows.map((row) => row.live)).toEqual([false, true])
    expect(view.rows.map((row) => row.label.tense)).toEqual(['present', 'present'])
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
