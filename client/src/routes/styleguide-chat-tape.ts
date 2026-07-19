import type { ThreadEvent } from '@jetty/shared/events'
import type { ApprovalDecision, ThreadItem } from '@jetty/shared/items'

import { tokenize } from './styleguide-streaming-lab'

// A replayable transcript mined from the real session that built this
// styleguide: reads, greps, a failed install, a sandbox approval, streamed
// markdown. Compiled to wire-level ThreadEvents so replay exercises the real
// reducer, not just the components.

export type TapeStep = { delay: number; event: ThreadEvent }

type Beat =
  | { kind: 'reasoning'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool'
      toolName: string
      input: unknown
      output: string
      failed?: boolean
      runMs?: number
    }
  | {
      kind: 'approval'
      title: string
      toolName: string
      input: unknown
      decision: ApprovalDecision
      waitMs?: number
    }

type Turn = { prompt: string; beats: Beat[] }

const GATES_OUTPUT = `$ tsc --noEmit -p shared && tsc --noEmit -p server && tsc --noEmit -p client
$ oxlint`

const SCRIPT: Turn[] = [
  {
    prompt:
      'can you replace the content of our streaming mockup to show this please? and also have it stream in tokens at a realistic TPS',
    beats: [
      {
        kind: 'reasoning',
        text: `Streamdown 2.5 is already installed, so verify the animation API against the real package instead of trusting the research: AnimateOptions is animation / duration / easing / sep / stagger, gated by isAnimating. The lab wants pace presets pinned to real model speeds — Opus ~40 tok/s, Sonnet ~80, Haiku ~150 — with jittered batches and an occasional stall-and-burst so the stagger control has something honest to chew on.`,
      },
      {
        kind: 'tool',
        toolName: 'Read',
        input: { file_path: 'client/src/routes/styleguide-streaming-lab.tsx' },
        output: `1\timport { Button } from '@/components/ui/button'
2\timport { cn } from '@/lib/utils'
…
40\ttype StreamMode = 'raw' | 'fade' | 'blur' | 'lift' | 'heat' | 'paced' | 'word'
(666 lines — hand-rolled reveal modes over a fake bursty stream)`,
        runMs: 500,
      },
      {
        kind: 'tool',
        toolName: 'Bash',
        input: {
          command: "grep -n -i 'animat\\|stagger' node_modules/streamdown/dist/index.d.ts",
        },
        output: `29:interface AnimateOptions {
30:    animation?: "fadeIn" | "blurIn" | "slideUp" | (string & {});
31:    duration?: number;
32:    easing?: string;
33:    sep?: "word" | "char";
34:    stagger?: number;
35:}
423:    isAnimating?: boolean;
424:    animated?: boolean | AnimateOptions;`,
        runMs: 700,
      },
      {
        kind: 'tool',
        toolName: 'Write',
        input: { file_path: 'client/src/routes/styleguide-streaming-lab.tsx' },
        output:
          'Rewrote the lab: Streamdown with animated/isAnimating, animation and pacing controls, stall-and-burst fake stream.',
        runMs: 900,
      },
      {
        kind: 'tool',
        toolName: 'Bash',
        input: { command: 'bun run typecheck && bun run lint' },
        output: GATES_OUTPUT,
        runMs: 1600,
      },
      {
        kind: 'assistant',
        text: `Done — gates pass. The streaming lab now demos streamdown 2.5's built-in animation instead of the hand-rolled modes.

What's there:

- **Real Streamdown rendering** the same fake transcript — it gains a code fence specifically so you can see that code is excluded from the word animation: prose fades, code streams plain.
- **Animation pills** — Off / Fade / Blur / Slide up — plus duration and stagger sliders, easing pills, and word vs char granularity, with a copy-values button for handing configs back.
- **Realistic pacing** — tokens are ~BPE-sized pieces emitted in jittered batches, with pace presets at roughly real output speeds: **Opus ~40 / Sonnet ~80 / Haiku ~150 tok/s**. A ~3% stall chance per tick flushes as a burst afterwards, the way a buffered stream actually catches up.

When the stream finishes, \`isAnimating\` flips off and streamdown drops all the word spans — finished messages carry zero animation DOM.`,
      },
    ],
  },
  {
    prompt:
      'nice. can you just humor me for a moment and in the streaming lab set the font of normal text to gambarino',
    beats: [
      {
        kind: 'reasoning',
        text: `Gambarino isn't on npm — Fontshare only. Pull the woff2 from their CDN, self-host it next to the Geist Pixel scraps, and scope the font to the lab wrapper so nothing else changes. Tailwind preflight pins code and pre to the mono stack, so the serif won't leak into fences.`,
      },
      {
        kind: 'tool',
        toolName: 'Bash',
        input: { command: 'bun add @fontsource/gambarino' },
        output: `bun add v1.3.14 (0d9b296a)
Resolving dependencies
error: GET https://registry.npmjs.org/@fontsource%2fgambarino - 404`,
        failed: true,
        runMs: 1200,
      },
      {
        kind: 'assistant',
        text: `Not on npm — Gambarino is Fontshare-only. I'll pull the woff2 from Fontshare's CDN and self-host it next to Geist Pixel. The sandbox network allowlist won't cover fontshare, so this needs the override:`,
      },
      {
        kind: 'approval',
        title: 'Fetch Gambarino from Fontshare',
        toolName: 'Bash',
        input: { command: "curl -s 'https://api.fontshare.com/v2/css?f[]=gambarino@400'" },
        decision: 'allow',
        waitMs: 2200,
      },
      {
        kind: 'tool',
        toolName: 'Bash',
        input: { command: "curl -s 'https://api.fontshare.com/v2/css?f[]=gambarino@400'" },
        output: `/* Gambarino */
@font-face {
  font-family: 'Gambarino';
  src: url('//cdn.fontshare.com/wf/…/6KBHT5NXCZVM6GHTPKGIR6DXZLQAYIFK.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}`,
        runMs: 800,
      },
      {
        kind: 'tool',
        toolName: 'Edit',
        input: { file_path: 'client/src/styles.css' },
        output: 'Added the @font-face and applied Gambarino to the lab prose at 15px.',
        runMs: 400,
      },
      {
        kind: 'tool',
        toolName: 'Bash',
        input: { command: 'bun run typecheck && bun run lint' },
        output: GATES_OUTPUT,
        runMs: 1600,
      },
      {
        kind: 'assistant',
        text: `Humored — refresh the lab. Gambarino now carries the streamed prose; code fences stay Geist Mono since Tailwind's preflight pins \`code\`/\`pre\` to the mono stack.

For what it's worth, a serif rendering streamed agent output with the blur-in at Opus pace is... a look. Curious what you think of it.`,
      },
    ],
  },
  {
    prompt: 'ok yes i see the reason why no one does this now, lets go back to geist',
    beats: [
      {
        kind: 'tool',
        toolName: 'Edit',
        input: { file_path: 'client/src/styles.css' },
        output: 'Removed the @font-face, deleted the woff2, lab back to Geist at text-sm.',
        runMs: 500,
      },
      {
        kind: 'tool',
        toolName: 'Bash',
        input: { command: 'bun run typecheck && bun run lint' },
        output: GATES_OUTPUT,
        runMs: 1500,
      },
      {
        kind: 'assistant',
        text: `Reverted clean — the lab is back to Geist at text-sm, and I removed the whole experiment rather than leaving it dormant. Gates pass. There's a reason every agent UI on earth is a grotesque sans, but now we *know*.`,
      },
    ],
  },
]

