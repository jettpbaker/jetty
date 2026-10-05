import type { ThreadItem } from '@jetty/shared/items'

type ToolCall = Extract<ThreadItem, { kind: 'tool_call' }>

export type Todo = { id: string; text: string; status: 'done' | 'active' | 'pending' }

type TodoMove = 'finished' | 'started' | 'reopened' | 'renamed' | 'added' | 'removed'

// What one todo call changed, for its line in the work log: a fresh list counts what it made,
// a later call names what moved.
export type TodoUpdate = {
  created?: number
  moves: { move: TodoMove; text: string }[]
  done: number
  total: number
}

type Tracked = Todo & { turnId: string }

const listTools = new Set(['TodoWrite', 'update_plan'])
const statusMoves = { done: 'finished', active: 'started', pending: 'reopened' } as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function todoStatus(status: unknown): Todo['status'] {
  return status === 'completed' ? 'done' : status === 'in_progress' ? 'active' : 'pending'
}

// Tasks finished in an earlier turn drop out; open ones carry over.
function shown(todo: Tracked, turnId: string | undefined) {
  return todo.turnId === turnId || todo.status !== 'done'
}

// The list after one call. A rewritten list keeps each surviving entry's id, so it diffs by id
// like the incremental Task calls do.
function apply(
  item: ToolCall,
  todos: readonly Tracked[],
  newId: () => string
): Tracked[] | undefined {
  const input = record(item.input)
  const { turnId } = item
  if (listTools.has(item.toolName)) {
    const ids = new Map<string, string[]>()
    for (const todo of todos) ids.set(todo.text, [...(ids.get(todo.text) ?? []), todo.id])
    const list = Array.isArray(input.todos) ? input.todos.map(record) : []
    return list.map((todo) => {
      const text = String(todo.content ?? '')
      return {
        id: ids.get(text)?.shift() ?? newId(),
        text,
        status: todoStatus(todo.status),
        turnId,
      }
    })
  }
  if (item.toolName === 'TaskCreate') {
    const id = /#(\d+)/.exec(item.output)?.[1] ?? newId()
    return [...todos, { id, text: String(input.subject ?? ''), status: 'pending', turnId }]
  }
  if (item.toolName === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    if (input.status === 'deleted') return todos.filter((todo) => todo.id !== id)
    return todos.map((todo) =>
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
  return undefined
}

function describe(
  before: readonly Tracked[],
  after: readonly Tracked[],
  turnId: string
): TodoUpdate | undefined {
  const previous = new Map(before.map((todo) => [todo.id, todo]))
  const moves: TodoUpdate['moves'] = []
  for (const todo of after) {
    const was = previous.get(todo.id)
    previous.delete(todo.id)
    const move = !was
      ? 'added'
      : was.status !== todo.status
        ? statusMoves[todo.status]
        : was.text !== todo.text
          ? 'renamed'
          : undefined
    if (move) moves.push({ move, text: todo.text })
  }
  for (const todo of previous.values())
    if (shown(todo, turnId)) moves.push({ move: 'removed', text: todo.text })
  if (moves.length === 0) return undefined
  const list = after.filter((todo) => shown(todo, turnId))
  const done = list.filter((todo) => todo.status === 'done').length
  const fresh = moves.length === list.length && moves.every(({ move }) => move === 'added')
  return fresh
    ? { created: moves.length, moves: [], done, total: list.length }
    : { moves, done, total: list.length }
}

// Consecutive TaskCreate calls share the first one's line.
function join(run: TodoUpdate, update: TodoUpdate) {
  if (run.created === undefined) run.moves.push(...update.moves)
  else run.created += update.moves.length
  run.done = update.done
  run.total = update.total
}

// The main agent's task list: Claude's TaskCreate/TaskUpdate (or older TodoWrite) calls, or
// Codex's plan. `updates` holds every todo call's line, undefined when it changed nothing shown
// or joined the run of TaskCreate calls before it.
export function foldTodos(items: readonly ThreadItem[], current = items.at(-1)?.turnId) {
  let todos: Tracked[] = []
  const updates = new Map<string, TodoUpdate | undefined>()
  let made = 0
  const newId = () => `todo-${++made}`
  let run: TodoUpdate | undefined
  for (const item of items) {
    if (item.agentId) continue
    // A failed call changed nothing, so it stays a tool call that shows its error.
    const after =
      item.kind === 'tool_call' && item.status !== 'failed' ? apply(item, todos, newId) : undefined
    if (!after) {
      run = undefined
      continue
    }
    const update = describe(todos, after, item.turnId)
    todos = after
    const creating = item.kind === 'tool_call' && item.toolName === 'TaskCreate'
    if (run && creating) {
      if (update) join(run, update)
      updates.set(item.id, undefined)
      continue
    }
    updates.set(item.id, update)
    run = creating ? update : undefined
  }
  const list: Todo[] = todos.filter((todo) => shown(todo, current))
  return { todos: list, updates }
}

export function currentTodos(items: readonly ThreadItem[], current = items.at(-1)?.turnId): Todo[] {
  return foldTodos(items, current).todos
}
