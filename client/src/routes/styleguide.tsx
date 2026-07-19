import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  type AnimateLayoutChanges,
  arrayMove,
  defaultAnimateLayoutChanges,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { Fragment, type ReactNode, useRef, useState } from 'react'

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
          return <GitPullRequestIcon className='size-[18px] shrink-0 text-muted-foreground' />
        case 'running':
          return <SpinnerIcon className='size-[18px] shrink-0 animate-spin text-muted-foreground' />
        case 'awaiting_approval':
          return <GitPullRequestIcon className='size-[18px] shrink-0 text-green-500' />
        case 'error':
          return <GitMergeIcon className='size-[18px] shrink-0 text-purple-400' />
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
      <span
        className={cn(
          'pointer-events-none relative min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left',
          active ? '[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]' : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] group-hover:[mask-image:linear-gradient(to_right,black_calc(100%-34px),transparent_calc(100%-14px))]'
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
    prefix: <CircleDashedIcon className='size-[18px] shrink-0 text-muted-foreground/60' />,
  },
  {
    caption: 'moon',
    prefix: <MoonIcon className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60' />,
  },
  {
    caption: 'moon · fill',
    prefix: <MoonIcon weight='fill' className='size-[18px] shrink-0 translate-y-px text-muted-foreground/60' />,
  },
  {
    caption: 'branch (worktree, no PR)',
    prefix: <GitBranchIcon className='size-[18px] shrink-0 text-muted-foreground/60' />,
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
        <SpinnerIcon className='size-[18px] shrink-0 animate-spin text-muted-foreground' />
      )
    case 'draft':
      return <GitPullRequestIcon className='size-[18px] shrink-0 text-muted-foreground' />
    case 'open':
      return <GitPullRequestIcon className='size-[18px] shrink-0 text-green-500' />
    case 'merged':
      return <GitMergeIcon className='size-[18px] shrink-0 text-purple-400' />
  }
}

function randomOf<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

function MockTabBar() {
  const nextId = useRef(3)
  const [tabs, setTabs] = useState<MockTab[]>([
    { id: 0, title: 'Vue perf exploration', state: 'sleeping' },
    { id: 1, title: 'fix ci', state: 'running' },
    { id: 2, title: 'approval card design', state: 'open' },
  ])
  const [activeId, setActiveId] = useState(0)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)

  // 5px of travel before a press becomes a drag — below that it's a select
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function onDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as number)
  }

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    setTabs((current) =>
      arrayMove(
        current,
        current.findIndex((tab) => tab.id === active.id),
        current.findIndex((tab) => tab.id === over.id)
      )
    )
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
      setActiveId(remaining[Math.min(index, remaining.length - 1)]!.id)
    }
  }

  return (
    <div className='flex h-14 w-full items-center gap-2 border-b px-3'>
      <RansomWordmarkStatic className='shrink-0' />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className='flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab, index) => {
              const prev = tabs[index - 1]
              const touchesFocus = (id: number | undefined) =>
                id !== undefined && (id === activeId || id === hoveredId)
              return (
                <MockPill
                  key={tab.id}
                  tab={tab}
                  showSeparator={index > 0}
                  separatorHidden={
                    touchesFocus(prev?.id) || touchesFocus(tab.id) || draggingId !== null
                  }
                  active={tab.id === activeId}
                  onSelect={() => setActiveId(tab.id)}
                  onClose={() => closeTab(tab.id)}
                  onHover={setHoveredId}
                />
              )
            })}
          </SortableContext>
        </div>
      </DndContext>
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

// Without a DragOverlay, dnd-kit skips animating the released item into its
// slot by default — this opts the drop into the same glide the siblings get.
const animateDropToo: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })

function MockPill({
  tab,
  showSeparator,
  separatorHidden,
  active,
  onSelect,
  onClose,
  onHover,
}: {
  tab: MockTab
  showSeparator: boolean
  separatorHidden: boolean
  active: boolean
  onSelect: () => void
  onClose: () => void
  onHover: (id: number | null) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    transition: { duration: 280, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    animateLayoutChanges: animateDropToo,
  })

  return (
    <div
      ref={setNodeRef}
      className={cn('flex shrink-0 items-center', isDragging && 'z-10')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      {showSeparator && (
        <div className='flex w-[13px] shrink-0 items-center justify-center'>
          <Separator
            orientation='vertical'
            className={cn(
              'h-4! shrink-0 self-center! transition-opacity duration-150',
              separatorHidden && 'opacity-0'
            )}
          />
        </div>
      )}
      <div
        className={cn(
          'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
          active ? 'bg-[#2B2C2D] text-foreground' : 'text-muted-foreground hover:bg-secondary/50',
          isDragging && 'bg-[#2B2C2D] text-foreground'
        )}
        onPointerEnter={() => onHover(tab.id)}
        onPointerLeave={() => onHover(null)}
      >
        <button
          type='button'
          aria-label={tab.title}
          className='absolute inset-0 rounded-md'
          {...pressHandlers(onSelect)}
        />
        <MockGlyph state={tab.state} />
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
            onClose()
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
