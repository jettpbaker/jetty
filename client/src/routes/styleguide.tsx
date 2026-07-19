import { RansomWordmarkStatic } from '@/components/ransom-wordmark'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  BellRingingIcon,
  ExclamationMarkIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  MoonIcon,
  PlusIcon,
  SpinnerIcon,
  XIcon,
} from '@phosphor-icons/react'
import { pressHandlers } from '@/lib/press-handlers'
import { useStripDrag } from '@/lib/use-strip-drag'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useRef, useState } from 'react'
import { ChatLab } from './styleguide-chat-lab'
import { ComposerLab } from './styleguide-composer-lab'
import { DiffsLab } from './styleguide-diffs-lab'
import { StreamingLab } from './styleguide-streaming-lab'

export const Route = createFileRoute('/styleguide')({
  component: StyleguidePage,
})

// The decided tab design: canonical states, their glyphs, and the pill.
// Exploration racks lived here during the design pass; git has them.

type TabState =
  | 'sleeping'
  | 'running'
  | 'awaiting_approval'
  | 'error'
  | 'draft'
  | 'open'
  | 'merged'

const CURRENT_STATES: TabState[] = ['sleeping', 'running', 'awaiting_approval', 'error']
// need thread→PR association before the bar can show these
const PR_STATES: TabState[] = ['draft', 'open', 'merged']
const SAMPLE_TITLE = 'Vue perf exploration'

function StateGlyph({ state }: { state: TabState }) {
  switch (state) {
    case 'sleeping':
      return (
        <MoonIcon
          weight='fill'
          className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60'
        />
      )
    case 'running':
      return <SpinnerIcon className='size-[18px] shrink-0 animate-spin text-muted-foreground' />
    case 'awaiting_approval':
      return <BellRingingIcon className='size-[18px] shrink-0 text-amber-400' />
    case 'error':
      return <ExclamationMarkIcon className='size-[18px] shrink-0 text-destructive' />
    case 'draft':
      return <GitPullRequestIcon className='size-[18px] shrink-0 text-muted-foreground' />
    case 'open':
      return <GitPullRequestIcon className='size-[18px] shrink-0 text-green-500' />
    case 'merged':
      return <GitMergeIcon className='size-[18px] shrink-0 text-purple-400' />
  }
}

