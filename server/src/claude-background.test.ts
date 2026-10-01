import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import { expect, test } from 'bun:test'

import { createBackgroundTasks } from './claude-background'

test('membership follows the level signal; shells are labelled by their command', () => {
  const tracker = createBackgroundTasks()
  const send = (message: object) => tracker.ingest(message as SDKMessage)
  send({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'tool', name: 'Bash', input: { command: 'sleep 20' } }],
    },
  })
  expect(
    send({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'shell', task_type: 'local_bash', description: 'Wait' },
        { task_id: 'watch', task_type: 'monitor_mcp', description: 'Watch checks' },
        { task_id: 'agent', task_type: 'local_agent', description: 'agent' },
        { task_id: 'ambient', task_type: 'monitor_ws', description: 'ambient', ambient: true },
      ],
    })
  ).toBe(true)
  expect(tracker.tasks().map((task) => task.label)).toEqual(['Wait', 'Watch checks'])
  expect(
    send({ type: 'system', subtype: 'task_started', task_id: 'shell', tool_use_id: 'tool' })
  ).toBe(true)
  const startedAt = tracker.tasks()[0]!.startedAt
  expect(tracker.tasks()[0]).toEqual({ id: 'shell', label: 'sleep 20', startedAt })
  expect(send({ type: 'system', subtype: 'task_notification', task_id: 'shell' })).toBe(false)
  expect(tracker.tasks()).toHaveLength(2)
  send({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'shell', task_type: 'local_bash', description: 'Wait' }],
  })
  expect(tracker.tasks()).toEqual([{ id: 'shell', label: 'sleep 20', startedAt }])
})