const REASONING_TPS = 160
const ASSISTANT_TPS = 80

export function compileTape(): TapeStep[] {
  const steps: TapeStep[] = []
  let nextId = 0

  function push(delay: number, event: ThreadEvent) {
    steps.push({ delay, event })
  }

  function newItemId() {
    return `tape-item-${nextId++}`
  }

  function streamText(itemId: string, text: string, tps: number) {
    const tokens = tokenize(text)
    let i = 0
    while (i < tokens.length) {
      const delay = 30 + Math.random() * 20
      const count = Math.max(1, Math.round((tps * delay) / 1000))
      const next = Math.min(tokens.length, i + count)
      push(delay, { type: 'item.delta', itemId, delta: tokens.slice(i, next).join('') })
      i = next
    }
  }

  for (const [turnIndex, turn] of SCRIPT.entries()) {
    const turnId = `tape-turn-${turnIndex}`
    push(turnIndex === 0 ? 300 : 1000, {
      type: 'item.started',
      item: {
        id: newItemId(),
        turnId,
        createdAt: Date.now(),
        kind: 'user_message',
        text: turn.prompt,
        attachments: [],
      },
    })
    push(150, { type: 'turn.started', turnId })

    for (const beat of turn.beats) {
      const itemId = newItemId()
      switch (beat.kind) {
        case 'reasoning': {
          push(350, {
            type: 'item.started',
            item: {
              id: itemId,
              turnId,
              createdAt: Date.now(),
              kind: 'reasoning',
              text: '',
              streaming: true,
            },
          })
          streamText(itemId, beat.text, REASONING_TPS)
          push(80, { type: 'item.completed', itemId })
          break
        }
        case 'assistant': {
          push(400, {
            type: 'item.started',
            item: {
              id: itemId,
              turnId,
              createdAt: Date.now(),
              kind: 'assistant_message',
              text: '',
              streaming: true,
            },
          })
          streamText(itemId, beat.text, ASSISTANT_TPS)
          push(80, { type: 'item.completed', itemId })
          break
        }
        case 'tool': {
          push(300, {
            type: 'item.started',
            item: {
              id: itemId,
              turnId,
              createdAt: Date.now(),
              kind: 'tool_call',
              toolName: beat.toolName,
              input: beat.input,
              output: '',
              status: 'running',
            },
          })
          push(beat.runMs ?? 700, {
            type: 'item.completed',
            itemId,
            patch: { status: beat.failed ? 'failed' : 'succeeded', output: beat.output },
          })
          break
        }
        case 'approval': {
          push(300, {
            type: 'item.started',
            item: {
              id: itemId,
              turnId,
              createdAt: Date.now(),
              kind: 'approval',
              title: beat.title,
              toolName: beat.toolName,
              input: beat.input,
              suggestions: [],
            },
          })
          push(0, { type: 'session.status', status: 'awaiting_approval' })
          push(beat.waitMs ?? 1800, { type: 'item.completed', itemId, patch: { decision: beat.decision } })
          push(0, { type: 'session.status', status: 'running' })
          break
        }
      }
    }

    push(250, { type: 'turn.completed', turnId })
  }

  return steps
}

