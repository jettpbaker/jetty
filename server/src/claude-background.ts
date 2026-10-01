import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BackgroundTask } from '@jetty/shared/wire'

const monitorTypes = new Set(['monitor', 'monitor_mcp', 'local_bash', 'shell'])
const terminalStatuses = new Set(['completed', 'failed', 'killed', 'paused'])

type Task = BackgroundTask & { taskType: string; command?: string; ambient?: boolean }

export function createBackgroundTasks() {
  const live = new Set<string>()
  const metadata = new Map<string, Task>()
  const commands = new Map<string, string>()
  // Level snapshots own membership; lifecycle bookends can arrive in either order.
  let hasSnapshot = false

  function record(
    id: string,
    taskType: string,
    description: string,
    command?: string,
    ambient = false
  ) {
    const previous = metadata.get(id)
    metadata.set(id, {
      id,
      taskType,
      label: command ?? previous?.command ?? description,
      startedAt: previous?.startedAt ?? Date.now(),
      command: command ?? previous?.command,
      ambient: ambient || previous?.ambient,
    })
  }

  function ingest(message: SDKMessage) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type !== 'tool_use' || block.name !== 'Bash') continue
        const input = block.input as { command?: unknown }
        if (typeof input.command === 'string') commands.set(block.id, input.command)
      }
    }
    if (message.type === 'user') {
      const content = message.message.content
      if (Array.isArray(content))
        for (const block of content)
          if (block.type === 'tool_result') commands.delete(block.tool_use_id)
    }
    if (message.type !== 'system') return
    switch (message.subtype) {
      case 'background_tasks_changed':
        hasSnapshot = true
        const previousLive = new Set(live)
        live.clear()
        for (const task of message.tasks) {
          if (task.ambient) continue
          live.add(task.task_id)
          record(task.task_id, task.task_type, task.description)
        }
        for (const id of previousLive) if (!live.has(id)) metadata.delete(id)
        break
      case 'task_started': {
        const command = message.tool_use_id ? commands.get(message.tool_use_id) : undefined
        if (message.tool_use_id) commands.delete(message.tool_use_id)
        record(
          message.task_id,
          message.task_type ?? '',
          message.description,
          command,
          message.ambient || message.skip_transcript
        )
        if (
          !hasSnapshot &&
          !message.ambient &&
          !message.skip_transcript &&
          message.is_backgrounded !== false
        )
          live.add(message.task_id)
        break
      }
      case 'task_progress': {
        const task = metadata.get(message.task_id)
        if (task && live.has(task.id)) record(task.id, task.taskType, message.description)
        break
      }
      case 'task_updated': {
        const task = metadata.get(message.task_id)
        if (task && message.patch.description)
          record(task.id, task.taskType, message.patch.description)
        if (message.patch.status && terminalStatuses.has(message.patch.status)) {
          live.delete(message.task_id)
          metadata.delete(message.task_id)
        } else if (!hasSnapshot && task && !task.ambient && message.patch.is_backgrounded)
          live.add(task.id)
        break
      }
      case 'task_notification':
        live.delete(message.task_id)
        metadata.delete(message.task_id)
        break
    }
  }

  function tasks(): BackgroundTask[] {
    return [...live].flatMap((id) => {
      const task = metadata.get(id)
      return task && monitorTypes.has(task.taskType)
        ? [{ id: task.id, label: task.label, startedAt: task.startedAt }]
        : []
    })
  }

  return { live, ingest, tasks }
}
