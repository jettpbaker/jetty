import type { ThreadItem } from '@jetty/shared/items'
import { type ReactNode, useState } from 'react'

import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'

type ToolCallItem = Extract<ThreadItem, { kind: 'tool_call' }>

type Field =
  | { kind: 'text'; value: string; mono?: boolean }
  | { kind: 'path'; path: string }
  | null

type ToolDef = {
  running: string
  done: string
  failed: string
  field: (input: unknown) => Field
  body: (input: unknown, output: string) => string | null
}

const FALLBACK_FIELD_KEYS = [
  'description',
  'query',
  'url',
  'file_path',
  'path',
  'pattern',
  'name',
] as const

function asRecord(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

function strProp(input: unknown, key: string): string | null {
  const rec = asRecord(input)
  if (!rec) return null
  const value = rec[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? value : null
}

function firstLine(value: string): string {
  const newline = value.indexOf('\n')
  return newline === -1 ? value : value.slice(0, newline)
}

function pathField(input: unknown, key: string): Field {
  const path = strProp(input, key)
  return path ? { kind: 'path', path } : null
}

function textField(input: unknown, key: string, mono?: boolean): Field {
  const value = strProp(input, key)
  return value ? { kind: 'text', value, mono } : null
}

function plainBody(_input: unknown, output: string): string | null {
  return output.trim().length > 0 ? output : null
}

function bashBody(input: unknown, output: string): string | null {
  const command = strProp(input, 'command')
  if (!command) return plainBody(input, output)
  const tail = output.trim().length > 0 ? `\n\n${output}` : ''
  return `$ ${command}${tail}`
}

function prettyInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? 'null'
  } catch {
    return String(input)
  }
}

function fallbackBody(input: unknown, output: string): string | null {
  const parts: string[] = [prettyInput(input)]
  if (output.trim().length > 0) parts.push(output)
  const text = parts.join('\n\n')
  return text.trim().length > 0 ? text : null
}

function displayName(toolName: string): string {
  if (!toolName.startsWith('mcp__')) return toolName
  const parts = toolName.split('__')
  if (parts.length >= 3 && parts[0] === 'mcp') {
    const server = parts[1]
    const tool = parts.slice(2).join('__')
    if (server && tool) return `${server} · ${tool}`
  }
  return toolName
}

function fallbackField(input: unknown): Field {
  const rec = asRecord(input)
  if (!rec) return null
  for (const key of FALLBACK_FIELD_KEYS) {
    const value = rec[key]
    if (typeof value !== 'string' || value.trim().length === 0) continue
    if (key === 'file_path' || key === 'path') return { kind: 'path', path: value }
    if (key === 'pattern') return { kind: 'text', value, mono: true }
    return { kind: 'text', value }
  }
  return null
}

const REGISTRY: Record<string, ToolDef> = {
  Read: {
    running: 'Reading',
    done: 'Read',
    failed: 'Read failed',
    field: (input) => pathField(input, 'file_path'),
    // reads never expand — the path is the whole story
    body: () => null,
  },
  Edit: {
    running: 'Editing',
    done: 'Edited',
    failed: 'Edit failed',
    field: (input) => pathField(input, 'file_path'),
    body: plainBody,
  },
  Write: {
    running: 'Writing',
    done: 'Wrote',
    failed: 'Write failed',
    field: (input) => pathField(input, 'file_path'),
    body: plainBody,
  },
  Bash: {
    running: 'Running',
    done: 'Ran',
    failed: 'Command failed',
    field: (input) => {
      const command = strProp(input, 'command')
      return command ? { kind: 'text', value: firstLine(command), mono: true } : null
    },
    body: bashBody,
  },
  Grep: {
    running: 'Grepping',
    done: 'Grepped',
    failed: 'Grep failed',
    field: (input) => textField(input, 'pattern', true),
    body: plainBody,
  },
  Glob: {
    running: 'Globbing',
    done: 'Globbed',
    failed: 'Glob failed',
    field: (input) => textField(input, 'pattern', true),
    body: plainBody,
  },
  Task: {
    running: 'Delegating',
    done: 'Delegated',
    failed: 'Delegation failed',
    field: (input) => textField(input, 'description'),
    body: plainBody,
  },
  WebFetch: {
    running: 'Fetching',
    done: 'Fetched',
    failed: 'Fetch failed',
    field: (input) => textField(input, 'url'),
    body: plainBody,
  },
  WebSearch: {
    running: 'Searching the web',
    done: 'Searched the web',
    failed: 'Search failed',
    field: (input) => textField(input, 'query'),
    body: plainBody,
  },
  ToolSearch: {
    running: 'Loading tools',
    done: 'Loaded tools',
    failed: 'Tool load failed',
    field: (input) => {
      const query = strProp(input, 'query')
      if (!query) return null
      // "select:WebSearch,WebFetch" → "WebSearch, WebFetch"; keyword queries as-is
      const value = query.replace(/^select:/, '').replace(/,/g, ', ')
      return { kind: 'text', value, mono: true }
    },
    body: plainBody,
  },
  TodoWrite: {
    running: 'Updating todos',
    done: 'Updated todos',
    failed: 'Todo update failed',
    field: () => null,
    body: plainBody,
  },
}

