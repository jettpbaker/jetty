import { describe, expect, test } from 'bun:test'
import { Result, Schema } from 'effect'

import { ContextUsage, SequencedEvent, ThreadEvent, Usage as TokenUsage } from './events'
import { Attachment, MAX_GALLERY_IMAGES, QuestionSpec, ThreadItem } from './items'
import { applyEvent, emptyThread, ThreadState } from './reducer'
import { MAX_IMAGES_PER_TURN, methods, ThreadGitStatus, UsageWindow } from './wire'

const attachment = { id: 'a', name: 'image.png', mimeType: 'image/png', sizeBytes: 0 }
const itemBase = { id: 'item', turnId: 'turn', createdAt: 0 }
const reasoning = { ...itemBase, kind: 'reasoning', text: '' } satisfies ThreadItem
const context = { usedTokens: 0, maxTokens: 1, slices: [], asOf: 0 }

describe('domain schema constraints', () => {
  test.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid natural number %s',
    (value) => {
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(Attachment)({ ...attachment, sizeBytes: value })
        )
      ).toBe(true)
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(TokenUsage)({ inputTokens: value, outputTokens: 0 })
        )
      ).toBe(true)
      expect(
        Result.isFailure(Schema.decodeUnknownResult(ThreadItem)({ ...reasoning, tokens: value }))
      ).toBe(true)
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(ThreadState)({ ...emptyThread, lastSeq: value })
        )
      ).toBe(true)
    }
  )

  test('accepts zero and safe integer boundaries without coercion', () => {
    expect(Schema.decodeUnknownSync(Attachment)(attachment)).toEqual(attachment)
    expect(
      Schema.decodeUnknownSync(Attachment)({ ...attachment, sizeBytes: Number.MAX_SAFE_INTEGER })
        .sizeBytes
    ).toBe(Number.MAX_SAFE_INTEGER)
    expect(Schema.decodeUnknownSync(ThreadItem)({ ...reasoning, createdAt: -1 }).createdAt).toBe(-1)
    expect(
      Result.isFailure(Schema.decodeUnknownResult(Attachment)({ ...attachment, sizeBytes: '0' }))
    ).toBe(true)
    expect(
      Result.isFailure(Schema.decodeUnknownResult(ThreadItem)({ ...reasoning, createdAt: 0.5 }))
    ).toBe(true)
  })

  test('requires positive sequence numbers, context limits, and PR numbers', () => {
    expect(Schema.decodeUnknownSync(ContextUsage)(context)).toEqual(context)
    for (const value of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        Result.isFailure(Schema.decodeUnknownResult(ContextUsage)({ ...context, maxTokens: value }))
      ).toBe(true)
      expect(
        Result.isFailure(Schema.decodeUnknownResult(ContextUsage)({ ...context, compactAt: value }))
      ).toBe(true)
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(SequencedEvent)({
            seq: value,
            ts: 0,
            event: { type: 'turn.started', turnId: 'turn' },
          })
        )
      ).toBe(true)
    }
    expect(Schema.decodeUnknownSync(ThreadGitStatus)({ branch: 'main', dirty: false })).toEqual({
      branch: 'main',
      dirty: false,
    })
  })

  test('keeps finite decimal usage values without imposing new percentage bounds', () => {
    expect(Schema.decodeUnknownSync(UsageWindow)({ pct: 101.5, resetsAt: -0.5 })).toEqual({
      pct: 101.5,
      resetsAt: -0.5,
    })
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(
        Result.isFailure(Schema.decodeUnknownResult(UsageWindow)({ pct: value, resetsAt: 0 }))
      ).toBe(true)
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(ThreadEvent)({
            type: 'turn.completed',
            turnId: 'turn',
            costUsd: value,
          })
        )
      ).toBe(true)
    }
  })

  test('enforces gallery bounds', () => {
    const decode = Schema.decodeUnknownResult(ThreadItem)
    for (const count of [1, MAX_GALLERY_IMAGES]) {
      expect(
        Result.isSuccess(
          decode({ ...itemBase, kind: 'image_gallery', images: Array(count).fill(attachment) })
        )
      ).toBe(true)
    }
    for (const count of [0, MAX_GALLERY_IMAGES + 1]) {
      expect(
        Result.isFailure(
          decode({ ...itemBase, kind: 'image_gallery', images: Array(count).fill(attachment) })
        )
      ).toBe(true)
    }
  })

  test('preserves absent and explicitly undefined optional fields', () => {
    const decode = Schema.decodeUnknownSync(ThreadItem)
    expect(decode(reasoning)).toEqual(reasoning)
    expect(decode({ ...reasoning, streaming: undefined, tokens: undefined })).toEqual({
      ...reasoning,
      streaming: undefined,
      tokens: undefined,
    })
    expect(
      Result.isFailure(Schema.decodeUnknownResult(ThreadItem)({ ...reasoning, tokens: null }))
    ).toBe(true)
    const question = { ...itemBase, kind: 'question', questions: [] } satisfies ThreadItem
    expect(decode(question)).toEqual(question)
    expect(decode({ ...question, answers: { why: 'because' }, skipped: true })).toEqual({
      ...question,
      answers: { why: 'because' },
      skipped: true,
    })
    expect(
      Result.isFailure(Schema.decodeUnknownResult(ThreadItem)({ ...question, answers: { why: 1 } }))
    ).toBe(true)
  })

  test('validates question option fields and discriminants', () => {
    const question = {
      question: 'Which?',
      header: 'Choice',
      multiSelect: false,
      options: [{ label: 'One', description: '' }],
    }
    expect(Schema.decodeUnknownSync(QuestionSpec)(question)).toEqual(question)
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(QuestionSpec)({ ...question, options: [{ label: 'One' }] })
      )
    ).toBe(true)
    expect(
      Result.isFailure(Schema.decodeUnknownResult(ThreadItem)({ ...reasoning, kind: 'unknown' }))
    ).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(ThreadEvent)({ type: 'unknown' }))).toBe(
      true
    )
  })

  test('defaults missing or undefined context but rejects malformed context', () => {
    const { context: _, ...legacy } = emptyThread
    const decode = Schema.decodeUnknownSync(ThreadState)
    expect(decode(legacy)).toEqual(emptyThread)
    expect(decode({ ...legacy, context: undefined })).toEqual(emptyThread)
    expect(decode({ ...legacy, context: null })).toEqual(emptyThread)
    expect(decode({ ...legacy, context }).context).toEqual(context)
    expect(
      Result.isFailure(Schema.decodeUnknownResult(ThreadState)({ ...legacy, context: {} }))
    ).toBe(true)
  })
})

