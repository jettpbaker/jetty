import type { ThreadItem } from '@jetty/shared/items'

import { ProjectBadge } from '@/components/project-badge'
import { RansomWordmark, RansomWordmarkStatic } from '@/components/ransom-wordmark'
import { TimelineItem } from '@/components/timeline-item'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { InputGroup } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PlusIcon, XIcon } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

export const Route = createFileRoute('/styleguide')({
  component: StyleguidePage,
})

const SECTION_LABEL =
  'font-mono text-[10px] uppercase tracking-widest text-muted-foreground'

// Replicated from composer.tsx (not exported).
const composerShell =
  'rounded-lg [&_[data-slot=input-group]]:bg-[#191A1B]! [&_[data-slot=input-group]]:ring-0! [&_[data-slot=input-group]]:border-border! [&_[data-slot=input-group]]:focus-within:border-white/25!'

// Replicated from tab-bar.tsx statusDotClass.
function statusDotClass(status: 'idle' | 'running' | 'awaiting_approval' | 'error'): string {
  switch (status) {
    case 'running':
      return 'animate-pulse bg-primary'
    case 'awaiting_approval':
      return 'bg-primary'
    case 'error':
      return 'bg-destructive'
    case 'idle':
      return 'bg-muted-foreground/40'
  }
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const BUTTON_VARIANTS = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
] as const

const BUTTON_SIZES = ['sm', 'default', 'lg', 'icon'] as const

const COLOR_SWATCHES = [
  { label: '#121314 canvas', className: 'bg-[#121314]', caption: '#121314' },
  { label: '#191A1B composer', className: 'bg-[#191A1B]', caption: '#191A1B' },
  { label: '#2B2C2D active tab', className: 'bg-[#2B2C2D]', caption: '#2B2C2D' },
  { label: 'border', className: 'bg-border', caption: 'border' },
  { label: 'secondary', className: 'bg-secondary', caption: 'secondary' },
  { label: 'muted', className: 'bg-muted', caption: 'muted' },
  { label: 'primary', className: 'bg-primary', caption: 'primary' },
  { label: 'destructive', className: 'bg-destructive', caption: 'destructive' },
] as const

const STATUS_DOTS = [
  'idle',
  'running',
  'awaiting_approval',
  'error',
] as const

const THREAD_ID = 'styleguide'
const BASE = { turnId: 'turn-1', createdAt: 1_700_000_000_000 } as const

const userMessage = {
  ...BASE,
  id: 'user-1',
  kind: 'user_message',
  text: 'Can you sketch a styleguide page for the app chrome?',
  attachments: [],
} satisfies ThreadItem

const assistantMessage = {
  ...BASE,
  id: 'assistant-1',
  kind: 'assistant_message',
  text: `Sure — here's a compact gallery layout.

First pass: swatches, wordmark, badges, then interactive chrome.

\`\`\`tsx
export const Route = createFileRoute('/styleguide')({
  component: StyleguidePage,
})
\`\`\`

Keep fixtures typed against \`ThreadItem\` so nothing drifts.`,
} satisfies ThreadItem

const toolRunning = {
  ...BASE,
  id: 'tool-running',
  kind: 'tool_call',
  toolName: 'Bash',
  input: { command: 'ls -la client/src/components' },
  output: '',
  status: 'running',
} satisfies ThreadItem

const toolCompleted = {
  ...BASE,
  id: 'tool-done',
  kind: 'tool_call',
  toolName: 'Read',
  input: { path: 'client/src/components/tab-bar.tsx' },
  output: 'export function TabBar() { … }',
  status: 'succeeded',
} satisfies ThreadItem

const approvalPending = {
  ...BASE,
  id: 'approval-pending',
  kind: 'approval',
  title: 'Claude wants to write client/src/routes/styleguide.tsx',
  toolName: 'Write',
  input: { path: 'client/src/routes/styleguide.tsx' },
  suggestions: [],
} satisfies ThreadItem

const approvalDecided = {
  ...BASE,
  id: 'approval-decided',
  kind: 'approval',
  title: 'Claude wants to run bun run typecheck',
  toolName: 'Bash',
  input: { command: 'bun run typecheck' },
  suggestions: [],
  decision: 'allow',
} satisfies ThreadItem

const TIMELINE_EXAMPLES: Array<{ caption: string; item: ThreadItem }> = [
  { caption: 'user_message', item: userMessage },
  { caption: 'assistant_message', item: assistantMessage },
  { caption: 'tool_call · running', item: toolRunning },
  { caption: 'tool_call · succeeded', item: toolCompleted },
  { caption: 'approval · pending (buttons are live)', item: approvalPending },
  { caption: 'approval · decided', item: approvalDecided },
]

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-4'>
      <h2 className={SECTION_LABEL}>{label}</h2>
      {children}
    </section>
  )
}

function Example({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className='flex flex-col items-start gap-1.5'>
      {children}
      <span className='text-xs text-muted-foreground'>{caption}</span>
    </div>
  )
}

function TabPill({
  state,
  className,
}: {
  state: 'active' | 'inactive' | 'inactive-hover'
  className: string
}) {
  return (
    <Example caption={state}>
      <div
        className={`group relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm ${className}`}
      >
        <ProjectBadge title='J' />
        <span className='pointer-events-none relative max-w-40 truncate'>Thread title</span>
        <span className='relative z-10 -mr-1 rounded-sm p-0.5 text-muted-foreground'>
          <XIcon className='size-3.5' />
        </span>
      </div>
    </Example>
  )
}

