import type { ThreadEvent } from '@jetty/shared/events'

import { loadRecording, type StreamInput, type StreamRecording } from './engine'

const turnId = 'synthetic-turn'
const itemId = 'synthetic-answer'

function fixture(
  id: string,
  title: string,
  durationMs: number,
  capture: StreamRecording['capture'],
  events: readonly (readonly [number, StreamInput['event']])[]
): StreamRecording {
  return loadRecording({
    id,
    title,
    fidelity: 'synthetic',
    durationMs,
    capture,
    inputs: events.map(([atMs, event], index) => ({ seq: index + 1, atMs, event })),
  })
}

const start: readonly (readonly [number, ThreadEvent])[] = [
  [100, { type: 'turn.started', turnId }],
  [
    100,
    {
      type: 'item.started',
      item: {
        id: itemId,
        turnId,
        createdAt: 100,
        kind: 'assistant_message',
        text: '',
        streaming: true,
      },
    },
  ],
]

const prefix: readonly (readonly [number, ThreadEvent])[] = [
  ...start,
  [350, { type: 'item.delta', itemId, delta: 'A synthetic answer with **unfinished' }],
  [700, { type: 'item.delta', itemId, delta: ' emphasis** and [a link](https://example.' }],
  [1050, { type: 'item.delta', itemId, delta: 'com).\n\n```ts\nconst count = 2' }],
]

export const recordings = [
  fixture('complete', 'Complete run', 2100, 'complete', [
    ...prefix,
    [1400, { type: 'item.delta', itemId, delta: '\n```\n\nSee [the guide][guide].' }],
    [1700, { type: 'item.delta', itemId, delta: '\n\n[guide]: https://example.com/guide' }],
    [1900, { type: 'item.completed', itemId, patch: { streaming: false } }],
    [1900, { type: 'turn.completed', turnId }],
  ]),
  fixture('interrupted', 'Interrupted prefix', 1600, 'complete', [
    ...prefix,
    [1400, { type: 'local.turn.interrupted', turnId }],
  ]),
  fixture('missing', 'Missing capture', 1400, 'incomplete', prefix),
  fixture('correction', 'Final correction', 2100, 'complete', [
    ...prefix,
    [
      1400,
      {
        type: 'item.completed',
        itemId,
        patch: {
          text: 'Corrected answer: **three** items, not two.\n\nSee [the guide][guide].\n\n[guide]: https://example.com/guide',
          streaming: false,
        },
      },
    ],
    [1400, { type: 'turn.completed', turnId }],
  ]),
]
