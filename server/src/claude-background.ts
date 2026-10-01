import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { BackgroundTask } from '@jetty/shared/wire'

// Background shells and Monitor watches. Agents and workflows read as Working through their items.
const monitorTypes = new Set(['local_bash', 'monitor_mcp', 'monitor_ws'])

type Entry = { id: string; description: string; startedAt: number }

export type BackgroundTasks = ReturnType<typeof createBackgroundTasks>

export function createBackgroundTasks() {
  // Membership follows the SDK's background_tasks_changed level signal (replace semantics).
  let entries: Entry[] = []
  // A shell is labelled by its command: Bash tool_use id → command until the task starts, then task id → command.
  const commands = new Map<string, string>()
  const shells = new Map<string, string>()

  function tasks(): BackgroundTask[] {
    return entries.map(({ id, description, startedAt }) => ({
      id,
      label: shells.get(id) ?? description,
      startedAt,
    }))
  }

  // Returns whether the reported tasks changed.
  function ingest(message: SDKMessage): boolean {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type !== 'tool_use' || block.name !== 'Bash') continue
        const { command } = block.input as { command?: string }
        if (command) commands.set(block.id, command)
      }
      return false
    }
    if (message.type === 'result') {
      commands.clear()
      return false
    }
    if (message.type !== 'system') return false
    if (message.subtype === 'task_started') {
      const command = message.tool_use_id ? commands.get(message.tool_use_id) : undefined
      if (!command) return false
      shells.set(message.task_id, command)
      return entries.some((entry) => entry.id === message.task_id)
    }
    if (message.subtype !== 'background_tasks_changed') return false
    const known = new Map(entries.map((entry) => [entry.id, entry]))
    entries = message.tasks
      .filter((task) => !task.ambient && monitorTypes.has(task.task_type))
      .map(
        (task) =>
          known.get(task.task_id) ?? {
            id: task.task_id,
            description: task.description,
            startedAt: Date.now(),
          }
      )
    for (const id of shells.keys())
      if (!message.tasks.some((task) => task.task_id === id)) shells.delete(id)
    return true
  }

  function remove(id: string) {
    entries = entries.filter((entry) => entry.id !== id)
  }

  function clear() {
    entries = []
  }

  return { ingest, tasks, remove, clear }
}
