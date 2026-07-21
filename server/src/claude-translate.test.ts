import type { ThreadEvent } from '@jetty/shared/events'

import { describe, expect, test } from 'bun:test'

import { createTranslateCtx, translate, type SdkLikeMessage } from './claude-translate'

function startedItemId(events: ThreadEvent[]): string {
  const ev = events[0]
  if (!ev || ev.type !== 'item.started') throw new Error('expected item.started')
  return ev.item.id
}

describe('translate()', () => {
  test('init captures session id', () => {
    const ctx = createTranslateCtx('t1')
    const events = translate(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-abc',
      },
      ctx
    )
    expect(events).toEqual([])
    expect(ctx.sessionId).toBe('sess-abc')
  })

  test('subagent-internal messages (parent_tool_use_id) are dropped', () => {
    const ctx = createTranslateCtx('t1')
    const inner: SdkLikeMessage = {
      type: 'stream_event',
      parent_tool_use_id: 'toolu_agent_1',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
    }
    expect(translate(inner, ctx)).toEqual([])
    expect(ctx.currentAssistantId).toBeNull()

    const innerAssistant: SdkLikeMessage = {
      type: 'assistant',
      parent_tool_use_id: 'toolu_agent_1',
      message: { content: [{ type: 'text', text: 'subagent text' }] },
    }
    expect(translate(innerAssistant, ctx)).toEqual([])
  })

  test('streaming text via stream_event deltas', () => {
    const ctx = createTranslateCtx('t1')
    const start = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      },
      ctx
    )
    expect(start).toHaveLength(1)
    expect(start[0]).toMatchObject({
      type: 'item.started',
      item: { kind: 'assistant_message', turnId: 't1', text: '' },
    })
    const itemId = startedItemId(start)

    const delta = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
      },
      ctx
    )
    expect(delta).toEqual([{ type: 'item.delta', itemId, delta: 'Hello' }])

    const more = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' world' },
        },
      },
      ctx
    )
    expect(more).toEqual([{ type: 'item.delta', itemId, delta: ' world' }])

    const stop = translate(
      {
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      },
      ctx
    )
    expect(stop).toEqual([{ type: 'item.completed', itemId }])

    // Final complete assistant must not duplicate the item
    const final = translate(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello world' }],
        },
      },
      ctx
    )
    expect(final).toEqual([])
  })

  test('thinking → reasoning item', () => {
    const ctx = createTranslateCtx('t1')
    const start = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      ctx
    )
    expect(start[0]).toMatchObject({
      type: 'item.started',
      item: { kind: 'reasoning', text: '' },
    })
    const itemId = startedItemId(start)

    const delta = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'pondering…' },
        },
      },
      ctx
    )
    expect(delta).toEqual([{ type: 'item.delta', itemId, delta: 'pondering…' }])

    const stop = translate(
      {
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      },
      ctx
    )
    expect(stop).toEqual([{ type: 'item.completed', itemId }])
  })

  test('thinking_delta estimated_tokens → tokens on the delta event', () => {
    const ctx = createTranslateCtx('t1')
    const start = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      },
      ctx
    )
    const itemId = startedItemId(start)

    const delta = translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 50 },
        },
      },
      ctx
    )
    expect(delta).toEqual([{ type: 'item.delta', itemId, delta: '', tokens: 50 }])
  })

  test('tool_use → tool_call started with input once complete', () => {
    const ctx = createTranslateCtx('t1')
    translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} },
        },
      },
      ctx
    )
    // empty start shouldn't emit yet
    expect(ctx.toolUseToItemId.size).toBe(0)

    translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"command":' },
        },
      },
      ctx
    )
    translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"ls"}' },
        },
      },
      ctx
    )

    const stop = translate(
      {
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 1 },
      },
      ctx
    )
    expect(stop).toHaveLength(1)
    expect(stop[0]).toMatchObject({
      type: 'item.started',
      item: {
        kind: 'tool_call',
        toolName: 'Bash',
        input: { command: 'ls' },
        output: '',
        status: 'running',
      },
    })
    expect(ctx.toolUseToItemId.get('tu_1')).toBeTruthy()
  })

  test('tool_result → item.delta output + item.completed with status', () => {
    const ctx = createTranslateCtx('t1')
    translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tu_9',
            name: 'Read',
          },
        },
      },
      ctx
    )
    translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' },
        },
      },
      ctx
    )
    const started = translate(
      {
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      },
      ctx
    )
    const itemId = startedItemId(started)

    const result = translate(
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_9',
              content: 'file contents',
              is_error: false,
            },
          ],
        },
      },
      ctx
    )
    expect(result).toEqual([
      { type: 'item.delta', itemId, delta: 'file contents' },
      { type: 'item.completed', itemId, patch: { status: 'succeeded' } },
    ])
  })

  test('result success → turn.completed with usage and costUsd', () => {
    const ctx = createTranslateCtx('t1')
    const events = translate(
      {
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 12, output_tokens: 34 },
        total_cost_usd: 0.0042,
      },
      ctx
    )
    expect(events).toEqual([
      {
        type: 'turn.completed',
        turnId: 't1',
        usage: { inputTokens: 12, outputTokens: 34 },
        costUsd: 0.0042,
      },
    ])
  })

  test('result error → turn.failed', () => {
    const ctx = createTranslateCtx('t1')
    const events = translate(
      {
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['boom', 'also'],
      } as SdkLikeMessage,
      ctx
    )
    expect(events).toEqual([{ type: 'turn.failed', turnId: 't1', error: 'boom; also' }])
  })

  test('tool_result with is_error → failed status', () => {
    const ctx = createTranslateCtx('t1')
    translate(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu_e', name: 'Bash', input: {} },
        },
      },
      ctx
    )
    const started = translate(
      {
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      },
      ctx
    )
    const itemId = startedItemId(started)

    const result = translate(
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_e',
              content: 'denied',
              is_error: true,
            },
          ],
        },
      },
      ctx
    )
    expect(result).toContainEqual({
      type: 'item.completed',
      itemId,
      patch: { status: 'failed' },
    })
  })
})