// --- spec sheet fixtures ----------------------------------------------------

const sheetBase = { turnId: 'sheet', createdAt: 0 }

type ToolCallItem = Extract<ThreadItem, { kind: 'tool_call' }>

function contextCall(
  id: string,
  toolName: 'Read' | 'Grep' | 'Glob',
  input: unknown,
  status: ToolCallItem['status'],
  output = '',
): ToolCallItem {
  return {
    id,
    ...sheetBase,
    kind: 'tool_call',
    toolName,
    input,
    output,
    status,
  }
}

const READ_OUTPUT = `1\timport type { ThreadItem } from '@jetty/shared/items'
2\t
3\texport function ToolRow({ item }: { item: ToolCallItem }) {`

const GREP_OUTPUT = `client/src/components/tool-row.tsx
  242:export function ToolRow({ item }: { item: ToolCallItem }) {
client/src/components/context-group.tsx
  12:export function isContextCall(item: ThreadItem): item is ToolCallItem {`

const GLOB_OUTPUT = `client/src/components/tool-row.tsx
client/src/components/context-group.tsx
client/src/components/timeline.tsx`

export type ContextScenario = { label: string; items: ToolCallItem[]; live?: boolean }

export const CONTEXT_SCENARIOS: ContextScenario[] = [
  {
    label: 'running · first read',
    items: [
      contextCall('ctx-run-1', 'Read', { file_path: 'client/src/components/response.tsx' }, 'running'),
    ],
  },
  {
    label: 'running · mid group',
    items: [
      contextCall(
        'ctx-mid-1',
        'Read',
        { file_path: 'client/src/components/tool-row.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-mid-2',
        'Read',
        { file_path: 'client/src/components/timeline.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-mid-3',
        'Read',
        { file_path: 'client/src/components/context-group.tsx' },
        'running',
      ),
    ],
  },
  {
    label: 'holding · between calls',
    live: true,
    items: [
      contextCall(
        'ctx-hold-1',
        'Read',
        { file_path: 'client/src/components/tool-row.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-hold-2',
        'Read',
        { file_path: 'client/src/components/timeline.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
    ],
  },
  {
    label: 'running · search',
    items: [
      contextCall(
        'ctx-search-1',
        'Read',
        { file_path: 'client/src/lib/press-handlers.ts' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-search-2',
        'Grep',
        { pattern: 'pressHandlers', path: 'client/src' },
        'running',
      ),
    ],
  },
  {
    label: 'settled · single read',
    items: [
      contextCall(
        'ctx-single-1',
        'Read',
        { file_path: 'client/src/components/response.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
    ],
  },
  {
    label: 'settled · reads',
    items: [
      contextCall(
        'ctx-reads-1',
        'Read',
        { file_path: 'client/src/components/tool-row.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-reads-2',
        'Read',
        { file_path: 'client/src/components/timeline.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-reads-3',
        'Read',
        { file_path: 'client/src/components/context-group.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
    ],
  },
  {
    label: 'settled · mixed',
    items: [
      contextCall(
        'ctx-mixed-1',
        'Read',
        { file_path: 'client/src/components/tool-row.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-mixed-2',
        'Read',
        { file_path: 'client/src/components/timeline.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-mixed-3',
        'Read',
        { file_path: 'client/src/components/response.tsx' },
        'succeeded',
        READ_OUTPUT,
      ),
      contextCall(
        'ctx-mixed-4',
        'Grep',
        { pattern: 'groupTimeline', path: 'client/src' },
        'succeeded',
        GREP_OUTPUT,
      ),
      contextCall(
        'ctx-mixed-5',
        'Grep',
        { pattern: 'CONTEXT_TOOLS', path: 'client/src' },
        'succeeded',
        GREP_OUTPUT,
      ),
      contextCall(
        'ctx-mixed-6',
        'Glob',
        { pattern: 'client/src/components/*.tsx' },
        'succeeded',
        GLOB_OUTPUT,
      ),
    ],
  },
]

// Fixture for the Approval dock lab section — the live dock renders from a real
// approval item, so it takes the same shape the wire delivers.
export const DOCK_APPROVAL: Extract<ThreadItem, { kind: 'approval' }> = {
  id: 'dock-approval',
  ...sheetBase,
  kind: 'approval',
  title: 'Fetch Gambarino from Fontshare',
  toolName: 'Bash',
  input: { command: "curl -s 'https://api.fontshare.com/v2/css?f[]=gambarino@400'" },
  suggestions: [],
}

export type SheetEntry = { label: string; item: ThreadItem }

export const SHEET_GROUPS: Array<{ title: string; entries: SheetEntry[] }> = [
  {
    title: 'Messages',
    entries: [
      {
        label: 'user message',
        item: {
          id: 'sheet-user',
          ...sheetBase,
          kind: 'user_message',
          text: 'can we bump the 16px app padding to 32px?',
          attachments: [],
        },
      },
      {
        label: 'assistant message',
        item: {
          id: 'sheet-assistant',
          ...sheetBase,
          kind: 'assistant_message',
          text: `Blur is the most expensive of the three, but at word granularity it's fine:

- \`filter\` and \`opacity\` are both compositor-animatable — the animation runs on the GPU.
- Streamdown zeroes the duration on everything already visible, so only newly-arrived words animate.
- The stress case is a stall-burst at Haiku pace with \`sep: 'char'\` — a config we'd never ship.

Custom keyframes are supported but prefixed:

\`\`\`css
@keyframes sd-softBlur {
  from { opacity: 0; filter: blur(2px); }
}
\`\`\``,
        },
      },
      {
        label: 'reasoning · streaming',
        item: {
          id: 'sheet-reasoning-streaming',
          ...sheetBase,
          kind: 'reasoning',
          text: 'Gambarino isn’t on npm — Fontshare only. Pull the woff2 from their CDN, self-host it next to the',
          streaming: true,
        },
      },
      {
        label: 'reasoning · settled',
        item: {
          id: 'sheet-reasoning',
          ...sheetBase,
          kind: 'reasoning',
          text: 'Gambarino isn’t on npm — Fontshare only. Pull the woff2 from their CDN, self-host it next to the Geist Pixel scraps, and scope the font to the lab wrapper so nothing else changes.',
        },
      },
    ],
  },
  {
    title: 'Tool calls',
    entries: [
      {
        label: 'running',
        item: {
          id: 'sheet-tool-running',
          ...sheetBase,
          kind: 'tool_call',
          toolName: 'Bash',
          input: { command: 'bun run typecheck && bun run lint' },
          output: '',
          status: 'running',
        },
      },
      {
        label: 'succeeded',
        item: {
          id: 'sheet-tool-ok',
          ...sheetBase,
          kind: 'tool_call',
          toolName: 'Read',
          input: { file_path: 'client/src/components/response.tsx' },
          output: `1\timport { Streamdown } from 'streamdown'
2\t
3\texport const Response = memo(…)`,
          status: 'succeeded',
        },
      },
      {
        label: 'failed',
        item: {
          id: 'sheet-tool-failed',
          ...sheetBase,
          kind: 'tool_call',
          toolName: 'Bash',
          input: { command: 'bun add @fontsource/gambarino' },
          output: 'error: GET https://registry.npmjs.org/@fontsource%2fgambarino - 404',
          status: 'failed',
        },
      },
      {
        label: 'grep',
        item: {
          id: 'sheet-tool-grep',
          ...sheetBase,
          kind: 'tool_call',
          toolName: 'Grep',
          input: {
            pattern: 'pressHandlers',
            path: 'client/src',
          },
          output: `client/src/lib/press-handlers.ts
  6:export function pressHandlers(run: () => void) {
client/src/components/tab-bar.tsx
  15:import { pressHandlers } from '@/lib/press-handlers'
client/src/routes/index.tsx
  6:import { pressHandlers } from '@/lib/press-handlers'`,
          status: 'succeeded',
        },
      },
      {
        label: 'bash succeeded',
        item: {
          id: 'sheet-tool-bash-ok',
          ...sheetBase,
          kind: 'tool_call',
          toolName: 'Bash',
          input: { command: 'bun run typecheck && bun run lint' },
          output: `$ tsc --noEmit
$ oxlint .

Found 0 warnings and 0 errors.`,
          status: 'succeeded',
        },
      },
      {
        label: 'mcp fallback',
        item: {
          id: 'sheet-tool-mcp',
          ...sheetBase,
          kind: 'tool_call',
          toolName: 'mcp__railway__get_logs',
          input: {
            service: 'jetty',
            description: 'Fetch recent deploy logs',
          },
          output: `[info] deployment abc123 started
[info] health check passed
[info] deployment ready`,
          status: 'succeeded',
        },
      },
    ],
  },
  {
    title: 'Approvals',
    entries: [
      {
        label: 'pending',
        item: {
          id: 'sheet-approval-pending',
          ...sheetBase,
          kind: 'approval',
          title: 'Fetch Gambarino from Fontshare',
          toolName: 'Bash',
          input: { command: "curl -s 'https://api.fontshare.com/v2/css?f[]=gambarino@400'" },
          suggestions: [],
        },
      },
      {
        label: 'allowed',
        item: {
          id: 'sheet-approval-allowed',
          ...sheetBase,
          kind: 'approval',
          title: 'Fetch Gambarino from Fontshare',
          toolName: 'Bash',
          input: { command: "curl -s 'https://api.fontshare.com/v2/css?f[]=gambarino@400'" },
          suggestions: [],
          decision: 'allow',
        },
      },
      {
        label: 'denied',
        item: {
          id: 'sheet-approval-denied',
          ...sheetBase,
          kind: 'approval',
          title: 'Delete node_modules and reinstall',
          toolName: 'Bash',
          input: { command: 'rm -rf node_modules && bun install' },
          suggestions: [],
          decision: 'deny',
        },
      },
      {
        label: 'denied · with message',
        item: {
          id: 'sheet-approval-denied-message',
          ...sheetBase,
          kind: 'approval',
          title: 'Delete node_modules and reinstall',
          toolName: 'Bash',
          input: { command: 'rm -rf node_modules && bun install' },
          suggestions: [],
          decision: 'deny',
          deniedReason: 'Just clear the bun cache instead — don’t nuke node_modules.',
        },
      },
    ],
  },
  {
    title: 'Plan + error',
    entries: [
      {
        label: 'plan',
        item: {
          id: 'sheet-plan',
          ...sheetBase,
          kind: 'plan',
          text: `1. **Gate subscriptions on hello** — don't open a thread until the server confirms.
2. **Re-request catch-up after every open** — resume from the last known seq.
3. **Coalesce bursts** — batch apply per frame so React doesn't thrash.`,
        },
      },
      {
        label: 'error',
        item: { id: 'sheet-error', ...sheetBase, kind: 'error', message: 'stream ended' },
      },
    ],
  },
]
