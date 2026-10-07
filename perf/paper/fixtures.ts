import { RESTART_LIMIT_NOTE, type ThreadItem } from '@jetty/shared/items'
import { emptyThread, ThreadState, type TurnOutcome } from '@jetty/shared/reducer'
import { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { join, resolve } from 'node:path'

import { type Fixtures } from '../seed'

type FixtureState = {
  name: string
  items: ThreadItem[]
  outcome?: TurnOutcome
  queue?: string[]
  worktree?: 'pending' | 'setting_up' | 'ready' | 'failed' | 'stopped'
}

export function writeFixtures(home: string, out: string, fixtures: Fixtures) {
  if (!resolve(home).startsWith(`${resolve(out)}/stack-`))
    throw new Error('Fixture writes require a capture-owned stopped home')
  const db = new Database(join(home, 'jetty.db'))
  const now = Date.now() - 120_000
  const turnId = 'paper-turn'
  let sequence = 0
  function item(fields: Record<string, unknown>) {
    return { id: `paper-item-${sequence++}`, turnId, createdAt: now, ...fields } as ThreadItem
  }
  const user = item({
    kind: 'user_message',
    text: 'Review the changes and prepare a pull request.',
    attachments: [],
  })
  const assistant = item({
    kind: 'assistant_message',
    text: 'The cache now renders the selected thread immediately. Background patches keep it up to date.',
    completedAt: now + 3500,
  })
  const states: FixtureState[] = [
    { name: 'empty', items: [] },
    { name: 'streaming', items: [] },
    { name: 'toast', items: [] },
    ...(['pending', 'setting_up', 'ready', 'failed', 'stopped'] as const).map(
      (state): FixtureState => ({
        name: `worktree ${state}`,
        items: state === 'setting_up' ? [] : [user],
        worktree: state === 'setting_up' ? 'pending' : state,
        queue: state === 'setting_up' ? [] : ['Run the checks once setup finishes.'],
      })
    ),
    {
      name: 'approval',
      items: [
        user,
        item({
          kind: 'approval',
          title: 'Run the checks',
          toolName: 'Bash',
          input: { command: 'bun run typecheck && bun test' },
          suggestions: [],
          always: { scope: 'project', patterns: ['bun run:*', 'bun test:*'] },
        }),
      ],
    },
    {
      name: 'question',
      items: [
        user,
        item({
          kind: 'question',
          delivery: 'async',
          questions: [
            {
              header: 'Scope',
              question: 'Which changes should I include?',
              multiSelect: false,
              options: [
                {
                  label: 'Cache and sidebar',
                  description: 'Keep this change focused on instant thread switching.',
                },
                {
                  label: 'All changes',
                  description: 'Include the composer and details pane as well.',
                },
              ],
            },
          ],
        }),
      ],
    },
    {
      name: 'error',
      items: [
        user,
        item({ kind: 'error', message: 'The agent disconnected before completing the turn.' }),
      ],
      outcome: 'failed',
    },
    {
      name: 'restart',
      items: [
        user,
        item({ kind: 'error', message: RESTART_LIMIT_NOTE }),
        item({ kind: 'background_stopped' }),
      ],
      outcome: 'server_restarted',
    },
    {
      name: 'queue',
      items: [user, assistant],
      outcome: 'completed',
      queue: ['Run the checks before committing.', 'Summarize the performance changes.'],
    },
    {
      name: 'watcher',
      items: [
        user,
        assistant,
        item({
          kind: 'pull_request',
          repo: 'jettpbaker/pr-lab',
          number: 1,
          activity: [
            { type: 'checks_passed', count: 4 },
            { type: 'approved', actor: 'jettpbaker' },
          ],
        }),
      ],
      outcome: 'completed',
    },
    {
      name: 'plan',
      items: [
        user,
        item({
          kind: 'plan',
          text: '## Plan\n\n- Read the existing cache.\n- Render cached state synchronously.\n- Apply catch-up patches after switching.\n- Run the checks.',
          completedAt: now + 2000,
        }),
        item({
          kind: 'tool_call',
          toolName: 'TodoWrite',
          input: {
            todos: [
              { content: 'Read the existing cache', status: 'completed' },
              { content: 'Render cached state synchronously', status: 'in_progress' },
              { content: 'Apply catch-up patches', status: 'pending' },
              { content: 'Run the checks', status: 'pending' },
            ],
          },
          output: 'Tasks updated.',
          status: 'succeeded',
          completedAt: now + 2500,
        }),
        assistant,
      ],
      outcome: 'completed',
    },
    {
      name: 'tools',
      items: [
        user,
        item({
          kind: 'tool_call',
          toolName: 'Bash',
          input: { command: 'bun run typecheck' },
          output: 'Typecheck passed.',
          status: 'succeeded',
          completedAt: now + 2000,
        }),
        assistant,
      ],
      outcome: 'completed',
    },
  ]
  const ids: Record<string, string> = {}
  try {
    const base = db
      .query('SELECT * FROM threads WHERE id = ?')
      .get(fixtures.threads.small) as Record<string, unknown>
    const columns = Object.keys(base)
    const insert = db.query(
      `INSERT INTO threads (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
    )
    db.transaction(() => {
      for (const fixture of states) {
        const id = `paper-${fixture.name.replaceAll(' ', '-')}`
        const status = ['approval', 'question'].includes(fixture.name)
          ? 'awaiting_approval'
          : fixture.outcome === 'failed' || fixture.outcome === 'server_restarted'
            ? 'error'
            : 'idle'
        const state = Schema.decodeUnknownSync(ThreadState)({
          ...emptyThread,
          items: fixture.items,
          status,
          lastSeq: 1,
          lastTurnOutcome: fixture.outcome ?? null,
          turnOutcomes: fixture.outcome ? { [turnId]: fixture.outcome } : {},
        })
        const row = {
          ...base,
          id,
          title: `Capture · ${fixture.name}`,
          status,
          environment: fixture.worktree ? 'worktree' : 'local',
          worktree_json: fixture.worktree
            ? JSON.stringify({
                checkoutPath: null,
                baseCommit: 'main',
                branch: 'jetty/capture',
                temporaryBranch: null,
                slot: 1,
                state: fixture.worktree,
                error:
                  fixture.worktree === 'failed'
                    ? 'Setup failed: bun install exited with code 1.'
                    : fixture.worktree === 'stopped'
                      ? 'Worktree setup was interrupted.'
                      : null,
              })
            : null,
          pinned: 0,
          ready_for_review: 0,
          updated_at: now,
          turn_started_at: now,
          turn_ended_at: now + 3500,
          agent_session_id: null,
          queue_paused: fixture.name === 'worktree setting_up' ? 0 : 1,
          pending_messages: JSON.stringify(
            (fixture.queue ?? []).map((text, index) => ({
              id: `paper-queue-${index}`,
              text,
              createdAt: now,
              hop: 0,
            }))
          ),
        }
        insert.run(
          ...columns.map((column) => row[column as keyof typeof row] as string | number | null)
        )
        db.query('INSERT INTO thread_states (thread_id,state_json,last_seq) VALUES (?,?,?)').run(
          id,
          JSON.stringify(state),
          1
        )
        ids[fixture.name] = id
      }
    })()
    return ids
  } finally {
    db.close()
  }
}