function TabPill({ state, active, title }: { state: TabState; active: boolean; title: string }) {
  return (
    <div
      className={cn(
        'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
      )}
    >
      <StateGlyph state={state} />
      <span
        className={cn(
          'pointer-events-none relative min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left',
          active
            ? '[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
            : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
        )}
      >
        {title}
      </span>
      <button
        type='button'
        aria-label='Close tab'
        className={cn(
          'absolute top-1/2 right-1.5 z-10 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <XIcon className='size-3.5' />
      </button>
    </div>
  )
}

function TreatmentLabel({ name }: { name: string }) {
  return (
    <div className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
      {name}
    </div>
  )
}

function StateMatrix() {
  return (
    <section className='flex flex-col gap-4'>
      <TreatmentLabel name='tab states' />
      <div className='flex flex-col gap-3'>
        <div className='grid grid-cols-[auto_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-2'>
          <div />
          {CURRENT_STATES.map((state) => (
            <div key={state} className='text-xs text-muted-foreground'>
              {state}
            </div>
          ))}
          {(['active', 'inactive'] as const).map((row) => (
            <Fragment key={row}>
              <div className='text-xs text-muted-foreground'>{row}</div>
              {CURRENT_STATES.map((state) => (
                <div key={state} className='min-w-0'>
                  <TabPill state={state} active={row === 'active'} title={SAMPLE_TITLE} />
                </div>
              ))}
            </Fragment>
          ))}
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <span className='text-xs text-muted-foreground'>edge</span>
          <TabPill
            state='sleeping'
            active={false}
            title='investigate flaky websocket reconnect behavior'
          />
          <TabPill state='running' active={true} title='fix ci' />
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <span className='text-xs text-muted-foreground'>future · PR states</span>
          {PR_STATES.map((state) => (
            <TabPill key={state} state={state} active={false} title={SAMPLE_TITLE} />
          ))}
        </div>
      </div>
    </section>
  )
}

const MOCK_TITLES = [
  'Vue perf exploration',
  'fix ci',
  'investigate flaky websocket reconnect',
  'migrate settings to zod',
  'tab bar polish',
  'approval card design',
  'boot flash fix',
  'diff viewer spike',
]

type MockTab = { id: number; title: string; state: TabState }

const MOCK_STATES: TabState[] = [...CURRENT_STATES, ...PR_STATES]

function randomOf<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

// One slot in the strip: separator zone (13) + pill (176).
const DRAG_STEP = 189

function MockTabBar() {
  const nextId = useRef(3)
  const [tabs, setTabs] = useState<MockTab[]>([
    { id: 0, title: 'Vue perf exploration', state: 'sleeping' },
    { id: 1, title: 'fix ci', state: 'running' },
    { id: 2, title: 'approval card design', state: 'open' },
  ])
  const [activeId, setActiveId] = useState(0)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const strip = useStripDrag({
    count: tabs.length,
    step: DRAG_STEP,
    onReorder(from, to) {
      setTabs((current) => {
        const next = [...current]
        const [moved] = next.splice(from, 1)
        if (moved) next.splice(to, 0, moved)
        return next
      })
    },
  })

  function createTab() {
    const tab: MockTab = {
      id: nextId.current++,
      title: randomOf(MOCK_TITLES),
      state: randomOf(MOCK_STATES),
    }
    setTabs((current) => [...current, tab])
    setActiveId(tab.id)
  }

  function closeTab(id: number) {
    const index = tabs.findIndex((tab) => tab.id === id)
    const remaining = tabs.filter((tab) => tab.id !== id)
    setTabs(remaining)
    if (id === activeId && remaining.length > 0) {
      setActiveId(remaining[Math.min(index, remaining.length - 1)]!.id)
    }
  }

  return (
    <div className='flex h-14 w-full items-center gap-2 border-b px-3'>
      <RansomWordmarkStatic className='shrink-0' />
      <div className='flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {tabs.map((tab, index) => {
          const active = tab.id === activeId
          const prev = tabs[index - 1]
          const touchesFocus = (id: number | undefined) =>
            id !== undefined && (id === activeId || id === hoveredId)
          const dragging = strip.drag?.from === index
          return (
            <div key={tab.id} className='flex shrink-0 items-center'>
              <div className='flex w-[13px] shrink-0 items-center justify-center'>
                {index > 0 && (
                  <Separator
                    orientation='vertical'
                    className={cn(
                      'h-4! shrink-0 self-center! transition-opacity duration-150',
                      (touchesFocus(prev?.id) || touchesFocus(tab.id) || strip.drag !== null) &&
                        'opacity-0'
                    )}
                  />
                )}
              </div>
              <div
                className={cn(
                  'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/50',
                  dragging && 'z-10 bg-accent text-foreground'
                )}
                style={dragging ? undefined : strip.shiftStyle(index)}
                onPointerEnter={() => setHoveredId(tab.id)}
                onPointerLeave={() => setHoveredId(null)}
                {...strip.handleProps(index)}
              >
                <button
                  type='button'
                  aria-label={tab.title}
                  className='absolute inset-0 rounded-md'
                  {...pressHandlers(() => setActiveId(tab.id))}
                />
                <StateGlyph state={tab.state} />
                <span
                  className={cn(
                    'pointer-events-none relative min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left',
                    active
                      ? '[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
                      : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
                  )}
                >
                  {tab.title}
                </span>
                <button
                  type='button'
                  aria-label='Close tab'
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className={cn(
                    'absolute top-1/2 right-1.5 z-10 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <XIcon className='size-3.5' />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <Button
        variant='ghost'
        size='icon'
        className='size-8 shrink-0'
        aria-label='New tab'
        {...pressHandlers(createTab)}
      >
        <PlusIcon />
      </Button>
      <div className='min-w-0 flex-1' />
    </div>
  )
}

type StyleguideTab = 'tabs' | 'chat' | 'streaming' | 'composer' | 'diffs'

const STYLEGUIDE_TABS: Array<{ id: StyleguideTab; label: string }> = [
  { id: 'tabs', label: 'Tab lab' },
  { id: 'chat', label: 'Chat lab' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'composer', label: 'Composer lab' },
  { id: 'diffs', label: 'Diffs' },
]

function StyleguideTabs({
  active,
  onChange,
}: {
  active: StyleguideTab
  onChange: (tab: StyleguideTab) => void
}) {
  return (
    <div
      role='tablist'
      aria-label='Styleguide labs'
      className='flex shrink-0 items-center gap-1 border-b px-8 pt-4'
    >
      {STYLEGUIDE_TABS.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={selected}
            className={cn(
              'relative px-3 py-2 text-sm transition-colors',
              selected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            {...pressHandlers(() => onChange(tab.id))}
          >
            {tab.label}
            {selected ? (
              <span className='absolute inset-x-3 -bottom-px h-px bg-foreground' />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function TabLab() {
  return (
    <div className='mx-auto flex max-w-5xl flex-col gap-12 p-8'>
      <h1 className='text-2xl font-semibold tracking-tight'>Tab lab</h1>
      <StateMatrix />
      <section className='flex flex-col gap-4'>
        <TreatmentLabel name='interactive mock bar' />
        <MockTabBar />
      </section>
    </div>
  )
}

function StyleguidePage() {
  const [tab, setTab] = useState<StyleguideTab>('chat')

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <StyleguideTabs active={tab} onChange={setTab} />
      <div className='min-h-0 flex-1 overflow-y-auto' role='tabpanel'>
        {tab === 'tabs' ? (
          <TabLab />
        ) : tab === 'chat' ? (
          <ChatLab />
        ) : tab === 'streaming' ? (
          <StreamingLab />
        ) : tab === 'composer' ? (
          <ComposerLab />
        ) : (
          <DiffsLab />
        )}
      </div>
    </div>
  )
}
