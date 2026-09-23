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
  patterns: string[]
  scope?: string
  suggestions: readonly unknown[]
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

function describeRule(rule: Record<string, unknown>) {
  return typeof rule.ruleContent === 'string' ? rule.ruleContent : String(rule.toolName ?? '')
}

// Claude's permission suggestions are what "Allow always" would add.
function suggestedPatterns(suggestions: readonly unknown[]) {
  const patterns: string[] = []
  let destination: string | undefined
  for (const suggestion of suggestions.map(record)) {
    destination ??= typeof suggestion.destination === 'string' ? suggestion.destination : undefined
    if (Array.isArray(suggestion.rules))
      patterns.push(...suggestion.rules.map(record).map(describeRule))
    else if (Array.isArray(suggestion.directories))
      patterns.push(...suggestion.directories.filter((dir) => typeof dir === 'string'))
    else if (typeof suggestion.mode === 'string') patterns.push(suggestion.mode)
  }
  return { patterns: patterns.filter(Boolean), destination }
}

function scopeLabel(destination: string | undefined, projectTitle: string | undefined) {
  if (destination === 'session') return 'this session'
  if (destination === 'userSettings') return 'every project'
  return projectTitle
}

export function approvalView(
  item: ApprovalItem,
  projectPath: string | undefined,
  projectTitle?: string
) {
  const input = record(item.input)
  const name = item.toolName.toLowerCase()
  const shell = command(input)
  const { patterns, destination } = suggestedPatterns(item.suggestions)
  const base = { patterns, scope: scopeLabel(destination, projectTitle) }
  if (runTools.has(name) || (shell && !editTools.has(name))) {
    const cwd = typeof input.cwd === 'string' ? input.cwd : projectPath
    return { ...base, action: 'Run', run: true, target: shell || item.title, detail: cwd }
  }
  if (editTools.has(name)) {
    const path = input.file_path ?? input.notebook_path ?? input.path
    return {
      ...base,
      action: 'Edit',
      run: false,
      target: typeof path === 'string' ? projectRelative(path, projectPath) : item.title,
      detail: editDetail(input),
    }
  }
  const target = toolTarget(item.toolName, item.input, projectPath)
  return {
    ...base,
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
        suggestions: item.suggestions,
        ...approvalView(item, projectPath, projectTitle),
      })
    else if (item.kind === 'question')
      pending.push({ id: item.id, kind: 'question', source, questions: [...item.questions] })
  }
  return pending
}

// The main agent's latest task list in the current turn: Claude's TodoWrite or Codex's plan.
export function currentTodos(items: readonly ThreadItem[]): Todo[] {
  const turnId = items.at(-1)?.turnId
  const call = items.findLast(
    (item) =>
      item.kind === 'tool_call' &&
      !item.agentId &&
      item.turnId === turnId &&
      todoTools.has(item.toolName)
  )
  if (call?.kind !== 'tool_call') return []
  const todos = record(call.input).todos
  if (!Array.isArray(todos)) return []
  return todos.map(record).map((todo, index) => ({
    id: String(index),
    text: String(todo.content ?? ''),
    status:
      todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : 'pending',
  }))
}
