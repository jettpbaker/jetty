import {
  AgentTool,
  AssistantMessage,
  ContextGroup,
  Reasoning,
  ThinkingStatus,
  ToolError,
  UserMessage,
} from '@/components/agent-ui'
import { Response } from '@/components/response'
import type { ReactNode } from 'react'

function LabLabel({ name }: { name: string }) {
  return (
    <div className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
      {name}
    </div>
  )
}

function LabSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <LabLabel name={title} />
        {note ? <p className='max-w-2xl text-sm text-muted-foreground'>{note}</p> : null}
      </div>
      <div className='flex flex-col gap-3 rounded-lg border bg-card/40 p-4'>{children}</div>
    </section>
  )
}

function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3'>
      <div className='pt-1 text-xs text-muted-foreground'>{label}</div>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}

function ThinkingLab() {
  return (
    <LabSection
      title='thinking status'
      note='Busy-only row. Not the durable CoT — just “I’m working” with an optional topic scraped from reasoning headings.'
    >
      <StateRow label='plain'>
        <ThinkingStatus />
      </StateRow>
      <StateRow label='+ topic'>
        <ThinkingStatus topic='Websocket reconnect flakiness' />
      </StateRow>
      <StateRow label='long topic'>
        <ThinkingStatus topic='Whether to virtualize the timeline or keep one SessionTurn tree' />
      </StateRow>
    </LabSection>
  )
}

function ReasoningLab() {
  return (
    <LabSection
      title='reasoning'
      note='Opt-in durable chain-of-thought. Streaming starts open with shimmer; done collapses to a short duration line. Body is de-emphasized.'
    >
      <StateRow label='streaming'>
        <Reasoning status='streaming' topic='Tool layout' defaultOpen>
          Looking at how sparse pending tool rows should feel — hide paths and args until the call
          finishes so the list doesn’t thrash while input streams in.
        </Reasoning>
      </StateRow>
      <StateRow label='done · open'>
        <Reasoning status='done' durationSec={4} defaultOpen>
          Group consecutive reads and greps into one “gathering context” accordion. Keep bash and
          edits as first-class rows — those are high signal.
        </Reasoning>
      </StateRow>
      <StateRow label='done · closed'>
        <Reasoning status='done' durationSec={12} defaultOpen={false}>
          Hidden by default after the turn finishes. Expand if you care.
        </Reasoning>
      </StateRow>
    </LabSection>
  )
}

function ToolLab() {
  return (
    <LabSection
      title='agent tool'
      note='Shared chrome: shimmer + locked while running; expandable body only when complete. Kind picks icon, not a different shell.'
    >
      <StateRow label='running'>
        <AgentTool kind='read' status='running' title='Reading session/timeline.ts' />
      </StateRow>
      <StateRow label='read · done'>
        <AgentTool kind='read' status='completed' title='Read' subtitle='client/src/state/timeline.ts'>
          {`1  export function createTimelineStore(…)\n2  // … 248 lines`}
        </AgentTool>
      </StateRow>
      <StateRow label='search · done'>
        <AgentTool kind='search' status='completed' title='Grep' subtitle='"tool_call" · 6 matches'>
          {`shared/src/items.ts:41:  | { kind: 'tool_call'; … }\nclient/src/components/timeline-item.tsx:121: case 'tool_call':`}
        </AgentTool>
      </StateRow>
      <StateRow label='edit · done'>
        <AgentTool
          kind='edit'
          status='completed'
          title='Edit'
          subtitle='timeline-item.tsx · +12 −4'
          defaultOpen
        >
          {`@@ -120,6 +120,14 @@\n-  <Tool>…</Tool>\n+  <AgentTool kind="…">…</AgentTool>`}
        </AgentTool>
      </StateRow>
      <StateRow label='shell · done'>
        <AgentTool kind='shell' status='completed' title='Bash' subtitle='bun run typecheck' defaultOpen>
          {`$ bun run typecheck\ntsc --noEmit\n✓ clean`}
        </AgentTool>
      </StateRow>
      <StateRow label='generic'>
        <AgentTool kind='generic' status='completed' title='Called weather' subtitle='Sydney' />
      </StateRow>
    </LabSection>
  )
}

function ContextGroupLab() {
  return (
    <LabSection
      title='context group'
      note='Fold noisy read/search/list runs into one summary. Expand for the compact nested list.'
    >
      <StateRow label='running'>
        <ContextGroup
          status='running'
          counts={[
            { label: 'reads', count: 2 },
            { label: 'searches', count: 1 },
          ]}
          defaultOpen
        >
          <AgentTool kind='read' status='running' title='Reading items.ts' />
          <AgentTool kind='read' status='completed' title='Read' subtitle='reducer.ts' />
          <AgentTool kind='search' status='running' title='Grepping tool_call' />
        </ContextGroup>
      </StateRow>
      <StateRow label='done'>
        <ContextGroup
          status='completed'
          counts={[
            { label: 'reads', count: 3 },
            { label: 'searches', count: 2 },
          ]}
        >
          <AgentTool kind='read' status='completed' title='Read' subtitle='items.ts' />
          <AgentTool kind='read' status='completed' title='Read' subtitle='reducer.ts' />
          <AgentTool kind='read' status='completed' title='Read' subtitle='timeline.ts' />
          <AgentTool kind='search' status='completed' title='Grep' subtitle='"tool_call"' />
          <AgentTool kind='search' status='completed' title='Grep' subtitle='"reasoning"' />
        </ContextGroup>
      </StateRow>
    </LabSection>
  )
}

