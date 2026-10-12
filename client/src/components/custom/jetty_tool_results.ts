import { SessionStatus } from '@jetty/shared/events'
import { ProviderModel } from '@jetty/shared/wire'
import { Schema } from 'effect'

import type { ModelResult, ThreadResult } from './jetty_result_rows'
import type { ToolActivity } from './work_model'

type ResultKind = 'thread' | 'model' | 'bot' | 'task' | 'project' | 'pull request'
type ResultTool = { active: string; done: string; action: string; noun: ResultKind; list?: boolean }
export const jettyResultTools: Record<string, ResultTool> = {
  list_models: { active: 'Listing', done: 'Listed', action: 'list', noun: 'model', list: true },
  list_threads: { active: 'Listing', done: 'Listed', action: 'list', noun: 'thread', list: true },
  search_threads: {
    active: 'Searching',
    done: 'Found',
    action: 'search',
    noun: 'thread',
    list: true,
  },
  create_thread: { active: 'Creating', done: 'Created', action: 'create', noun: 'thread' },
  read_thread: { active: 'Reading', done: 'Read', action: 'read', noun: 'thread' },
  archive_thread: { active: 'Archiving', done: 'Archived', action: 'archive', noun: 'thread' },
  stop_thread: { active: 'Stopping', done: 'Stopped', action: 'stop', noun: 'thread' },
  list_bots: { active: 'Listing', done: 'Listed', action: 'list', noun: 'bot', list: true },
  add_task: { active: 'Adding', done: 'Added', action: 'add', noun: 'task' },
  update_task: { active: 'Updating', done: 'Updated', action: 'update', noun: 'task' },
  list_tasks: { active: 'Listing', done: 'Listed', action: 'list', noun: 'task', list: true },
  add_project: { active: 'Adding', done: 'Added', action: 'add', noun: 'project' },
  link_pull_request: { active: 'Linking', done: 'Linked', action: 'link', noun: 'pull request' },
}

const BotResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  job: Schema.optional(Schema.NullOr(Schema.String)),
})
const TaskResult = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.Literals(['todo', 'in_progress', 'done', 'dropped']),
  note: Schema.optional(Schema.NullOr(Schema.String)),
})
const ProjectResult = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  path: Schema.String,
  detail: Schema.optional(Schema.String),
})
const PullResult = Schema.Struct({ linked: Schema.String, url: Schema.String })
export type JettyResult =
  | { kind: 'thread'; value: ThreadResult }
  | { kind: 'model'; value: ModelResult }
  | { kind: 'bot'; value: Schema.Schema.Type<typeof BotResult> }
  | { kind: 'task'; value: Schema.Schema.Type<typeof TaskResult> }
  | { kind: 'project'; value: Schema.Schema.Type<typeof ProjectResult> }
  | { kind: 'pull request'; value: Schema.Schema.Type<typeof PullResult> }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function threadResult(output: unknown, input: Record<string, unknown>): ThreadResult | undefined {
  const row = record(output)
  if (!['id', 'threadId', 'title', 'thread', 'archived', 'stopped'].some((key) => key in row))
    return undefined
  const id = text(row.id) ?? text(row.threadId) ?? text(input.threadId)
  if (!id) return undefined
  const status = SessionStatus.literals.find((status) => status === row.status)
  return {
    id,
    title: text(row.title) ?? text(row.thread) ?? text(input.title) ?? id,
    project: text(row.project),
    status,
    readyForReview: row.readyForReview === true,
    archived: row.archived === true,
  }
}

// Unknown or partial payloads keep their original input/output in the disclosure.
export function jettyResults(call: ToolActivity, config: ResultTool): JettyResult[] | undefined {
  if (call.status !== 'complete') return undefined
  try {
    const output: unknown = JSON.parse(call.output ?? '')
    const input = record(JSON.parse(call.input ?? '{}'))
    const payload = call.jettyTool === 'search_threads' ? record(output).results : output
    const rows = config.list ? payload : [payload]
    if (!Array.isArray(rows)) return undefined
    const results: JettyResult[] = []
    for (const row of rows) {
      switch (config.noun) {
        case 'thread': {
          const value = threadResult(row, input)
          if (!value) return undefined
          results.push({ kind: 'thread', value })
          break
        }
        case 'model': {
          const value = Schema.decodeUnknownSync(ProviderModel)({
            ...record(row),
            fast: false,
            autoMode: false,
          })
          results.push({ kind: 'model', value })
          break
        }
        case 'bot':
          results.push({ kind: 'bot', value: Schema.decodeUnknownSync(BotResult)(row) })
          break
        case 'task':
          results.push({ kind: 'task', value: Schema.decodeUnknownSync(TaskResult)(row) })
          break
        case 'project':
          results.push({ kind: 'project', value: Schema.decodeUnknownSync(ProjectResult)(row) })
          break
        case 'pull request':
          results.push({ kind: 'pull request', value: Schema.decodeUnknownSync(PullResult)(row) })
          break
      }
    }
    return results
  } catch {
    return undefined
  }
}

export function jettyResultKey(result: JettyResult) {
  switch (result.kind) {
    case 'model':
      return `${result.value.provider}:${result.value.id}`
    case 'pull request':
      return result.value.linked
    default:
      return result.value.id
  }
}
