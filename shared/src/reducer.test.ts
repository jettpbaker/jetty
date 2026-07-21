import { describe, expect, test } from 'bun:test'

import type { ThreadEvent } from './events'
import type { ThreadItem } from './items'

import { applyEvent, emptyThread, type ThreadState } from './reducer'

function run(events: ThreadEvent[], from: ThreadState = emptyThread): ThreadState {
  return events.reduce(
    (state, event, i) => applyEvent(state, { seq: from.lastSeq + i + 1, ts: 0, event }),
    from
  )
}

const assistant = (id: string) =>
  ({
    id,
    turnId: 't1',
    createdAt: 0,
    kind: 'assistant_message',
    text: '',
  }) satisfies ThreadItem

describe('applyEvent', () => {
  test('streams assistant text across deltas', () => {
    const state = run([
      { type: 'turn.started', turnId: 't1' },
      { type: 'item.started', item: assistant('a1') },
      { type: 'item.delta', itemId: 'a1', delta: 'Hello' },
      { type: 'item.delta', itemId: 'a1', delta: ', world' },
      { type: 'turn.completed', turnId: 't1' },
    ])
    expect(state.items).toEqual([{ ...assistant('a1'), text: 'Hello, world' }])
    expect(state.status).toBe('idle')
    expect(state.activeTurnId).toBeNull()
    expect(state.lastSeq).toBe(5)
  })

  test('sums reasoning token increments across deltas', () => {
    const reasoning = {
      id: 'r1',
      turnId: 't1',
      createdAt: 0,
      kind: 'reasoning',
      text: '',
    } satisfies ThreadItem
    const state = run([
      { type: 'item.started', item: reasoning },
      { type: 'item.delta', itemId: 'r1', delta: '', tokens: 50 },
      { type: 'item.delta', itemId: 'r1', delta: '' },
      { type: 'item.delta', itemId: 'r1', delta: '', tokens: 200 },
    ])
    expect(state.items).toEqual([{ ...reasoning, tokens: 250 }])
  })

  test('ignores events at or below lastSeq', () => {
    const state = run([
      { type: 'item.started', item: assistant('a1') },
      { type: 'item.delta', itemId: 'a1', delta: 'once' },
    ])
    const replayed = applyEvent(state, {
      seq: 2,
      ts: 0,
      event: { type: 'item.delta', itemId: 'a1', delta: 'once' },
    })
    expect(replayed).toBe(state)
  })

  test('tool call streams output and completes via patch', () => {
    const tool = {
      id: 'c1',
      turnId: 't1',
      createdAt: 0,
      kind: 'tool_call',
      toolName: 'Bash',
      input: { command: 'ls' },
      output: '',
      status: 'running',
    } satisfies ThreadItem
    const state = run([
      { type: 'item.started', item: tool },
      { type: 'item.delta', itemId: 'c1', delta: 'README.md\n' },
      { type: 'item.completed', itemId: 'c1', patch: { status: 'succeeded' } },
    ])
    expect(state.items[0]).toEqual({ ...tool, output: 'README.md\n', status: 'succeeded' })
  })

  test('approval resolves via patch', () => {
    const approval = {
      id: 'p1',
      turnId: 't1',
      createdAt: 0,
      kind: 'approval',
      title: 'Claude wants to run rm -rf dist',
      toolName: 'Bash',
      input: { command: 'rm -rf dist' },
      suggestions: [],
    } satisfies ThreadItem
    const state = run([
      { type: 'item.started', item: approval },
      { type: 'session.status', status: 'awaiting_approval' },
      { type: 'item.completed', itemId: 'p1', patch: { decision: 'allow' } },
      { type: 'session.status', status: 'running' },
    ])
    expect(state.items[0]).toEqual({ ...approval, decision: 'allow' })
    expect(state.status).toBe('running')
  })

  test('item.completed settles a streaming item', () => {
    const state = run([
      { type: 'item.started', item: { ...assistant('a1'), streaming: true } },
      { type: 'item.delta', itemId: 'a1', delta: 'hi' },
      { type: 'item.completed', itemId: 'a1' },
    ])
    expect(state.items[0]).toEqual({ ...assistant('a1'), text: 'hi', streaming: false })
  })

  test('turn end settles items stranded mid-stream', () => {
    const state = run([
      { type: 'turn.started', turnId: 't1' },
      { type: 'item.started', item: { ...assistant('a1'), streaming: true } },
      { type: 'turn.failed', turnId: 't1', error: 'boom' },
    ])
    expect(state.items[0]).toEqual({ ...assistant('a1'), streaming: false })
  })

  test('turn.failed returns to idle', () => {
    const state = run([
      { type: 'turn.started', turnId: 't1' },
      { type: 'turn.failed', turnId: 't1', error: 'boom' },
    ])
    expect(state.status).toBe('idle')
    expect(state.activeTurnId).toBeNull()
  })

  test('delta for unknown item is a no-op', () => {
    const state = run([{ type: 'item.delta', itemId: 'ghost', delta: 'hi' }])
    expect(state.items).toEqual([])
    expect(state.lastSeq).toBe(1)
  })
})