function ErrorLab() {
  return (
    <LabSection
      title='tool error'
      note='Separate surface from success chrome — title + short summary, detail on expand.'
    >
      <StateRow label='summary only'>
        <ToolError tool='Bash' summary='command exited with code 1' />
      </StateRow>
      <StateRow label='+ detail'>
        <ToolError
          tool='Edit'
          summary='file not found'
          detail={'ENOENT: no such file or directory\nopen client/src/components/timeline-v2.tsx'}
          defaultOpen
        />
      </StateRow>
    </LabSection>
  )
}

function MessageLab() {
  return (
    <LabSection
      title='messages'
      note='User is a right bubble (plain text). Assistant is full-width prose with quiet mono meta.'
    >
      <UserMessage>Can you tighten the tool rows so pending ones don’t thrash?</UserMessage>
      <AssistantMessage meta='jetty · claude · 8s'>
        <Response>
          {`Yes. While a tool is running we only shimmer the title — no path, args, or expand chevron until it completes. That matches the “act sparse, reveal on settle” rule.`}
        </Response>
      </AssistantMessage>
    </LabSection>
  )
}

function ComposedTurnLab() {
  return (
    <LabSection
      title='composed turn'
      note='One user turn as it might land in the real timeline: status → context group → tools → reasoning (opt-in) → reply.'
    >
      <div className='flex flex-col gap-3'>
        <UserMessage>
          Why does the websocket reconnect flake, and can we make the agent UI less noisy while it
          digs?
        </UserMessage>

        <ThinkingStatus topic='Reconnect race in socket.ts' />

        <ContextGroup
          status='completed'
          counts={[
            { label: 'reads', count: 3 },
            { label: 'searches', count: 2 },
          ]}
        >
          <AgentTool kind='read' status='completed' title='Read' subtitle='client/src/socket.ts' />
          <AgentTool kind='read' status='completed' title='Read' subtitle='client/src/state/timeline.ts' />
          <AgentTool kind='read' status='completed' title='Read' subtitle='server/src/ws.ts' />
          <AgentTool kind='search' status='completed' title='Grep' subtitle='"reconnect"' />
          <AgentTool kind='search' status='completed' title='Grep' subtitle='"lastSeq"' />
        </ContextGroup>

        <AgentTool kind='shell' status='completed' title='Bash' subtitle='bun test client' defaultOpen>
          {`$ bun test client\n 42 pass · 0 fail`}
        </AgentTool>

        <Reasoning status='done' durationSec={6} defaultOpen={false}>
          Race: subscribe before the hello ack lands, so the first catch-up patch is dropped. UI
          noise is a separate problem — group context tools and keep pending rows title-only.
        </Reasoning>

        <AssistantMessage meta='jetty · claude · 18s'>
          <Response>
            {`Two fixes:

1. **Reconnect** — wait for the hello ack before opening thread subscriptions, and re-request catch-up from \`lastSeq\` after every open.
2. **Agent UI** — fold consecutive reads/greps into a single “gathered context” row, and keep tool rows sparse until they finish.

I can land both in one pass if you want.`}
          </Response>
        </AssistantMessage>
      </div>
    </LabSection>
  )
}

function LiveBusyTurnLab() {
  return (
    <LabSection
      title='live busy turn'
      note='What the same turn looks like mid-flight: thinking visible, context still gathering, no reply yet.'
    >
      <div className='flex flex-col gap-3'>
        <UserMessage>Ship a denser tool timeline, OpenCode-inspired but Jetty.</UserMessage>
        <ThinkingStatus topic='Scaffolding agent-ui lab' />
        <ContextGroup
          status='running'
          counts={[
            { label: 'reads', count: 2 },
            { label: 'searches', count: 1 },
          ]}
          defaultOpen
        >
          <AgentTool kind='read' status='completed' title='Read' subtitle='styleguide.tsx' />
          <AgentTool kind='read' status='running' title='Reading agent-ui components' />
          <AgentTool kind='search' status='completed' title='Grep' subtitle='"AgentTool"' />
        </ContextGroup>
        <AgentTool kind='edit' status='running' title='Editing styleguide.tsx' />
      </div>
    </LabSection>
  )
}

export function AgentUiLab() {
  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-12 p-8'>
      <header className='flex flex-col gap-2'>
        <h1 className='text-2xl font-semibold tracking-tight'>Agent UI lab</h1>
        <p className='max-w-2xl text-sm text-muted-foreground'>
          Jetty components for agent actions — thinking, reasoning, tools, errors, messages.
          Inspired by OpenCode’s density and status/content split, not a port. Lab-only for now;
          wire into the real timeline once the shapes feel right.
        </p>
      </header>

      <ComposedTurnLab />
      <LiveBusyTurnLab />
      <ThinkingLab />
      <ReasoningLab />
      <ToolLab />
      <ContextGroupLab />
      <ErrorLab />
      <MessageLab />
    </div>
  )
}
