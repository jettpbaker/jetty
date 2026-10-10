import type { ThreadEvent } from '@jetty/shared/events'
import type { ThreadItem } from '@jetty/shared/items'

export type StreamState = {
  id: string
  group: 'Turn' | 'Thinking' | 'Tools' | 'Text' | 'Now-line' | 'Fold'
  title: string
  description: string
  initial: ThreadEvent[]
  events: { t: number; event: ThreadEvent }[]
  duration: number
  limitation?: string
}

type NewItem<T = ThreadItem> = T extends ThreadItem ? Omit<T, 'turnId' | 'createdAt'> : never

function item(item: NewItem): ThreadEvent {
  return { type: 'item.started', item: { ...item, turnId: 'turn', createdAt: 0 } as ThreadItem }
}

function start(): ThreadEvent[] {
  return [
    item({ id: 'prompt', kind: 'user_message', text: 'Inspect the change.', attachments: [] }),
    { type: 'turn.started', turnId: 'turn' },
  ]
}

function end(error?: string): ThreadEvent {
  return error
    ? { type: 'turn.failed', turnId: 'turn', error }
    : { type: 'turn.completed', turnId: 'turn' }
}

function tool(id: string, kind: string, target: string, description?: string): ThreadEvent {
  const key = ['Read', 'Edit', 'Write'].includes(kind)
    ? 'file_path'
    : kind === 'Bash'
      ? 'command'
      : kind === 'Grep'
        ? 'pattern'
        : 'query'
  return item({
    id,
    kind: 'tool_call',
    toolName: kind,
    input: { [key]: target, ...(description && { description }) },
    output: '',
    status: 'running',
  })
}

function thinking(id = 'think', tokens = 0): ThreadEvent {
  return item({ id, kind: 'reasoning', text: '', streaming: true, tokens })
}

function text(
  value: string,
  id = 'text',
  kind: 'assistant_message' | 'plan' = 'assistant_message'
): ThreadEvent {
  return item({ id, kind, text: value, streaming: true })
}

function delta(itemId: string, delta: string, tokens?: number): ThreadEvent {
  return { type: 'item.delta', itemId, delta, ...(tokens !== undefined && { tokens }) }
}

function done(itemId: string, patch?: Record<string, unknown>): ThreadEvent {
  return { type: 'item.completed', itemId, ...(patch && { patch }) }
}

function at(t: number, ...events: ThreadEvent[]) {
  return events.map((event) => ({ t, event }))
}

function card(
  group: StreamState['group'],
  id: string,
  title: string,
  description: string,
  initial: ThreadEvent[],
  events: StreamState['events'],
  limitation?: string,
  duration?: number
): StreamState {
  return {
    group,
    id,
    title,
    description,
    initial,
    events,
    limitation,
    duration: duration ?? (events.at(-1)?.t ?? 0) + 2500,
  }
}

const read = () => tool('read', 'Read', 'src/app.tsx')
const readPair = () => [
  tool('a', 'Read', 'src/a.ts'),
  done('a', { status: 'succeeded' }),
  tool('b', 'Read', 'src/b.ts'),
]
const finishedRead = () => [read(), done('read', { status: 'succeeded' })]
const prelude = () => [...start(), thinking(), done('think')]
const answer = 'The change is ready. Each state now has its own small replay.'