function StyleguidePage() {
  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-4xl flex-col gap-12 p-8'>
        <h1 className='text-2xl font-medium'>Styleguide</h1>

        <Section label='Colors'>
          <div className='flex flex-wrap gap-4'>
            {COLOR_SWATCHES.map((swatch) => (
              <Example key={swatch.label} caption={swatch.caption}>
                <div
                  className={`size-14 rounded-md border border-border ${swatch.className}`}
                  title={swatch.label}
                />
              </Example>
            ))}
          </div>
        </Section>

        <Section label='Wordmark'>
          <div className='flex flex-wrap items-end gap-10'>
            <Example caption='RansomWordmark · lineH 112'>
              <RansomWordmark lineH={112} />
            </Example>
            <Example caption='RansomWordmarkStatic · default'>
              <RansomWordmarkStatic />
            </Example>
          </div>
        </Section>

        <Section label='Project badges'>
          <div className='flex flex-wrap gap-3'>
            {LETTERS.map((letter) => (
              <Example key={letter} caption={letter}>
                <div className='flex h-8 w-8 items-center justify-center rounded-md border border-border'>
                  <ProjectBadge title={letter} />
                </div>
              </Example>
            ))}
            <Example caption='fallback 7'>
              <div className='flex h-8 w-8 items-center justify-center rounded-md border border-border'>
                <ProjectBadge title='7' />
              </div>
            </Example>
          </div>
        </Section>

        <Section label='Buttons'>
          <div className='flex flex-col gap-6'>
            {BUTTON_VARIANTS.map((variant) => (
              <div key={variant} className='flex flex-wrap items-end gap-4'>
                {BUTTON_SIZES.map((size) => (
                  <Example key={`${variant}-${size}`} caption={`${variant} · ${size}`}>
                    <Button variant={variant} size={size} aria-label={size === 'icon' ? variant : undefined}>
                      {size === 'icon' ? <PlusIcon /> : variant}
                    </Button>
                  </Example>
                ))}
              </div>
            ))}
            <Example caption='disabled'>
              <Button disabled>Disabled</Button>
            </Example>
          </div>
        </Section>

        <Section label='Tab pills'>
          <div className='flex flex-wrap gap-4'>
            <TabPill state='active' className='bg-[#2B2C2D] text-foreground' />
            <TabPill state='inactive' className='text-muted-foreground' />
            <TabPill state='inactive-hover' className='bg-secondary/50 text-muted-foreground' />
          </div>
        </Section>

        <Section label='Status dots'>
          <div className='flex flex-wrap gap-6'>
            {STATUS_DOTS.map((status) => (
              <Example key={status} caption={status}>
                <span className={`size-2.5 rounded-full ${statusDotClass(status)}`} />
              </Example>
            ))}
          </div>
        </Section>

        <Section label='Composer shell'>
          <Example caption='inert shell + InputGroup'>
            <div className={`w-full max-w-xl ${composerShell}`}>
              <InputGroup className='h-auto min-h-16 items-start px-3 py-2.5'>
                <span className='text-sm text-muted-foreground'>Message the agent…</span>
              </InputGroup>
            </div>
          </Example>
        </Section>

        <Section label='Timeline items'>
          <div className='flex flex-col gap-8'>
            {TIMELINE_EXAMPLES.map(({ caption, item }) => (
              <Example key={item.id} caption={caption}>
                <div className='w-full max-w-xl'>
                  <TimelineItem item={item} threadId={THREAD_ID} />
                </div>
              </Example>
            ))}
          </div>
        </Section>

        <Section label='Feedback'>
          <div className='flex flex-wrap items-start gap-6'>
            <Example caption='toast'>
              <Button variant='outline' onClick={() => toast('Styleguide toast')}>
                toast
              </Button>
            </Example>
            <Example caption='toast.error'>
              <Button variant='outline' onClick={() => toast.error('Something went wrong')}>
                toast.error
              </Button>
            </Example>
            <Example caption='tooltip'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant='outline' size='sm'>
                      Hover me
                    </Button>
                  }
                />
                <TooltipContent>Tooltip content</TooltipContent>
              </Tooltip>
            </Example>
            <Example caption='dropdown menu'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant='outline' size='sm'>
                      Open menu
                    </Button>
                  }
                />
                <DropdownMenuContent>
                  <DropdownMenuItem>Archive</DropdownMenuItem>
                  <DropdownMenuItem>Rename</DropdownMenuItem>
                  <DropdownMenuItem variant='destructive'>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Example>
            <Example caption='context menu'>
              <ContextMenu>
                <ContextMenuTrigger className='flex h-20 w-40 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground'>
                  right-click me
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem>Close</ContextMenuItem>
                  <ContextMenuItem>Archive</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </Example>
            <Example caption='dialog'>
              <Dialog>
                <DialogTrigger
                  render={
                    <Button variant='outline' size='sm'>
                      Open dialog
                    </Button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Example dialog</DialogTitle>
                    <DialogDescription>A simple dialog for styleguide eyeballing.</DialogDescription>
                  </DialogHeader>
                </DialogContent>
              </Dialog>
            </Example>
          </div>
        </Section>

        <Section label='Empty state'>
          <Example caption='home empty composition'>
            <div className='w-full rounded-md border border-border'>
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Pick a thread to get started</EmptyTitle>
                </EmptyHeader>
              </Empty>
            </div>
          </Example>
        </Section>
      </div>
    </div>
  )
}