describe('wire schema decoding', () => {
  test('empty subscribe params still require an object and discard extra keys', () => {
    const decode = Schema.decodeUnknownResult(methods['chrome.subscribe'].params)
    expect(Schema.decodeUnknownSync(methods['chrome.subscribe'].params)({ ignored: true })).toEqual(
      {}
    )
    for (const value of [undefined, null, [], 1, 'params', true]) {
      expect(Result.isFailure(decode(value))).toBe(true)
    }
  })

  test('enforces search limits, nonempty thread ids, and optional replay cursors', () => {
    const search = { projectId: 'project', query: '' }
    for (const limit of [undefined, 1, 100]) {
      expect(
        Result.isSuccess(
          Schema.decodeUnknownResult(methods['fs.search'].params)({ ...search, limit })
        )
      ).toBe(true)
    }
    for (const limit of [0, 101, 0.5]) {
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(methods['fs.search'].params)({ ...search, limit })
        )
      ).toBe(true)
    }
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(methods['thread.create'].params)({
          id: '',
          projectId: 'project',
        })
      )
    ).toBe(true)
    expect(
      Schema.decodeUnknownSync(methods['thread.subscribe'].params)({
        threadId: 'thread',
        afterSeq: 0,
      }).afterSeq
    ).toBe(0)
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(methods['thread.subscribe'].params)({
          threadId: 'thread',
          afterSeq: -1,
        })
      )
    ).toBe(true)
  })

  test('validates turn attachment counts, MIME types, and enum options', () => {
    const decode = Schema.decodeUnknownResult(methods['turn.start'].params)
    const params = { threadId: 'thread', text: '' }
    const upload = { name: 'image.png', mimeType: 'image/png', dataUrl: '' }
    expect(Result.isSuccess(decode(params))).toBe(true)
    expect(Result.isSuccess(decode({ ...params, attachments: [] }))).toBe(true)
    expect(
      Result.isSuccess(
        decode({
          ...params,
          attachments: Array(MAX_IMAGES_PER_TURN).fill(upload),
          effort: 'xhigh',
          permissionMode: 'full_access',
        })
      )
    ).toBe(true)
    expect(
      Result.isFailure(
        decode({ ...params, attachments: Array(MAX_IMAGES_PER_TURN + 1).fill(upload) })
      )
    ).toBe(true)
    expect(
      Result.isFailure(decode({ ...params, attachments: [{ ...upload, mimeType: 'video/mp4' }] }))
    ).toBe(true)
    expect(Result.isFailure(decode({ ...params, effort: 'extreme' }))).toBe(true)
    expect(Result.isFailure(decode({ ...params, permissionMode: 'unknown' }))).toBe(true)
    expect(Result.isFailure(decode({ ...params, permissionMode: 'plan' }))).toBe(true)
    expect(Result.isSuccess(decode({ ...params, provider: 'grok', model: 'grok-4.7' }))).toBe(true)
    expect(Result.isFailure(decode({ ...params, provider: 'echo' }))).toBe(true)
    expect(Result.isFailure(decode({ ...params, provider: 'openai' }))).toBe(true)
  })
})

describe('item completion patch decoding', () => {
  test('preserves arbitrary patch fields until merged item validation', () => {
    const item = Schema.decodeUnknownSync(ThreadItem)({ ...reasoning, streaming: true })
    const state = { ...emptyThread, items: [item] }
    const event = Schema.decodeUnknownSync(SequencedEvent)({
      seq: 1,
      ts: 0,
      event: {
        type: 'item.completed',
        itemId: item.id,
        patch: { text: 'done', tokens: 2, ignored: { nested: true } },
      },
    })
    expect(event.event).toEqual({
      type: 'item.completed',
      itemId: item.id,
      patch: { text: 'done', tokens: 2, ignored: { nested: true } },
    })
    expect(applyEvent(state, event).items).toEqual([
      { ...reasoning, text: 'done', tokens: 2, streaming: false, completedAt: 0 },
    ])
    expect(state.items).toEqual([item])
  })

  test('allows omitted patches but rejects non-record patches and invalid merged items', () => {
    const decode = Schema.decodeUnknownSync(ThreadEvent)
    const completion = { type: 'item.completed', itemId: itemBase.id } satisfies ThreadEvent
    expect(decode(completion)).toEqual(completion)
    expect(decode({ ...completion, patch: undefined })).toEqual({ ...completion, patch: undefined })
    for (const patch of [null, [], 'patch']) {
      expect(
        Result.isFailure(Schema.decodeUnknownResult(ThreadEvent)({ ...completion, patch }))
      ).toBe(true)
    }
    const item = Schema.decodeUnknownSync(ThreadItem)(reasoning)
    const event = decode({ ...completion, patch: { tokens: -1 } })
    expect(() => applyEvent({ ...emptyThread, items: [item] }, { seq: 1, ts: 0, event })).toThrow()
  })
})
