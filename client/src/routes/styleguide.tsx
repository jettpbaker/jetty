import { ProjectBadge } from '@/components/project-badge'
import { RansomWordmarkStatic } from '@/components/ransom-wordmark'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  CircleDashedIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  MoonIcon,
  PlusIcon,
  SpinnerIcon,
  XIcon,
} from '@phosphor-icons/react'
import { pressHandlers } from '@/lib/press-handlers'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/styleguide')({
  component: StyleguidePage,
})

type LabStatus = 'idle' | 'running' | 'awaiting_approval' | 'error'
type Treatment =
  | 'jett'
  | 'letter'
  | 'dot'
  | 'letter-dot'
  | 'letter-attention'
  | 'bare'
  | 'capsule'
  | 'letter-capsule'

const STATUSES: LabStatus[] = ['idle', 'running', 'awaiting_approval', 'error']
const TREATMENTS: Treatment[] = [
  'jett',
  'letter',
  'dot',
  'letter-dot',
  'letter-attention',
  'bare',
  'capsule',
  'letter-capsule',
]
const SAMPLE_TITLE = 'Vue perf exploration'

function statusDotClass(status: LabStatus): string {
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

function StatusDot({ status }: { status: LabStatus }) {
  return <span className={cn('size-2 shrink-0 rounded-full', statusDotClass(status))} />
}

function StatusCapsule({ status }: { status: LabStatus }) {
  if (status === 'idle') return null

  if (status === 'running') {
    return (
      <span className='flex h-4 items-center gap-1 rounded-full bg-primary/15 px-1.5'>
        <span className='size-1.5 animate-pulse rounded-full bg-primary' />
        <span className='font-mono text-[10px] text-primary'>run</span>
      </span>
    )
  }

  if (status === 'awaiting_approval') {
    return (
      <span className='flex h-4 items-center gap-1 rounded-full bg-primary px-1.5 text-primary-foreground'>
        <span className='size-1.5 rounded-full bg-primary-foreground' />
        <span className='font-mono text-[10px]'>wait</span>
      </span>
    )
  }

  return (
    <span className='flex h-4 items-center gap-1 rounded-full bg-destructive/15 px-1.5 text-destructive'>
      <span className='size-1.5 rounded-full bg-destructive' />
      <span className='font-mono text-[10px]'>err</span>
    </span>
  )
}

function LabPillPrefix({
  treatment,
  status,
  title,
}: {
  treatment: Treatment
  status: LabStatus
  title: string
}): ReactNode {
  switch (treatment) {
    // Jett's WIP treatment: GitHub-PR-style glyphs, no letter. The status
    // columns are just a display rack: idle→draft PR, running→spinner,
    // awaiting_approval→open PR, error→merged PR.
    case 'jett':
      switch (status) {
        case 'idle':
          return <GitPullRequestIcon weight='bold' className='size-[18px] shrink-0 text-muted-foreground' />
        case 'running':
          return <SpinnerIcon weight='bold' className='size-[18px] shrink-0 animate-spin text-muted-foreground' />
        case 'awaiting_approval':
          return <GitPullRequestIcon weight='bold' className='size-[18px] shrink-0 text-green-500' />
        case 'error':
          return <GitMergeIcon weight='bold' className='size-[18px] shrink-0 text-purple-400' />
      }
    case 'letter':
      return <ProjectBadge title={title} />
    case 'dot':
      return <StatusDot status={status} />
    case 'letter-dot':
      return (
        <>
          <ProjectBadge title={title} />
          <StatusDot status={status} />
        </>
      )
    case 'letter-attention':
      return (
        <>
          <ProjectBadge title={title} />
          {status !== 'idle' ? <StatusDot status={status} /> : null}
        </>
      )
    case 'bare':
      return null
    case 'capsule':
      return <StatusCapsule status={status} />
    case 'letter-capsule':
      return (
        <>
          <ProjectBadge title={title} />
          <StatusCapsule status={status} />
        </>
      )
  }
}

function LabPill({
  active,
  status,
  treatment,
  title,
}: {
  active: boolean
  status: LabStatus
  treatment: Treatment
  title: string
}) {
  return (
    <div
      className={cn(
        'group relative flex h-9 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
        active
          ? 'bg-[#2B2C2D] text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50'
      )}
    >
      <LabPillPrefix treatment={treatment} status={status} title={title} />
      <span className='pointer-events-none relative min-w-0 flex-1 truncate text-left'>{title}</span>
      <button
        type='button'
        aria-label='Close tab'
        className={cn(
          'relative z-10 -mr-1 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
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

function TreatmentSection({ treatment }: { treatment: Treatment }) {
  return (
    <section className='flex flex-col gap-4'>
      <TreatmentLabel name={treatment} />

      <div className='flex flex-col gap-3'>
        <div className='grid grid-cols-[auto_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-2'>
          <div />
          {STATUSES.map((status) => (
            <div key={status} className='text-xs text-muted-foreground'>
              {status}
            </div>
          ))}

          {(['active', 'inactive'] as const).map((row) => (
            <Fragment key={row}>
              <div className='text-xs text-muted-foreground'>{row}</div>
              {STATUSES.map((status) => (
                <div key={status} className='min-w-0'>
                  <LabPill
                    active={row === 'active'}
                    status={status}
                    treatment={treatment}
                    title={SAMPLE_TITLE}
                  />
                </div>
              ))}
            </Fragment>
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-3'>
          <span className='text-xs text-muted-foreground'>edge</span>
          <LabPill
            active={false}
            status='idle'
            treatment={treatment}
            title='investigate flaky websocket reconnect behavior'
          />
          <LabPill active={true} status='running' treatment={treatment} title='fix ci' />
        </div>
      </div>
    </section>
  )
}

function BarPreview({ treatment }: { treatment: Treatment }) {
  const pills = [
    { active: true, status: 'idle' as const, title: SAMPLE_TITLE },
    { active: false, status: 'running' as const, title: SAMPLE_TITLE },
    { active: false, status: 'awaiting_approval' as const, title: SAMPLE_TITLE },
    { active: false, status: 'error' as const, title: SAMPLE_TITLE },
  ]

  return (
    <div className='flex flex-col gap-2'>
      <TreatmentLabel name={treatment} />
      <div className='flex h-14 w-full items-center gap-2 border-b px-3'>
        <RansomWordmarkStatic />
        <div className='flex min-w-0 items-center gap-1.5 overflow-x-auto'>
          {pills.map((pill) => (
            <LabPill
              key={`${pill.active}-${pill.status}`}
              active={pill.active}
              status={pill.status}
              treatment={treatment}
              title={pill.title}
            />
          ))}
        </div>
        <Button variant='ghost' size='icon' className='size-8 shrink-0' aria-label='New thread'>
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}

type JettGlyphKind = 'draft' | 'spinner' | 'open' | 'merged'
type JettWeight = 'bold' | 'duotone' | 'fill'

const JETT_VARIANTS: Array<{ caption: string; weight: JettWeight; cls: string }> = [
  { caption: 'bold · 16px', weight: 'bold', cls: 'size-4' },
  { caption: 'bold · 18px', weight: 'bold', cls: 'size-[18px]' },
  { caption: 'bold · 20px', weight: 'bold', cls: 'size-5' },
  { caption: 'duotone · 16px', weight: 'duotone', cls: 'size-4' },
  { caption: 'duotone · 20px', weight: 'duotone', cls: 'size-5' },
  { caption: 'fill · 16px', weight: 'fill', cls: 'size-4' },
]

function JettGlyph({ kind, weight, cls }: { kind: JettGlyphKind; weight: JettWeight; cls: string }) {
  switch (kind) {
    case 'draft':
      return <GitPullRequestIcon weight={weight} className={cn(cls, 'shrink-0 text-muted-foreground')} />
    case 'spinner':
      return <SpinnerIcon weight={weight} className={cn(cls, 'shrink-0 animate-spin text-muted-foreground')} />
    case 'open':
      return <GitPullRequestIcon weight={weight} className={cn(cls, 'shrink-0 text-green-500')} />
    case 'merged':
      return <GitMergeIcon weight={weight} className={cn(cls, 'shrink-0 text-purple-400')} />
  }
}

const JETT_GLYPH_KINDS: JettGlyphKind[] = ['draft', 'spinner', 'open', 'merged']

function JettIconLab() {
  return (
    <section className='flex flex-col gap-4'>
      <TreatmentLabel name='jett · size & weight variants' />
      <div className='flex flex-col gap-3'>
        {JETT_VARIANTS.map((variant) => (
          <div key={variant.caption} className='flex flex-wrap items-center gap-3'>
            {JETT_GLYPH_KINDS.map((kind) => (
              <div
                key={kind}
                className='flex h-9 w-44 items-center gap-1.5 rounded-md bg-[#2B2C2D] px-2.5 text-sm text-foreground'
              >
                <JettGlyph kind={kind} weight={variant.weight} cls={variant.cls} />
                <span className='min-w-0 flex-1 truncate'>Vue perf exploration</span>
              </div>
            ))}
            <span className='text-xs text-muted-foreground'>{variant.caption}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// Sleeping-state candidates: no associated PR, agent not working. What does
// the prefix show when there is nothing to say?
const SLEEPING_CANDIDATES: Array<{ caption: string; prefix: ReactNode }> = [
  { caption: 'nothing (space reserved)', prefix: <span className='size-[18px] shrink-0' /> },
  { caption: 'nothing (collapses)', prefix: null },
  {
    caption: 'muted dot',
    prefix: <span className='size-2 shrink-0 rounded-full bg-muted-foreground/40' />,
  },
  {
    caption: 'dashed circle',
    prefix: <CircleDashedIcon weight='bold' className='size-[18px] shrink-0 text-muted-foreground/60' />,
  },
  {
    caption: 'moon',
    prefix: <MoonIcon weight='bold' className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60' />,
  },
  {
    caption: 'moon · fill',
    prefix: <MoonIcon weight='fill' className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60' />,
  },
  {
    caption: 'branch (worktree, no PR)',
    prefix: <GitBranchIcon weight='bold' className='size-[18px] shrink-0 text-muted-foreground/60' />,
  },
  { caption: 'ransom letter', prefix: <ProjectBadge title='A' /> },
]

function JettSleepingLab() {
  return (
    <section className='flex flex-col gap-4'>
      <TreatmentLabel name='jett · sleeping state' />
      <div className='flex flex-col gap-3'>
        {SLEEPING_CANDIDATES.map((candidate) => (
          <div key={candidate.caption} className='flex flex-wrap items-center gap-3'>
            <div className='flex h-9 w-44 shrink-0 items-center gap-1.5 rounded-md bg-[#2B2C2D] px-2.5 text-sm text-foreground'>
              {candidate.prefix}
              <span className='min-w-0 flex-1 truncate'>Vue perf exploration</span>
              <XIcon className='size-3.5 text-muted-foreground' />
            </div>
            <div className='flex h-9 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground'>
              {candidate.prefix}
              <span className='min-w-0 flex-1 truncate'>Vue perf exploration</span>
            </div>
            <span className='text-xs text-muted-foreground'>{candidate.caption}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// Fully interactive mock of the tab bar wearing the jett treatment: create,
// select, close — all local state; each new tab rolls a random glyph state.
type MockState = 'sleeping' | 'running' | 'draft' | 'open' | 'merged'
type MockTab = { id: number; title: string; state: MockState }

const MOCK_STATES: MockState[] = ['sleeping', 'running', 'draft', 'open', 'merged']
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

function MockGlyph({ state }: { state: MockState }) {
  switch (state) {
    case 'sleeping':
      return (
        <MoonIcon
          weight='fill'
          className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60'
        />
      )
    case 'running':
      return (
        <SpinnerIcon
          weight='bold'
          className='size-[18px] shrink-0 animate-spin text-muted-foreground'
        />
      )
    case 'draft':
      return <GitPullRequestIcon weight='bold' className='size-[18px] shrink-0 text-muted-foreground' />
    case 'open':
      return <GitPullRequestIcon weight='bold' className='size-[18px] shrink-0 text-green-500' />
    case 'merged':
      return <GitMergeIcon weight='bold' className='size-[18px] shrink-0 text-purple-400' />
  }
}

function randomOf<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

// One slot in the strip: pill (176) + gap (6) + separator (1) + gap (6).
const DRAG_STEP = 189
const DRAG_THRESHOLD = 5
const SETTLE_MS = 160

function MockTabBar() {
  const nextId = useRef(3)
  const [tabs, setTabs] = useState<MockTab[]>([
    { id: 0, title: 'Vue perf exploration', state: 'sleeping' },
    { id: 1, title: 'fix ci', state: 'running' },
    { id: 2, title: 'approval card design', state: 'open' },
  ])
  const [activeId, setActiveId] = useState(0)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  // Drag state lives in a ref (pointermove reads it without stale closures)
  // and mirrors to state for rendering the sibling shifts.
  const dragRef = useRef<{ id: number; from: number; to: number } | null>(null)
  const [drag, setDragState] = useState<{ id: number; from: number; to: number } | null>(null)
  const dragStart = useRef<{ x: number; id: number; index: number } | null>(null)
  const dragEl = useRef<HTMLDivElement | null>(null)
  const settleTimer = useRef<number | null>(null)

  function setDrag(next: { id: number; from: number; to: number } | null) {
    dragRef.current = next
    setDragState(next)
  }

  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
    },
    []
  )

  function onPillPointerDown(event: React.PointerEvent, id: number, index: number) {
    if (event.button !== 0 || settleTimer.current) return
    dragStart.current = { x: event.clientX, id, index }
  }

  function onPillPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    if (!start) return
    const dx = event.clientX - start.x
    if (!dragRef.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ id: start.id, from: start.index, to: start.index })
    }
    if (dragEl.current) dragEl.current.style.transform = `translateX(${dx}px)`
    const to = Math.min(
      tabs.length - 1,
      Math.max(0, start.index + Math.round(dx / DRAG_STEP))
    )
    if (dragRef.current && to !== dragRef.current.to) {
      setDrag({ ...dragRef.current, to })
    }
  }

  function onPillPointerUp() {
    dragStart.current = null
    const active = dragRef.current
    if (!active) return
    // settle: glide the dragged pill to its slot, then commit the reorder
    const el = dragEl.current
    if (el) {
      el.style.transition = `transform ${SETTLE_MS}ms ease`
      el.style.transform = `translateX(${(active.to - active.from) * DRAG_STEP}px)`
    }
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      setTabs((current) => {
        const next = [...current]
        const [moved] = next.splice(active.from, 1)
        if (moved) next.splice(active.to, 0, moved)
        return next
      })
      setDrag(null)
      if (el) {
        el.style.transition = ''
        el.style.transform = ''
      }
    }, SETTLE_MS)
  }

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
      const neighbor = remaining[Math.min(index, remaining.length - 1)]!
      setActiveId(neighbor.id)
    }
  }

  return (
    <div className='flex h-14 w-full items-center gap-2 border-b px-3'>
      <RansomWordmarkStatic />
      <div className='flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {tabs.map((tab, index) => {
          const active = tab.id === activeId
          const prev = tabs[index - 1]
          const touchesFocus = (id: number | undefined) =>
            id !== undefined && (id === activeId || id === hoveredId)
          const separatorHidden = touchesFocus(prev?.id) || touchesFocus(tab.id)
          const dragging = drag?.id === tab.id
          // displaced siblings slide one slot toward the dragged pill's origin
          let shift = 0
          if (drag && !dragging) {
            if (drag.from < drag.to && index > drag.from && index <= drag.to) shift = -DRAG_STEP
            if (drag.from > drag.to && index >= drag.to && index < drag.from) shift = DRAG_STEP
          }
          return (
            <Fragment key={tab.id}>
              {index > 0 && (
                <Separator
                  orientation='vertical'
                  className={cn(
                    'h-4! shrink-0 self-center! transition-opacity duration-150',
                    (separatorHidden || drag !== null) && 'opacity-0'
                  )}
                />
              )}
            <div
              ref={dragging ? dragEl : undefined}
              className={cn(
                'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
                active ? 'bg-[#2B2C2D] text-foreground' : 'text-muted-foreground hover:bg-secondary/50',
                dragging && 'z-10 bg-[#2B2C2D] text-foreground'
              )}
              style={
                dragging
                  ? undefined
                  : {
                      transform: shift ? `translateX(${shift}px)` : undefined,
                      transition: drag ? 'transform 150ms ease' : undefined,
                    }
              }
              onPointerEnter={() => setHoveredId(tab.id)}
              onPointerLeave={() => setHoveredId(null)}
              onPointerDown={(event) => onPillPointerDown(event, tab.id, index)}
              onPointerMove={onPillPointerMove}
              onPointerUp={onPillPointerUp}
              onPointerCancel={onPillPointerUp}
            >
              <button
                type='button'
                aria-label={tab.title}
                className='absolute inset-0 rounded-md'
                {...pressHandlers(() => setActiveId(tab.id))}
              />
              <MockGlyph state={tab.state} />
              <span className='pointer-events-none relative min-w-0 flex-1 truncate text-left'>
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
                  'relative z-10 -mr-1 rounded-sm p-0.5 text-muted-foreground hover:text-foreground',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <XIcon className='size-3.5' />
              </button>
            </div>
            </Fragment>
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

function StyleguidePage() {
  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-5xl flex-col gap-12 p-8'>
        <h1 className='text-2xl font-semibold tracking-tight'>Tab lab</h1>

        {TREATMENTS.map((treatment) => (
          <Fragment key={treatment}>
            <TreatmentSection treatment={treatment} />
            {treatment === 'jett' && (
              <>
                <JettIconLab />
                <JettSleepingLab />
                <section className='flex flex-col gap-4'>
                  <TreatmentLabel name='jett · interactive mock bar' />
                  <MockTabBar />
                </section>
              </>
            )}
          </Fragment>
        ))}

        <section className='flex flex-col gap-8'>
          <h2 className='text-lg font-medium'>Bar preview</h2>
          {TREATMENTS.map((treatment) => (
            <BarPreview key={treatment} treatment={treatment} />
          ))}
        </section>
      </div>
    </div>
  )
}
