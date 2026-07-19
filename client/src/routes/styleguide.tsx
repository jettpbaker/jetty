import { ProjectBadge } from '@/components/project-badge'
import { RansomWordmarkStatic } from '@/components/ransom-wordmark'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GitMergeIcon, GitPullRequestIcon, PlusIcon, SpinnerIcon, XIcon } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, type ReactNode } from 'react'

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
          return <GitPullRequestIcon weight='bold' className='size-4 shrink-0 text-muted-foreground' />
        case 'running':
          return <SpinnerIcon weight='bold' className='size-4 shrink-0 animate-spin text-muted-foreground' />
        case 'awaiting_approval':
          return <GitPullRequestIcon weight='bold' className='size-4 shrink-0 text-green-500' />
        case 'error':
          return <GitMergeIcon weight='bold' className='size-4 shrink-0 text-purple-400' />
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
        'group relative flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm',
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
                className='flex h-8 w-44 items-center gap-1.5 rounded-md bg-[#2B2C2D] px-2.5 text-sm text-foreground'
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

function StyleguidePage() {
  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-5xl flex-col gap-12 p-8'>
        <h1 className='text-2xl font-semibold tracking-tight'>Tab lab</h1>

        {TREATMENTS.map((treatment) => (
          <Fragment key={treatment}>
            <TreatmentSection treatment={treatment} />
            {treatment === 'jett' && <JettIconLab />}
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
