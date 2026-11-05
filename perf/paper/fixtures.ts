import { RESTART_LIMIT_NOTE, type ThreadItem } from '@jetty/shared/items'
import { emptyThread, ThreadState, type TurnOutcome } from '@jetty/shared/reducer'
import { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { type Fixtures } from '../seed'

export const checkoutTitle = 'Keep discount codes through checkout'
export const checkoutPrompt =
  'Discount codes disappear when a customer edits their shipping address. Trace the checkout flow, keep the applied code across recalculations, and cover expired codes and free shipping. Keep the amounts in integer cents.'

type FixtureState = {
  name: string
  title: string
  items: ThreadItem[]
  id?: string
  outcome?: TurnOutcome
  status?: ThreadState['status']
  queue?: string[]
  worktree?: 'pending' | 'setting_up' | 'ready' | 'failed' | 'stopped'
  projectId?: string
  parentId?: string
  pr?: number
  pinned?: boolean
  minutes?: number
}

export function writeFixtures(home: string, out: string, fixtures: Fixtures) {
  if (!resolve(home).startsWith(`${resolve(out)}/stack-`))
    throw new Error('Fixture writes require a capture-owned stopped home')
  const db = new Database(join(home, 'jetty.db'))
  const now = Date.now() - 120_000
  let sequence = 0
  const turnId = 'checkout-investigation'
  function item(fields: Record<string, unknown>) {
    return { id: `review-item-${sequence++}`, turnId, createdAt: now, ...fields } as ThreadItem
  }
  function user(text: string) {
    return item({ kind: 'user_message', text, attachments: [] })
  }
  function answer(text: string) {
    return item({ kind: 'assistant_message', text, completedAt: now + 82_000 })
  }
  function tool(toolName: string, input: unknown, output: string, extra = {}) {
    return item({
      kind: 'tool_call',
      toolName,
      input,
      output,
      status: 'succeeded',
      completedAt: now + 68_000,
      ...extra,
    })
  }
  const todos = tool(
    'TodoWrite',
    {
      todos: [
        { content: 'Trace checkout recalculation and discount validation', status: 'completed' },
        { content: 'Preserve the code when the address changes', status: 'completed' },
        { content: 'Cover expiry, rounding and free shipping', status: 'completed' },
        { content: 'Review the checkout patch and open a pull request', status: 'in_progress' },
      ],
    },
    'Updated 4 tasks.'
  )
  const work = [
    item({
      kind: 'reasoning',
      text: 'The address update rebuilds the quote from the cart, but the applied discount lives only on the previous quote. I need to carry the code into recalculation and validate it again, rather than preserve a stale total. Shipping discounts must remain separate from the taxable merchandise subtotal.',
      tokens: 842,
      completedAt: now + 12_000,
    }),
    tool(
      'Read',
      { file_path: 'src/checkout/recalculate.ts' },
      'export async function recalculate(cart: Cart, address: Address) {\n  const quote = await priceCart(cart, address);\n  return quote;\n}'
    ),
    tool(
      'Read',
      { file_path: 'src/discounts/validate.ts' },
      'export function validateDiscount(code: string, now: Date): DiscountResult {\n  const discount = discounts.get(code.toUpperCase());\n  if (!discount || discount.expiresAt <= now) return { valid: false };\n  return { valid: true, discount };\n}'
    ),
    tool(
      'Grep',
      { pattern: 'appliedDiscount|recalculate', path: 'src/checkout' },
      'src/checkout/recalculate.ts:18: export async function recalculate\nsrc/checkout/session.ts:42: appliedDiscount: session.discountCode\nsrc/checkout/address.ts:63: await recalculate(cart, address)'
    ),
    tool(
      'Edit',
      {
        file_path: 'src/checkout/recalculate.ts',
        old_string: 'const quote = await priceCart(cart, address);',
        new_string:
          'const discount = await resolveDiscount(cart.discountCode);\n  const quote = await priceCart(cart, address, discount);',
      },
      '--- a/src/checkout/recalculate.ts\n+++ b/src/checkout/recalculate.ts\n@@ -18,2 +18,3 @@\n-  const quote = await priceCart(cart, address);\n+  const discount = await resolveDiscount(cart.discountCode);\n+  const quote = await priceCart(cart, address, discount);\n   return quote;',
      { fileChange: { path: 'src/checkout/recalculate.ts', additions: 2, deletions: 1 } }
    ),
    tool(
      'Bash',
      { command: 'bun test src/checkout', description: 'Run the checkout regression tests' },
      'bun test v1.4.2\n\n✓ keeps SAVE15 after shipping address changes\n✓ removes an expired code before recalculating\n✓ applies free shipping without changing item tax\n✓ rounds percentage discounts once, in cents\n\n24 pass\n0 fail\n68 expect() calls\nRan 24 tests across 3 files. [412ms]'
    ),
    todos,
    item({
      kind: 'subagent',
      title: 'Review discount rounding and tax order',
      prompt:
        'Review the recalculation patch for rounding errors, expiry boundaries, and the order of discount and tax. Report concrete risks only.',
      agentType: 'review',
      model: 'claude-sonnet-4-6',
      status: 'completed',
      tokens: 6840,
      durationMs: 38_000,
      result:
        'No blocking issues. Percentage discounts round once at the line subtotal; free shipping leaves merchandise tax unchanged. Added coverage for expiry at exactly midnight.',
      completedAt: now + 70_000,
    }),
    item({
      kind: 'thread_marker',
      action: 'started',
      threadId: '7bdbef21-bf56-4f68-876f-806f1a91ba25',
      title: 'Audit tax rounding at checkout',
    }),
  ]
  const attachmentId = 'c84e726b-efb3-4006-936e-2cd1403f5d8a'
  const attachmentText =
    'Scenario,Code,Expected\nAddress change,SAVE15,Discount retained\nExpired code,WINTER10,Code removed with explanation\nFree shipping,FREESHIP,Shipping zero; item tax unchanged\nCurrency change,SAVE15,Eligibility rechecked in new currency\n'
  const attachment = {
    id: attachmentId,
    name: 'checkout-regressions.csv',
    mimeType: 'text/csv',
    sizeBytes: Buffer.byteLength(attachmentText),
  }
  mkdirSync(join(home, 'attachments', attachmentId), { recursive: true })
  writeFileSync(join(home, 'attachments', attachmentId, attachment.name), attachmentText)
  const opening = item({ kind: 'user_message', text: checkoutPrompt, attachments: [attachment] })
  const summary = answer(`## Discount codes now survive address changes

The checkout was rebuilding the quote without passing along \`discountCode\`. I fixed the handoff and revalidate the code before calculating totals.

- **Keep valid codes** when the shipping address or delivery method changes.
- **Drop expired codes** with a clear explanation next to the order summary.
- **Keep tax correct:** free shipping never reduces the merchandise subtotal.

\`recalculate\` now resolves the discount before pricing the cart:

\`\`\`ts
const discount = await resolveDiscount(cart.discountCode)
const quote = await priceCart(cart, address, discount)
return { ...quote, discountCode: discount?.code ?? null }
\`\`\`

| Scenario | Before | Now |
| --- | --- | --- |
| Change shipping address | Code lost | Code retained |
| Expired discount | Stale total | Code removed |
| Free shipping | Tax reduced | Item tax unchanged |

**Validation:** all 24 checkout tests pass, including the four cases in your attachment. The [tax audit](jetty://threads/7bdbef21-bf56-4f68-876f-806f1a91ba25) found no rounding regressions. Ready for a final look at [the pull request](https://github.com/jettpbaker/pr-lab/pull/1).`)
  const followup = user(
    'Looks good. What happens if the customer switches currency after applying SAVE15?'
  )
  const finalAnswer = answer(
    'The code stays attached to the cart, but its eligibility is checked against the new currency before we show a total. A currency-specific code is removed with “This code isn’t available in EUR.” Percentage codes such as `SAVE15` are recalculated from the new subtotal, so we never convert an already discounted amount.'
  )
  const request = user(
    'Finish the discount-code fix for the storefront checkout. Include the address-change regression and keep the tax calculation in cents.'
  )
  const done = answer(
    'The address-change regression is covered. `SAVE15` now stays on the cart while the quote is recalculated; expired codes are cleared before pricing. The checkout suite passes all 24 tests.'
  )
  const states: FixtureState[] = [
    {
      name: 'conversation',
      id: fixtures.threads.small,
      title: checkoutTitle,
      items: [opening, ...work, summary, followup, finalAnswer],
      outcome: 'completed',
      pinned: true,
      minutes: 4,
      pr: 1,
    },
    {
      name: 'tax audit',
      id: '7bdbef21-bf56-4f68-876f-806f1a91ba25',
      title: 'Audit tax rounding at checkout',
      items: [
        user('Check percentage discounts, free shipping and rounding at the tax boundary.'),
        answer(
          'Audited all three paths. Discounts round once in integer cents; shipping discounts do not change item tax. The midnight expiry boundary is covered.'
        ),
      ],
      outcome: 'completed',
      parentId: fixtures.threads.small,
      minutes: 45,
    },
    {
      name: 'long',
      id: fixtures.threads.long,
      title: 'Reconcile abandoned checkout events',
      items: [
        user(
          'Checkout abandonment is overcounted when a customer retries payment. Reconcile the session events against completed orders.'
        ),
        answer(
          '## Checkout events reconciled\n\nPayment retries now share the original `checkoutSessionId`. The funnel counts one abandonment per session and excludes sessions that later produce an order.\n\n- Deduplicated retry events by session and event type.\n- Backfilled the last seven days of sandbox data.\n- Checked that completed orders never appear in the abandoned cohort.'
        ),
      ],
      outcome: 'completed',
      minutes: 14,
      projectId: 'review-analytics',
    },
    {
      name: 'code',
      id: fixtures.threads.code,
      title: 'Generate regional tax tables',
      items: [
        user(
          'Generate regional GST tables for checkout, with effective dates so we can validate the upcoming rate change.'
        ),
        answer(
          'The regional tables are generated for review. Each entry carries `region`, `basisPoints` and `effectiveFrom`; the checkout still uses the existing resolver until we decide how to publish updates.\n\nThe draft PR includes AU and NZ coverage plus boundary tests for the effective date.'
        ),
      ],
      outcome: 'completed',
      minutes: 12,
      pr: 3,
    },
    {
      name: 'diff',
      id: fixtures.threads.diff,
      title: 'Document checkout setup',
      items: [
        user('Document local checkout setup and the payment sandbox.'),
        answer(
          'The README now covers local setup, the payment sandbox and checkout tests. The documentation update is merged.'
        ),
      ],
      outcome: 'completed',
      minutes: 18,
      pr: 4,
    },
    { name: 'empty', title: 'Investigate guest checkout timeouts', items: [], minutes: 38 },
    {
      name: 'streaming',
      title: 'Trace checkout validation',
      minutes: 6,
      // Active turns are reconciled at startup; the admission frame keeps this stream frozen.
      status: 'starting',
      items: [
        request,
        ...work.slice(0, 6),
        item({
          kind: 'assistant_message',
          streaming: true,
          text: '## Checkout validation order\n\nThe discount is revalidated **before** the quote is priced. That prevents an expired code from carrying a stale total into the next step.\n\n1. Normalize the code and check its expiry.\n2. Confirm the code applies to the selected currency.\n3. Calculate the item discount in integer cents.\n4. Apply shipping promotions separately from merchandise tax.\n\nThe address-change path now calls `resolveDiscount(cart.discountCode)` on each recalculation. I’m checking the currency-switch case next.',
        }),
      ],
    },
    {
      name: 'toast',
      title: 'Remove legacy coupon endpoint',
      items: [
        user('Remove the unused /v1/coupons endpoint now that all clients use checkout discounts.'),
        answer(
          'Removed the endpoint and its stale client helper. No remaining callers were found.'
        ),
      ],
      outcome: 'completed',
      minutes: 90,
    },
    ...(['pending', 'setting_up', 'ready', 'failed', 'stopped'] as const).map(
      (state, index): FixtureState => ({
        name: `worktree ${state}`,
        title: [
          'Add delivery instructions',
          'Add express checkout',
          'Validate postcode formats',
          'Upgrade payment SDK',
          'Retry payment authorization',
        ][index]!,
        items:
          state === 'setting_up'
            ? []
            : [
                user(
                  'Prepare an isolated checkout branch and run the existing payment tests before changing the flow.'
                ),
              ],
        worktree: state === 'setting_up' ? 'pending' : state,
        queue:
          state === 'setting_up' ? [] : ['Run the payment tests once dependencies are installed.'],
        minutes: 180 + index * 35,
      })
    ),
    {
      name: 'approval',
      title: 'Verify checkout before release',
      items: [
        request,
        answer(
          'The patch is ready. I need to run the checkout tests and typecheck before handing it back.'
        ),
        item({
          kind: 'approval',
          title: 'Run checkout validation',
          toolName: 'Bash',
          input: { command: 'bun run typecheck && bun test src/checkout' },
          suggestions: [],
          always: { scope: 'project', patterns: ['bun run:*', 'bun test:*'] },
        }),
      ],
      minutes: 3,
    },
    {
      name: 'question',
      title: 'Decide how discounts stack',
      items: [
        user('Add support for combining a shipping promotion with a percentage discount.'),
        answer(
          'The pricing pipeline can support both. One policy decision affects the implementation:'
        ),
        item({
          kind: 'question',
          delivery: 'async',
          questions: [
            {
              header: 'Stacking',
              question: 'Should free shipping combine with a percentage discount?',
              multiSelect: false,
              options: [
                {
                  label: 'Allow both',
                  description: 'Apply the percentage discount to items, then waive shipping.',
                },
                {
                  label: 'Best offer only',
                  description: 'Choose the promotion that saves the customer the most.',
                },
              ],
            },
          ],
        }),
      ],
      minutes: 7,
    },
    {
      name: 'error',
      title: 'Fix payment webhook retries',
      items: [
        user('Reproduce duplicate webhook deliveries and make payment confirmation idempotent.'),
        tool(
          'Bash',
          {
            command: 'bun test src/payments/webhooks.test.ts',
            description: 'Reproduce duplicate payment confirmations',
          },
          'ECONNREFUSED: payment sandbox at localhost:4242\nThe local webhook service is not running.',
          { status: 'failed' }
        ),
        item({
          kind: 'error',
          message:
            'The payment sandbox is unavailable. Start the local webhook service, then retry this turn.',
        }),
      ],
      outcome: 'failed',
      minutes: 10,
    },
    {
      name: 'restart',
      title: 'Resume inventory reservation audit',
      items: [
        user('Audit the inventory reservation race when two checkouts buy the last item.'),
        item({ kind: 'error', message: RESTART_LIMIT_NOTE }),
        item({ kind: 'background_stopped' }),
      ],
      outcome: 'server_restarted',
      minutes: 68,
    },
    {
      name: 'queue',
      title: 'Cover checkout edge cases',
      items: [request, done],
      outcome: 'completed',
      queue: [
        'Add a regression for a code that expires at midnight UTC.',
        'Check that changing currency revalidates the promotion.',
      ],
      minutes: 44,
    },
    {
      name: 'watcher',
      title: 'Watch discount-code checks',
      items: [
        request,
        done,
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
      minutes: 26,
    },
    {
      name: 'plan',
      title: 'Plan checkout recovery',
      items: [
        user(
          'Let customers recover their cart after a payment failure without entering their address again.'
        ),
        item({
          kind: 'plan',
          text: '## Recover checkout after a failed payment\n\n### Approach\nKeep the checkout session alive when authorization fails. Store the address and selected delivery method on the session, never in the payment token.\n\n1. Separate session expiry from payment attempt expiry.\n2. Restore the cart and revalidate stock and discount eligibility.\n3. Show the failed attempt inline and let the customer choose another method.\n4. Cover declined cards, expired sessions and retry idempotency.\n\n### Validation\nRun the checkout suite and payment sandbox tests. Confirm that no card details reach the session store.',
          completedAt: now + 2000,
        }),
        tool(
          'TodoWrite',
          {
            todos: [
              { content: 'Separate checkout sessions from payment attempts', status: 'pending' },
              { content: 'Restore the cart and revalidate stock and discounts', status: 'pending' },
              { content: 'Show payment failures inline with a retry action', status: 'pending' },
              { content: 'Cover declined cards, expiry and idempotency', status: 'pending' },
            ],
          },
          'Updated 4 recovery tasks.'
        ),
        answer(
          'The recovery plan is ready. I would start by separating the checkout session from each payment attempt; that keeps retries safe and avoids collecting the address twice.'
        ),
      ],
      outcome: 'completed',
      minutes: 102,
    },
    {
      name: 'tools',
      title: 'Validate discount-code regression',
      items: [request, ...work.slice(0, -1), done],
      outcome: 'completed',
      minutes: 28,
    },
    {
      name: 'working',
      title: 'Tighten checkout accessibility',
      items: [
        user('Audit keyboard navigation and field errors in the checkout form.'),
        item({
          kind: 'reasoning',
          text: 'Checking focus order and the connection between each error message and its input.',
          streaming: true,
        }),
        item({
          kind: 'tool_call',
          toolName: 'Bash',
          input: {
            command: 'bun test src/checkout/accessibility.test.ts',
            description: 'Check checkout keyboard navigation',
          },
          output: 'Running 12 accessibility checks…',
          status: 'running',
        }),
      ],
      status: 'running',
      minutes: 1,
    },
    {
      name: 'conflict',
      title: 'Rebase checkout totals',
      items: [
        user('Rebase the checkout totals refactor over the new tax helper.'),
        answer(
          'There is one conflict in `src/money.ts`: both branches changed the rounding helper. I have kept the refactor paused so we can resolve the cents conversion first.'
        ),
      ],
      outcome: 'completed',
      pr: 2,
      minutes: 32,
    },
    {
      name: 'events',
      title: 'Deduplicate purchase events',
      items: [
        user('Use the order id as the deduplication key for purchase events.'),
        answer(
          'Purchase events now use `order.id` as the idempotency key. Replayed webhook deliveries no longer increase the conversion count.'
        ),
      ],
      outcome: 'completed',
      projectId: 'review-analytics',
      minutes: 145,
    },
    {
      name: 'bot',
      id: 'review-checkout-bot',
      title: 'Checkout',
      items: [
        user(
          'Keep an eye on the checkout release today. Prioritize the discount regression and payment failures; ask me before changing promotion policy.'
        ),
        answer(
          'I’ll track the release checks and keep policy decisions with you. The discount fix is ready for review; I’m checking the payment retry path next.'
        ),
        item({
          kind: 'thread_marker',
          action: 'started',
          threadId: 'review-tools',
          title: 'Validate discount-code regression',
        }),
        user('What is still blocking the release?'),
        answer(
          '## Checkout release\n\nThe discount regression is fixed and **24 tests pass**. Two things still need attention:\n\n- **Promotion stacking:** choose whether free shipping can combine with a percentage code.\n- **Payment retries:** the sandbox is offline, so the idempotency check is waiting.\n\nI’ve kept the [discount patch](https://github.com/jettpbaker/pr-lab/pull/1) ready for review. No production configuration has changed.'
        ),
      ],
      outcome: 'completed',
      minutes: 6,
    },
  ]
  mkdirSync(join(home, 'bots/review-checkout-bot'), { recursive: true })
  writeFileSync(
    join(home, 'bots/review-checkout-bot/instructions.md'),
    '# Checkout release\n\n- Keep all monetary calculations in integer cents.\n- Ask before changing promotion stacking policy.\n- Run checkout regressions before handing back a patch.\n'
  )
  const ids: Record<string, string> = {}
  try {
    const base = db
      .query('SELECT * FROM threads WHERE id = ?')
      .get(fixtures.threads.small) as Record<string, unknown>
    const baseStateRow = db
      .query('SELECT state_json FROM thread_states WHERE thread_id=?')
      .get(fixtures.threads.small) as { state_json: string }
    const baseState = JSON.parse(baseStateRow.state_json) as ThreadState
    const project = db.query('SELECT path FROM projects WHERE id=?').get(fixtures.projectId) as {
      path: string
    }
    const columns = Object.keys(base)
    const insert = db.query(
      `INSERT OR REPLACE INTO threads (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
    )
    db.transaction(() => {
      db.query('UPDATE projects SET title=?,icon=? WHERE id=?').run(
        'Storefront',
        JSON.stringify({ type: 'emoji', emoji: '🛍️' }),
        fixtures.projectId
      )
      db.query('INSERT INTO projects(id,path,title,icon,created_at) VALUES (?,?,?,?,?)').run(
        'review-analytics',
        join(project.path, '..', 'analytics'),
        'Analytics',
        JSON.stringify({ type: 'emoji', emoji: '📊' }),
        now - 86_400_000
      )
      db.query('INSERT INTO projects(id,path,title,created_at,bot_id) VALUES (?,?,?,?,?)').run(
        'review-checkout-bot',
        join(home, 'bots/review-checkout-bot'),
        'Checkout',
        now,
        'review-checkout-bot'
      )
      db.query('DELETE FROM thread_pull_requests').run()
      db.query("INSERT OR REPLACE INTO settings(key,value_json) VALUES ('branchPrefix',?)").run(
        JSON.stringify('jetty')
      )
      for (const fixture of states) {
        const id = fixture.id ?? `review-${fixture.name.replaceAll(' ', '-')}`
        const endedAt = Date.now() - (fixture.minutes ?? 2) * 60_000
        const startedAt = endedAt - 82_000
        let turnIndex = -1
        const turnDuration =
          82_000 /
          Math.max(1, fixture.items.filter((entry) => entry.kind === 'user_message').length)
        const items = fixture.items.map((entry) => {
          if (entry.kind === 'user_message') turnIndex++
          const createdAt = Math.round(startedAt + Math.max(0, turnIndex) * turnDuration)
          return {
            ...entry,
            turnId: `${id}-turn-${Math.max(0, turnIndex)}`,
            createdAt,
            ...(entry.completedAt === undefined
              ? {}
              : {
                  completedAt: Math.round(
                    createdAt + Math.min(entry.completedAt - entry.createdAt, turnDuration - 1000)
                  ),
                }),
          }
        })
        const status =
          fixture.status ??
          (['approval', 'question'].includes(fixture.name)
            ? 'awaiting_approval'
            : fixture.outcome === 'failed' || fixture.outcome === 'server_restarted'
              ? 'error'
              : 'idle')
        const state = Schema.decodeUnknownSync(ThreadState)({
          ...emptyThread,
          items,
          status,
          lastSeq: 1,
          context: baseState.context,
          turnLoadouts: Object.fromEntries(
            items.map((entry) => [
              entry.turnId,
              { provider: 'claude', model: 'claude-opus-4-6', effort: 'high', fast: false },
            ])
          ),
          lastTurnOutcome: fixture.outcome ?? null,
          turnOutcomes: fixture.outcome
            ? Object.fromEntries(items.map((entry) => [entry.turnId, fixture.outcome]))
            : {},
        })
        const row = {
          ...base,
          id,
          project_id:
            fixture.name === 'bot'
              ? 'review-checkout-bot'
              : (fixture.projectId ?? fixtures.projectId),
          title: fixture.title,
          status,
          environment: fixture.worktree ? 'worktree' : 'local',
          worktree_json: fixture.worktree
            ? JSON.stringify({
                checkoutPath: null,
                baseCommit: 'main',
                branch: 'jetty/express-checkout',
                temporaryBranch: null,
                slot: 1,
                state: fixture.worktree,
                error:
                  fixture.worktree === 'failed'
                    ? 'Dependency install failed: payment-sdk registry request timed out.'
                    : fixture.worktree === 'stopped'
                      ? 'Worktree setup was interrupted.'
                      : null,
              })
            : null,
          parent_thread_id: fixture.parentId ?? null,
          lineage_depth: fixture.parentId ? 1 : 0,
          bot_id: ['bot', 'tools'].includes(fixture.name) ? 'review-checkout-bot' : null,
          pinned: fixture.pinned ? 1 : 0,
          ready_for_review: 0,
          updated_at: endedAt,
          turn_started_at: startedAt,
          turn_ended_at: status === 'running' || status === 'starting' ? null : endedAt,
          agent_session_id: null,
          queue_paused: fixture.name === 'worktree setting_up' ? 0 : 1,
          pending_messages: JSON.stringify(
            (fixture.queue ?? []).map((text, index) => ({
              id: `review-queue-${index}`,
              text,
              createdAt: now,
              hop: 0,
            }))
          ),
        }
        insert.run(
          ...columns.map((column) => row[column as keyof typeof row] as string | number | null)
        )
        db.query('DELETE FROM thread_events WHERE thread_id=?').run(id)
        db.query('DELETE FROM thread_items WHERE thread_id=?').run(id)
        db.query(
          'INSERT OR REPLACE INTO thread_states (thread_id,state_json,last_seq,items_stored) VALUES (?,?,?,0)'
        ).run(id, JSON.stringify(state), 1)
        if (fixture.pr) {
          db.query(
            "INSERT OR IGNORE INTO pull_requests(repo,number) VALUES ('jettpbaker/pr-lab',?)"
          ).run(fixture.pr)
          db.query(
            "INSERT INTO thread_pull_requests(thread_id,repo,number,linked_at) VALUES (?,'jettpbaker/pr-lab',?,?)"
          ).run(id, fixture.pr, now)
        }
        for (const entry of fixture.items) {
          if (entry.kind !== 'user_message') continue
          for (const meta of entry.attachments)
            db.query(
              'INSERT OR REPLACE INTO attachment_refs(thread_id,attachment_id,metadata_json) VALUES (?,?,?)'
            ).run(id, meta.id, JSON.stringify(meta))
        }
        ids[fixture.name] = id
      }
      db.query(
        `INSERT INTO bots(id,name,shape,color,provider,model,effort,fast,project_id,permission_mode,created_at,seen_at,check_ins) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        'review-checkout-bot',
        'Checkout',
        'flower',
        'mint',
        'claude',
        'claude-opus-4-6',
        'high',
        0,
        fixtures.projectId,
        'auto',
        now - 86_400_000,
        now,
        0
      )
      for (const [index, title, status, note] of [
        [
          0,
          'Ship the discount-code fix',
          'in_progress',
          '24 tests pass; waiting for final review.',
        ],
        [
          1,
          'Verify payment retry idempotency',
          'todo',
          'Resume when the local sandbox is available.',
        ],
        [
          2,
          'Decide promotion stacking policy',
          'todo',
          'Free shipping plus percentage discounts needs a decision.',
        ],
        [3, 'Audit tax rounding', 'done', 'Integer cents verified across all checkout paths.'],
      ] as const)
        db.query(
          'INSERT INTO bot_tasks(id,bot_id,title,status,note,created_at,updated_at,closed_at) VALUES (?,?,?,?,?,?,?,?)'
        ).run(
          `review-task-${index}`,
          'review-checkout-bot',
          title,
          status,
          note,
          now,
          now,
          status === 'done' ? now : null
        )
    })()
    return ids
  } finally {
    db.close()
  }
}
