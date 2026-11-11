import { expect, test } from 'bun:test'

import { brakingRoom, pinnedScrollTop } from '../src/components/custom/thread_scroll'

test('a pin rests on the transcript when braking room is still below it', () => {
  const transcript = 4200
  const clientHeight = 800
  // The scrollport is still as tall as the work that just collapsed.
  const port = 9600
  const top = pinnedScrollTop(transcript, clientHeight)
  expect(top).toBe(3400)
  expect(brakingRoom(top, port, clientHeight)).toBe(true)
  expect(top).toBeLessThan(port - clientHeight)
})

test('no braking room when the scrollport ends with the transcript', () => {
  const clientHeight = 800
  const top = pinnedScrollTop(9600, clientHeight)
  expect(brakingRoom(top, 9600, clientHeight)).toBe(false)
})

test('a pin rests at the top when the transcript is shorter than the window', () => {
  expect(pinnedScrollTop(500, 800)).toBe(0)
})