export const streamStates: StreamState[] = [
  card(
    'Turn',
    'start',
    'Turn start',
    'Working and its stand-in arrive together.',
    [],
    at(600, ...start())
  ),
  card(
    'Turn',
    'timer',
    'Header timer',
    'Working for Ns ticks while the turn stays live.',
    start(),
    [],
    undefined,
    3200
  ),
  card(
    'Turn',
    'waiting',
    'Awaiting approval',
    'Waiting keeps the work header; no approval UI yet.',
    [...start(), read()],
    at(
      600,
      item({
        id: 'approval',
        kind: 'approval',
        title: 'Allow read?',
        toolName: 'Read',
        input: {},
        suggestions: [],
        toolCallId: 'read',
      }),
      { type: 'session.status', status: 'awaiting_approval' }
    ),
    'Approval and question rows are omitted by HybridV2Pane.'
  ),
  card(
    'Turn',
    'interrupted',
    'Interrupted turn',
    'A live call stops when the turn is interrupted.',
    [...start(), read()],
    at(600, end('interrupted'))
  ),
  card(
    'Turn',
    'failed-turn',
    'Failed turn',
    'The header becomes Worked on a failed turn too.',
    [...start(), thinking()],
    at(600, end('Something went wrong'))
  ),
  card(
    'Turn',
    'restarted',
    'Server restart',
    'A restart ends work without a dedicated restart seam.',
    [...start(), read()],
    at(600, end('server_restarted'))
  ),

  card(
    'Thinking',
    'thinking',
    'Thinking appears',
    'The stand-in hands over to a thinking row.',
    start(),
    at(600, thinking())
  ),
  card(
    'Thinking',
    'tokens',
    'Thinking tokens',
    'Token deltas land as 0 → 5 → 50.',
    [...start(), thinking()],
    [...at(600, delta('think', '', 5)), ...at(1200, delta('think', '', 45))],
    'Tokens reach the activity model, but v2 does not render them.'
  ),
  card(
    'Thinking',
    'thought',
    'Thinking → Thought',
    'Watch the Opencode label swap and the returning stand-in.',
    [...start(), thinking()],
    at(600, done('think'))
  ),

  card(
    'Tools',
    'read',
    'Reading → Read',
    'Completion plus turn end puts a single read in past tense.',
    [...start(), read()],
    at(600, done('read', { status: 'succeeded' }), end())
  ),
  card(
    'Tools',
    'read-count',
    'Reading 2 → 3 files',
    'Only the batch count rolls as another read arrives.',
    [...start(), ...readPair()],
    at(600, tool('c', 'Read', 'src/c.ts'))
  ),
  card(
    'Tools',
    'seal-next',
    'Batch seals at next item',
    'A different kind puts the finished read batch in past tense.',
    [...start(), ...readPair(), done('b', { status: 'succeeded' })],
    at(600, tool('cmd', 'Bash', 'bun run lint'))
  ),
  card(
    'Tools',
    'seal-end',
    'Batch seals at turn end',
    'Reading 2 files becomes Read 2 files.',
    [...start(), ...readPair(), done('b', { status: 'succeeded' })],
    at(600, end())
  ),
  card(
    'Tools',
    'bash',
    'Described Bash',
    'The command swaps to past; its description is not shown.',
    [...start(), tool('cmd', 'Bash', 'bun run lint', 'Check the client')],
    at(600, done('cmd', { status: 'succeeded' }), end()),
    'The v2 label uses the command target, not describeToolBatch.description.'
  ),
  card(
    'Tools',
    'commands',
    'Running → Ran 2 commands',
    'A command batch seals without changing its count.',
    [
      ...start(),
      tool('a', 'Bash', 'bun run lint'),
      done('a', { status: 'succeeded' }),
      tool('b', 'Bash', 'bun run typecheck'),
    ],
    at(600, done('b', { status: 'succeeded' }), end())
  ),
  ...(['Edit', 'Write', 'Grep', 'WebSearch', 'UnknownTool'] as const).map((kind) => {
    const target =
      kind === 'WebSearch'
        ? 'React compiler'
        : kind === 'Grep'
          ? 'useState'
          : kind === 'UnknownTool'
            ? 'inspect'
            : 'src/app.tsx'
    return card(
      'Tools',
      kind.toLowerCase(),
      `${kind} completes`,
      'Watch the active verb swap to its past tense.',
      [...start(), tool('call', kind, target)],
      at(600, done('call', { status: 'succeeded' }), end())
    )
  }),
  card(
    'Tools',
    'failed-tool',
    'Failed tool',
    'The tool label becomes Failed and takes the error color.',
    [...start(), read()],
    at(600, done('read', { status: 'failed', output: 'File not found' }))
  ),
  card(
    'Tools',
    'stopped-tool',
    'Stopped tool',
    'An unsettled completed call reads as Stopped.',
    [...start(), read()],
    at(600, done('read'))
  ),
  card(
    'Tools',
    'parallel',
    'Parallel tools, different kinds',
    'Both calls remain running when the second row arrives.',
    [...start(), read()],
    at(600, tool('cmd', 'Bash', 'bun run lint')),
    'Both running call ids survive, but only the tail row is live and shimmers.'
  ),
  card(
    'Tools',
    'stagger',
    'Three rows, one frame',
    'Thinking, reading and running arrive 50ms apart.',
    start(),
    at(600, thinking(), read(), tool('cmd', 'Bash', 'bun run lint'))
  ),
  card(
    'Tools',
    'created',
    'Created thread',
    'A successful create-thread call becomes Created 1 thread.',
    [...start(), tool('child', 'mcp__jetty__create_thread', 'Inspect tests')],
    at(600, done('child', { status: 'succeeded', output: '{"threadId":"child-1"}' }))
  ),
  card(
    'Tools',
    'created-count',
    'Created 1 → 2 threads',
    'Adjacent created threads share one count label.',
    [
      ...start(),
      tool('child', 'mcp__jetty__create_thread', 'Inspect tests'),
      done('child', { status: 'succeeded', output: '{"threadId":"child-1"}' }),
    ],
    at(
      600,
      tool('child2', 'mcp__jetty__create_thread', 'Inspect types'),
      done('child2', { status: 'succeeded', output: '{"threadId":"child-2"}' })
    )
  ),
  card(
    'Tools',
    'todos',
    'Task list update',
    'A todo call appears as Updated task list.',
    start(),
    at(
      600,
      item({
        id: 'todos',
        kind: 'tool_call',
        toolName: 'TodoWrite',
        input: { todos: [{ content: 'Inspect the change', status: 'in_progress' }] },
        output: '',
        status: 'succeeded',
      }),
      done('todos')
    )
  ),
  card(
    'Tools',
    'jetty-tool',
    'Jetty tool vocabulary',
    'Jetty tools use their own words and prose targets.',
    [...start(), tool('call', 'mcp__jetty__send_message', 'child-1')],
    at(600, done('call', { status: 'succeeded' }), end())
  ),
  card(
    'Tools',
    'mixed-batch',
    'Batch with a failure',
    'The whole sealed batch is counted, including its failed call.',
    [...start(), ...readPair()],
    at(600, done('b', { status: 'failed' }), end())
  ),

  card(
    'Text',
    'interim',
    'Interim text arrives',
    'Text arrives bright with space between steps.',
    prelude(),
    at(600, text('I will check the call sites.'))
  ),
  card(
    'Text',
    'muted',
    'Interim text mutes',
    'The next step fades earlier text to muted.',
    [...prelude(), text('I will check the call sites.'), done('text')],
    at(600, read())
  ),
  card(
    'Text',
    'burst',
    'Burst answer',
    'All text lands together, then the renderer paces its reveal.',
    prelude(),
    at(600, text(answer), done('text'), end())
  ),
  card(
    'Text',
    'streamed',
    'Streamed answer',
    'Text arrives over seconds before the answer settles.',
    prelude(),
    [
      ...at(600, text('The change ')),
      ...at(1400, delta('text', 'is ready. ')),
      ...at(2200, delta('text', 'Each state has its own replay.')),
      ...at(3000, done('text'), end()),
    ]
  ),
  card(
    'Text',
    'plan',
    'Plan answer',
    'Plan text uses the same reveal and fold path.',
    prelude(),
    at(
      600,
      text('1. Inspect the change.\n2. Verify the result.', 'text', 'plan'),
      done('text'),
      end()
    )
  ),

  card(
    'Now-line',
    'gap',
    'Planning next moves',
    'Completing thinking leaves a live gap and its stand-in.',
    [...start(), thinking()],
    at(600, done('think'))
  ),
  card(
    'Now-line',
    'handoff',
    'Stand-in hand-off',
    'Planning next moves rolls into the next tool row.',
    [...start(), thinking(), done('think')],
    at(600, read())
  ),
  card(
    'Now-line',
    'open-batch',
    'Open batch holds present tense',
    'A finished read stays Reading while its batch is open.',
    [...start(), read()],
    at(600, done('read', { status: 'succeeded' }))
  ),

  card(
    'Fold',
    'fold',
    'Fold after reveal',
    'After the answer reveals, work collapses to Worked for Ns.',
    [...start(), ...finishedRead(), text('The change is ready.')],
    at(1200, done('text'), end())
  ),
  card(
    'Fold',
    'no-answer',
    'Turn ends without an answer',
    'Work changes to past tense and stays expanded.',
    [...start(), thinking()],
    at(1200, done('think'), end())
  ),
]
