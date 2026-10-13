import type { ChildReport, ThreadItem } from '@jetty/shared/items'
import type { ThreadMeta } from '@jetty/shared/wire'

import { reportOutcomes } from '@/components/custom/child_reports'
import { inlineLinkClass } from '@/components/custom/entity_link'
import { StatusGlyph, threadStatus, type Status } from '@/components/custom/thread_status'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useChildThreadMetas, useProject, useThreadMeta } from '@/state'
import { Link } from '@tanstack/react-router'

type Marker = Extract<ThreadItem, { kind: 'thread_marker' }>

// A thread with no meta was deleted: its marker keeps the title, unlinked and without a status.
function MarkerLink({
  marker,
  outcome,
}: {
  marker: Pick<Marker, 'threadId' | 'title'>
  // How a report's run ended, in place of the thread's live status.
  outcome?: Status
}) {
  const meta = useThreadMeta(marker.threadId)
  if (!meta) return <span className='max-w-60 truncate text-foreground'>{marker.title}</span>
  return (
    <span className='inline-flex min-w-0 items-center gap-[3px]'>
      <StatusGlyph
        status={outcome ?? threadStatus(meta.status, meta.readyForReview)}
        className='size-3'
      />
      <Link
        to='/threads/$threadId'
        params={{ threadId: marker.threadId }}
        className={cn(inlineLinkClass, 'max-w-60 truncate')}
      >
        {meta.title}
      </Link>
    </span>
  )
}

const menuEntryClass =
  'flex h-7.5 min-w-0 items-center gap-2 rounded-menu-item px-2 text-xs text-foreground outline-none'

function MarkerMenuEntry({ marker }: { marker: Marker }) {
  const meta = useThreadMeta(marker.threadId)
  const project = useProject(meta?.projectId)
  if (!meta)
    return (
      <div className={menuEntryClass}>
        <span aria-hidden='true' className='size-3.5 shrink-0' />
        <span className='min-w-0 flex-1 truncate'>{marker.title}</span>
      </div>
    )
  return (
    <Link
      to='/threads/$threadId'
      params={{ threadId: marker.threadId }}
      className={cn(menuEntryClass, 'hover:bg-accent focus-visible:bg-accent')}
    >
      <StatusGlyph status={threadStatus(meta.status, meta.readyForReview)} className='size-3.5' />
      <span className='min-w-0 flex-1 truncate'>{meta.title}</span>
      <span className='shrink-0 text-muted-foreground'>{project?.title}</span>
    </Link>
  )
}

function MarkerRun({ markers, metas }: { markers: Marker[]; metas: readonly ThreadMeta[] }) {
  const first = markers[0]!
  const verb = first.action === 'started' ? 'Started' : 'Messaged'
  const threads = markers.filter(
    (marker, index) => markers.findIndex((entry) => entry.threadId === marker.threadId) === index
  )
  if (threads.length === 1 && markers.length > 1)
    return (
      <span className='inline-flex items-center gap-[5px]'>
        <span className='text-foreground'>{markers.length}</span> messages to{' '}
        <MarkerLink marker={first} />
      </span>
    )
  if (threads.length === 2)
    return (
      <span className='inline-flex items-center gap-[5px]'>
        {verb} <MarkerLink marker={first} /> and <MarkerLink marker={threads[1]!} />
      </span>
    )
  if (threads.length >= 3)
    return (
      <span className='inline-flex items-center gap-[5px]'>
        {verb}{' '}
        <Popover>
          <PopoverTrigger className='rounded-sm text-foreground hover:underline'>
            {threads.length} threads
          </PopoverTrigger>
          <PopoverContent className='w-75 gap-0 rounded-sm p-1'>
            <PopoverTitle className='sr-only'>{verb} threads</PopoverTitle>
            {threads.map((marker) => (
              <MarkerMenuEntry key={marker.id} marker={marker} />
            ))}
          </PopoverContent>
        </Popover>
        <span className='inline-flex items-center gap-[7px] pl-0.5'>
          <MarkerTallies markers={threads} metas={metas} />
        </span>
      </span>
    )
  return (
    <span className='inline-flex items-center gap-[5px]'>
      {verb} <MarkerLink marker={first} />
    </span>
  )
}

function MarkerTallies({ markers, metas }: { markers: Marker[]; metas: readonly ThreadMeta[] }) {
  const tally = new Map<ReturnType<typeof threadStatus>, number>()
  for (const marker of markers) {
    const meta = metas.find((entry) => entry.id === marker.threadId)
    if (!meta) continue
    const status = threadStatus(meta.status, meta.readyForReview)
    tally.set(status, (tally.get(status) ?? 0) + 1)
  }
  return [...tally].map(([status, count]) => (
    <span
      key={status}
      className='inline-flex items-center gap-[3px] font-mono text-muted-foreground'
    >
      <StatusGlyph status={status} className='size-3' />
      {count}
    </span>
  ))
}

const rowClass = 'flex flex-col items-center gap-1 text-xs text-muted-foreground'
const lineClass = 'flex min-w-0 items-center justify-center py-0.5'

// The threads a bot started or messaged since its last words, a line for each run of one kind.
export function ThreadMarkers({ botId, markers }: { botId: string; markers: Marker[] }) {
  const metas = useChildThreadMetas(botId)
  const groups: Marker[][] = []
  for (const marker of markers) {
    const previous = groups.at(-1)
    if (previous?.[0]?.action === marker.action) previous.push(marker)
    else groups.push([marker])
  }
  return (
    <div className={rowClass}>
      {groups.map((group) => (
        <div key={group[0]!.id} className={lineClass}>
          <MarkerRun markers={group} metas={metas} />
        </div>
      ))}
    </div>
  )
}

// What woke the bot: each report of a worker, or one of Jetty's own wakes.
export function WakeMarker({
  reports,
  wake,
}: {
  reports?: readonly ChildReport[]
  wake?: 'check_in' | 'tidy'
}) {
  return (
    <div className={rowClass}>
      {reports?.map((report, index) => {
        const { status, verb } = reportOutcomes[report.outcome]
        return (
          <div key={`${report.threadId}:${index}`} className={cn(lineClass, 'gap-[5px]')}>
            <MarkerLink
              marker={{ threadId: report.threadId, title: report.title }}
              outcome={status}
            />
            {verb}
          </div>
        )
      })}
      {wake && (
        <div className={lineClass}>{wake === 'tidy' ? 'Tidied its notes' : 'Checked in'}</div>
      )}
    </div>
  )
}

// Under Jett's message while the bot tidies its notes first; it goes when the tidy ends.
export function TidyingLine() {
  return (
    <div className={rowClass}>
      <div className={lineClass}>Tidying its notes</div>
    </div>
  )
}
