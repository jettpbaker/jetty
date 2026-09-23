import type { QuestionSpec, ThreadItem } from '@jetty/shared/items'

import { awaitsInput } from '@/state/thread_tab'

import { projectRelative, toolAction, toolTarget } from './thread_rows'

export type ApprovalItem = Extract<ThreadItem, { kind: 'approval' }>
export type QuestionItem = Extract<ThreadItem, { kind: 'question' }>
type ProposedChange = NonNullable<ApprovalItem['changes']>[number]

export type Source = { kind: 'main' } | { kind: 'subagent'; title: string; provider: string }

export type Approval = {
  id: string
  kind: 'approval'
  source: Source
  action: string
  run: boolean
  target: string
  detail?: string
  changes?: ProposedChanges
  // absent when the provider can't remember the choice
  always?: { patterns: readonly string[]; scope?: string }
}

export type ProposedFile = { path: string; added: number; removed: number }

// `patch` is one git-style patch covering every file; `numbered` is false when some edit is a
// fragment, whose line numbers mean nothing.
export type ProposedChanges = { files: ProposedFile[]; patch: string; numbered: boolean }

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

function diffLines(text: string) {
  const lines = text ? text.split('\n') : []
  if (lines.at(-1) === '') lines.pop()
  return lines
}

// Line diff by longest common subsequence. Edit fragments are small; past the cap the changed
// block just reads as a plain replacement.
function lineDiff(old: string[], next: string[]) {
  if (old.length * next.length > 250_000)
    return [...old.map((line) => `-${line}`), ...next.map((line) => `+${line}`)]
  const common = Array.from({ length: old.length + 1 }, () => new Uint32Array(next.length + 1))
  for (let i = old.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      common[i]![j] =
        old[i] === next[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!)
  const body: string[] = []
  let i = 0
  let j = 0
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) {
      body.push(` ${old[i++]}`)
      j++
    } else if (i < old.length && (j === next.length || common[i + 1]![j]! >= common[i]![j + 1]!))
      body.push(`-${old[i++]}`)
    else body.push(`+${next[j++]}`)
  }
  return body
}

// Each edit is one hunk; `at` keeps a file's hunks in order.
function editHunk(before: string, after: string, at: { old: number; new: number }) {
  const old = diffLines(before)
  const next = diffLines(after)
  let head = 0
  while (head < old.length && head < next.length && old[head] === next[head]) head++
  let tail = 0
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++
  const body = [
    ...old.slice(0, head).map((line) => ` ${line}`),
    ...lineDiff(old.slice(head, old.length - tail), next.slice(head, next.length - tail)),
    ...old.slice(old.length - tail).map((line) => ` ${line}`),
  ]
  const range = (start: number, count: number) => `${count ? start : start - 1},${count}`
  const text = `@@ -${range(at.old, old.length)} +${range(at.new, next.length)} @@\n${body.join('\n')}\n`
  at.old += old.length + 1
  at.new += next.length + 1
  return {
    text,
    added: body.filter((line) => line.startsWith('+')).length,
    removed: body.filter((line) => line.startsWith('-')).length,
  }
}

function patchHunks(diff: string) {
  const start = diff.search(/^@@ /m)
  if (start < 0) return { text: '', added: 0, removed: 0 }
  const text = diff.slice(start)
  let added = 0
  let removed = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { text: text.endsWith('\n') ? text : `${text}\n`, added, removed }
}

export function proposedChanges(
  changes: ApprovalItem['changes'],
  projectPath: string | undefined
): ProposedChanges | undefined {
  if (!changes?.length) return undefined
  const byPath = new Map<string, ProposedChange[]>()
  for (const change of changes)
    byPath.set(change.path, [...(byPath.get(change.path) ?? []), change])
  const files: ProposedFile[] = []
  let patch = ''
  let numbered = true
  for (const [absolute, edits] of byPath) {
    const path = projectRelative(absolute, projectPath)
    const at = { old: 1, new: 1 }
    const hunks = edits.map((edit) => {
      if (edit.diff !== undefined) return patchHunks(edit.diff)
      if (edit.before !== undefined && edit.after !== undefined) numbered = false
      return editHunk(edit.before ?? '', edit.after ?? '', at)
    })
    const file = { path, added: 0, removed: 0 }
    for (const hunk of hunks) {
      file.added += hunk.added
      file.removed += hunk.removed
    }
    files.push(file)
    const created = edits.every((edit) => edit.diff === undefined && edit.before === undefined)
    const deleted = edits.every((edit) => edit.diff === undefined && edit.after === undefined)
    patch += [
      `diff --git a/${path} b/${path}`,
      `--- ${created ? '/dev/null' : `a/${path}`}`,
      `+++ ${deleted ? '/dev/null' : `b/${path}`}`,
      hunks.map((hunk) => hunk.text).join(''),
    ].join('\n')
  }
  return { files, patch, numbered }
}

function scopeLabel(scope: string | undefined, projectTitle: string | undefined) {
  if (scope === 'session') return 'this session'
  if (scope === 'user') return 'every project'
  return projectTitle
}

const approvalViews = new WeakMap<
  ApprovalItem,
  Map<string, ReturnType<typeof computeApprovalView>>
>()

export function approvalView(
  item: ApprovalItem,
  projectPath: string | undefined,
  projectTitle?: string
) {
  const key = JSON.stringify([projectPath, projectTitle])
  let cached = approvalViews.get(item)
  if (!cached) {
    cached = new Map()
    approvalViews.set(item, cached)
  }
  let view = cached.get(key)
  if (!view) {
    view = computeApprovalView(item, projectPath, projectTitle)
    cached.set(key, view)
  }
  return view
}

function computeApprovalView(
  item: ApprovalItem,
  projectPath: string | undefined,
  projectTitle?: string
) {
  const input = record(item.input)
  const view = viewOf(item, input, projectPath)
  const changes = proposedChanges(item.changes, projectPath)
  const always = item.always && {
    patterns: item.always.patterns.length ? item.always.patterns : [view.target],
    scope: scopeLabel(item.always.scope, projectTitle),
  }
  return { ...view, ...(changes && changesView(changes)), changes, always }
}

function changesView({ files }: ProposedChanges) {
  let added = 0
  let removed = 0
  for (const file of files) {
    added += file.added
    removed += file.removed
  }
  return {
    action: 'Edit',
    run: false,
    target: files.length === 1 ? files[0]!.path : `${files.length} files`,
    detail: `+${added} −${removed}`,
  }
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
    action: toolAction(item.toolName),
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
// Codex's plan. Tasks finished in an earlier turn drop out; open ones carry over.
export function currentTodos(items: readonly ThreadItem[]): Todo[] {
  let todos: (Todo & { turnId: string })[] = []
  for (const item of items) {
    if (item.kind !== 'tool_call' || item.agentId) continue
    const input = record(item.input)
    const { turnId } = item
    if (todoTools.has(item.toolName)) {
      const list = Array.isArray(input.todos) ? input.todos.map(record) : []
      todos = list.map((todo, index) => ({
        id: String(index + 1),
        text: String(todo.content ?? ''),
        status: todoStatus(todo.status),
        turnId,
      }))
    } else if (item.toolName === 'TaskCreate') {
      const id = /#(\d+)/.exec(item.output)?.[1] ?? String(todos.length + 1)
      todos = [...todos, { id, text: String(input.subject ?? ''), status: 'pending', turnId }]
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
                    turnId,
                  }
                : todo
            )
    }
  }
  const current = items.at(-1)?.turnId
  return todos.filter((todo) => todo.turnId === current || todo.status !== 'done')
}
