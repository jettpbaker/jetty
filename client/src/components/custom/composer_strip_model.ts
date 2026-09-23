import type { QuestionSpec, ThreadItem } from '@jetty/shared/items'

import { awaitsInput } from '@/state/thread_tab'

import { projectRelative, toolTarget } from './thread_rows'

export type ApprovalItem = Extract<ThreadItem, { kind: 'approval' }>
export type QuestionItem = Extract<ThreadItem, { kind: 'question' }>

export type Source = { kind: 'main' } | { kind: 'subagent'; title: string; provider: string }

export type Approval = {
  id: string
  kind: 'approval'
  source: Source
  action: string
  run: boolean
  target: string
  detail?: string
  // absent when the provider can't remember the choice
  always?: { patterns: readonly string[]; scope?: string }
}

export type Question = { id: string; kind: 'question'; source: Source; questions: QuestionSpec[] }

export type Pending = Approval | Question

export type Todo = { id: string; text: string; status: 'done' | 'active' | 'pending' }

const runTools = new Set(['bash', 'shell', 'commandexecution', 'execute'])
const editTools = new Set(['edit', 'multiedit', 'write', 'notebookedit', 'filechange'])
const todoTools = new Set(['TodoWrite', 'update_plan'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function lineCount(value: unknown) {
  return typeof value === 'string' && value ? value.split('\n').length : 0
}

function command(input: Record<string, unknown>) {
  const value = input.command
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join(' ')
  return typeof value === 'string' ? value : undefined
}

function editDetail(input: Record<string, unknown>) {
  const edits = Array.isArray(input.edits) ? input.edits.map(record) : [input]
  let added = lineCount(input.content)
  let removed = 0
  for (const edit of edits) {
    added += lineCount(edit.new_string)
    removed += lineCount(edit.old_string)
  }
  return added || removed ? `+${added} −${removed}` : undefined
}

function scopeLabel(scope: string | undefined, projectTitle: string | undefined) {
  if (scope === 'session') return 'this session'
  if (scope === 'user') return 'every project'
  return projectTitle
}

export function approvalView(
  item: ApprovalItem,
  projectPath: string | undefined,
  projectTitle?: string
) {
  const input = record(item.input)
  const view = viewOf(item, input, projectPath)
  const always = item.always && {
    patterns: item.always.patterns.length ? item.always.patterns : [view.target],
    scope: scopeLabel(item.always.scope, projectTitle),
  }
  return { ...view, always }
}

function viewOf(
  item: ApprovalItem,
  input: Record<string, unknown>,
  projectPath: string | undefined
): { action: string; run: boolean; target: string; detail?: string } {
  const name = item.toolName.toLowerCase()
  const shell = command(input)
  if (runTools.has(name) || (shell && !editTools.has(name))) {
    const cwd = typeof input.cwd === 'string' ? input.cwd : projectPath
    return { action: 'Run', run: true, target: shell || item.title, detail: cwd }
  }
  if (editTools.has(name)) {
    const path = input.file_path ?? input.notebook_path ?? input.path
    return {
      action: 'Edit',
      run: false,
      target: typeof path === 'string' ? projectRelative(path, projectPath) : item.title,
      detail: editDetail(input),
    }
  }
  const target = toolTarget(item.toolName, item.input, projectPath)
  return {
    action: item.toolName,
    run: false,
    target: target === item.toolName ? item.title : target,
  }
}

export function itemSource(
  item: ThreadItem,
  agentTitles: ReadonlyMap<string, string>,
  provider: string
): Source {
  const title = item.agentId && agentTitles.get(item.agentId)
  return title ? { kind: 'subagent', title, provider } : { kind: 'main' }
}

export function pendingItems(
  items: readonly ThreadItem[],
  {
    provider,
    projectPath,
    projectTitle,
  }: { provider: string; projectPath?: string; projectTitle?: string }
): Pending[] {
  const agentTitles = new Map<string, string>()
  for (const item of items) if (item.kind === 'subagent') agentTitles.set(item.id, item.title)
  const pending: Pending[] = []
  for (const item of items) {
    if (!awaitsInput(item)) continue
    const source = itemSource(item, agentTitles, provider)
    if (item.kind === 'approval')
      pending.push({
        id: item.id,
        kind: 'approval',
        source,
        ...approvalView(item, projectPath, projectTitle),
      })
    else if (item.kind === 'question')
      pending.push({ id: item.id, kind: 'question', source, questions: [...item.questions] })
  }
  return pending
}

function todoStatus(status: unknown): Todo['status'] {
  return status === 'completed' ? 'done' : status === 'in_progress' ? 'active' : 'pending'
}

// The main agent's task list: Claude's TaskCreate/TaskUpdate (or older TodoWrite) calls, or
// Codex's plan. A whole-list plan only counts in the turn that wrote it.
export function currentTodos(items: readonly ThreadItem[]): Todo[] {
  let todos: Todo[] = []
  let planTurn: string | undefined
  for (const item of items) {
    if (item.kind !== 'tool_call' || item.agentId) continue
    const input = record(item.input)
    if (todoTools.has(item.toolName)) {
      const list = Array.isArray(input.todos) ? input.todos.map(record) : []
      todos = list.map((todo, index) => ({
        id: String(index + 1),
        text: String(todo.content ?? ''),
        status: todoStatus(todo.status),
      }))
      planTurn = item.turnId
    } else if (item.toolName === 'TaskCreate') {
      const id = /#(\d+)/.exec(item.output)?.[1] ?? String(todos.length + 1)
      todos = [...todos, { id, text: String(input.subject ?? ''), status: 'pending' }]
      planTurn = undefined
    } else if (item.toolName === 'TaskUpdate') {
      const id = String(input.taskId ?? '')
      todos =
        input.status === 'deleted'
          ? todos.filter((todo) => todo.id !== id)
          : todos.map((todo) =>
              todo.id === id
                ? {
                    ...todo,
                    text: typeof input.subject === 'string' ? input.subject : todo.text,
                    status: input.status === undefined ? todo.status : todoStatus(input.status),
                  }
                : todo
            )
    }
  }
  return planTurn && planTurn !== items.at(-1)?.turnId ? [] : todos
}
