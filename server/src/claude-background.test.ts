import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import { backgroundStatus } from '@jetty/shared/wire'
import { expect, test } from 'bun:test'

import { createBackgroundTasks } from './claude-background'
import { createHub } from './hub'

test('the SDK level signal wins over reordered edges and excludes ambient and agent work from Monitoring', () => {
  const tracker = createBackgroundTasks()
  function send(message: object) {
    tracker.ingest(message as SDKMessage)
  }
  send({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'shell', task_type: 'local_bash', description: 'shell' },
      { task_id: 'agent', task_type: 'local_agent', description: 'agent' },
      { task_id: 'workflow', task_type: 'local_workflow', description: 'workflow' },
      { task_id: 'ambient', task_type: 'monitor', description: 'ambient', ambient: true },
    ],
  })
  const startedAt = tracker.tasks()[0]!.startedAt
  send({ type: 'system', subtype: 'task_progress', task_id: 'shell', description: 'Updated shell' })
  expect(tracker.tasks()).toEqual([{ id: 'shell', label: 'Updated shell', startedAt }])
  expect(tracker.live.size).toBe(3)
  send({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })
  send({
    type: 'system',
    subtype: 'task_started',
    task_id: 'shell',
    task_type: 'local_bash',
    description: 'Late start',
    is_backgrounded: true,
  })
  send({ type: 'system', subtype: 'task_progress', task_id: 'shell', description: 'Late progress' })
  expect(tracker.tasks()).toEqual([])
  expect(tracker.live.size).toBe(0)
})

test('Monitoring is an ephemeral chrome overlay and never overrides active work or approvals', () => {
  const tasks = [{ id: 'watch', label: 'Watch checks', startedAt: Date.now() }]
  for (const status of ['starting', 'running', 'awaiting_approval'] as const)
    expect(backgroundStatus(status, tasks)).toBe(status)
  expect(backgroundStatus('idle', tasks)).toBe('monitoring')
  expect(backgroundStatus('idle', [])).toBe('idle')
  const hub = createHub()
  hub.setBackgroundTasks('thread', tasks)
  const meta = {
    id: 'thread',
    projectId: 'project',
    title: 'title',
    status: 'idle' as const,
    environment: 'local' as const,
    archived: false,
    pinned: false,
    updatedAt: 0,
  }
  expect(hub.decorateThread(meta).status).toBe('monitoring')
  expect(meta.status).toBe('idle')
  expect(createHub().decorateThread(meta).backgroundTasks).toEqual([])
  hub.setBackgroundTasks('thread', [])
  expect(hub.decorateThread(meta).status).toBe('idle')
})