function resolveDef(toolName: string): ToolDef {
  const known = REGISTRY[toolName]
  if (known) return known
  return {
    running: 'Calling',
    done: 'Called',
    failed: 'Call failed',
    field: (input) => fallbackField(input) ?? { kind: 'text', value: displayName(toolName) },
    body: fallbackBody,
  }
}

export function toolRunningLabel(toolName: string): string {
  return resolveDef(toolName).running
}

function PathField({ path }: { path: string }) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (slash === -1) {
    return <span className='block truncate text-muted-foreground'>{path}</span>
  }
  const dir = path.slice(0, slash + 1)
  const base = path.slice(slash + 1)
  return (
    <span className='flex min-w-0 items-baseline'>
      <span className='min-w-0 truncate text-muted-foreground/70'>{dir}</span>
      <span className='shrink-0 text-muted-foreground'>{base}</span>
    </span>
  )
}

function FieldView({ field }: { field: Exclude<Field, null> }) {
  if (field.kind === 'path') return <PathField path={field.path} />
  return (
    <span
      className={cn('block truncate text-muted-foreground', field.mono && 'font-mono')}
    >
      {field.value}
    </span>
  )
}

export function ToolCallField({ toolName, input }: { toolName: string; input: unknown }) {
  const field = resolveDef(toolName).field(input)
  if (!field) return null
  return <FieldView field={field} />
}

function parseErrorHeadline(output: string): string {
  let text = firstLine(output.replace(/^Error:\s*/i, ''))
  const colon = text.indexOf(': ')
  if (colon !== -1) text = text.slice(0, colon)
  text = text.trim()
  if (text.length > 120) text = `${text.slice(0, 120).trimEnd()}…`
  return text
}

function ToolRowBody({ children }: { children: ReactNode }) {
  return (
    <div className='mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-card p-2 font-mono text-[13px] text-foreground'>
      {children}
    </div>
  )
}

export function ToolRow({ item }: { item: ToolCallItem }) {
  const [open, setOpen] = useState(false)
  const def = resolveDef(item.toolName)

  if (item.status === 'running') {
    const field = def.field(item.input)
    return (
      <div className='flex w-full min-w-0 items-baseline gap-2 text-sm'>
        <span className='shrink-0 shimmer shimmer-duration-1000 text-muted-foreground'>
          {def.running}
        </span>
        {field ? (
          <span className='min-w-0 flex-1'>
            <FieldView field={field} />
          </span>
        ) : null}
      </div>
    )
  }

  const field = def.field(item.input)
  const body =
    item.status === 'failed'
      ? item.output.trim().length > 0
        ? item.output
        : null
      : def.body(item.input, item.output)
  const hasBody = body !== null && body.trim().length > 0

  function toggle() {
    setOpen((value) => !value)
  }

  if (item.status === 'failed') {
    const headline = parseErrorHeadline(item.output)
    return (
      <div>
        <div
          className={cn(
            'flex w-full min-w-0 items-baseline gap-2 text-sm',
            hasBody && 'cursor-pointer select-none',
          )}
          {...(hasBody ? pressHandlers(toggle) : {})}
        >
          <span className='shrink-0 text-foreground'>{def.failed}</span>
          {headline.length > 0 ? (
            <span className='min-w-0 flex-1 truncate text-destructive'>{headline}</span>
          ) : (
            <span className='min-w-0 flex-1' />
          )}
        </div>
        {open && hasBody ? <ToolRowBody>{body}</ToolRowBody> : null}
      </div>
    )
  }

  return (
    <div>
      <div
        className={cn(
          'flex w-full min-w-0 items-baseline gap-2 text-sm',
          hasBody && 'cursor-pointer select-none',
        )}
        {...(hasBody ? pressHandlers(toggle) : {})}
      >
        <span className='shrink-0 text-foreground'>{def.done}</span>
        {field ? (
          <span className='min-w-0 flex-1'>
            <FieldView field={field} />
          </span>
        ) : (
          <span className='min-w-0 flex-1' />
        )}
      </div>
      {open && hasBody ? <ToolRowBody>{body}</ToolRowBody> : null}
    </div>
  )
}
