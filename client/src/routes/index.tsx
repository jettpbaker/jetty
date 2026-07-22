import type { SessionStatus } from '@jetty/shared/events'
import type { ThreadGitStatus, ThreadMeta } from '@jetty/shared/wire'

import { chromeStore, draftsStore, tabsStore } from '@/app-state'
import { useCommandPalette } from '@/components/command-palette'
import { RansomWordmark } from '@/components/ransom-wordmark'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { StatusGlyph } from '@/components/status-glyph'
import { UsageMeter } from '@/components/usage-meter'
import { loadLastProjectId, saveLastProjectId } from '@/lib/draft'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import {
  ArchiveIcon,
  FolderPlusIcon,
  GearIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@phosphor-icons/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useSyncExternalStore } from 'react'

export const Route = createFileRoute('/')({
  component: HomePage,
})

// One deliberate ember moment per page: the primary action wears the code chip.
const emberAction =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-code px-3 text-sm font-medium text-code-foreground transition-colors outline-none hover:bg-[color-mix(in_oklch,var(--code),var(--code-foreground)_16%)] focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px'

const kbd =
  'rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground'

const row =
  'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-muted'

const sideItem =
  'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

const sectionLabel =
  'font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70'

function relTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 45) return 'now'
  const m = s / 60
  if (m < 45) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 22) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 7) return `${Math.round(d)}d`
  const w = d / 7
  if (w < 5) return `${Math.round(w)}w`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Local time for a usage window reset — today → `6:00pm`; else `Mon 1am`. */
function formatResetsAt(resetsAt: number): string {
  const d = new Date(resetsAt)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  const hours24 = d.getHours()
  const minutes = d.getMinutes()
  const meridiem = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 || 12
  if (sameDay) return `${hours12}:${String(minutes).padStart(2, '0')}${meridiem}`
  // weekday form drops :00 — `Mon 1am`, not `Mon 1:00am`
  const time =
    minutes === 0 ? `${hours12}${meridiem}` : `${hours12}:${String(minutes).padStart(2, '0')}${meridiem}`
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${time}`
}

// The interesting slice of git state, quietly: an open PR beats a feature
// branch beats nothing. A plain main/master branch isn't worth the ink.
function GitTag({ git }: { git: ThreadGitStatus }) {
  if (git.pr) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center gap-1 font-mono text-xs',
          git.pr.state === 'open' ? 'text-green-500' : 'text-muted-foreground/70'
        )}
      >
        <GitPullRequestIcon className='size-3.5' />
        {git.pr.number}
      </span>
    )
  }
  if (git.branch && git.branch !== 'main' && git.branch !== 'master') {
    return (
      <span className='flex min-w-0 max-w-[9rem] shrink items-center gap-1 font-mono text-xs text-muted-foreground/70'>
        <GitBranchIcon className='size-3.5 shrink-0' />
        <span className='truncate'>
          {git.branch}
          {git.dirty ? '*' : ''}
        </span>
      </span>
    )
  }
  return null
}

const DAY_MS = 86_400_000

// Awaiting-approval leads today's bucket, then running/starting, then the rest —
// the ranking only matters within "Today"; older buckets sort purely by recency.
function statusRank(status: SessionStatus): number {
  if (status === 'awaiting_approval') return 0
  if (status === 'running' || status === 'starting') return 1
  return 2
}

type Bucket = { label: string; threads: ThreadMeta[] }

function bucketThreads(threads: ThreadMeta[]): Bucket[] {
  const startToday = new Date().setHours(0, 0, 0, 0)
  const sevenAgo = startToday - 7 * DAY_MS
  const thirtyAgo = startToday - 30 * DAY_MS

  const today: ThreadMeta[] = []
  const week: ThreadMeta[] = []
  const month: ThreadMeta[] = []
  for (const thread of threads) {
    if (thread.archived) continue
    const t = thread.updatedAt
    if (t >= startToday) today.push(thread)
    else if (t >= sevenAgo) week.push(thread)
    else if (t >= thirtyAgo) month.push(thread)
    // older than 30 days drops off the launchpad entirely
  }

  today.sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.updatedAt - a.updatedAt)
  week.sort((a, b) => b.updatedAt - a.updatedAt)
  month.sort((a, b) => b.updatedAt - a.updatedAt)

  return [
    { label: 'Today', threads: today },
    { label: 'Last 7 days', threads: week },
    { label: 'Last 30 days', threads: month },
  ].filter((bucket) => bucket.threads.length > 0)
}

function HomePage() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const navigate = useNavigate()
  const { openPalette } = useCommandPalette()
  const [filter, setFilter] = useState('')

  function openThread(threadId: string) {
    tabsStore.open(threadId)
    void navigate({ to: '/thread/$threadId', params: { threadId } })
  }

  function newThread(projectId: string | null) {
    if (projectId) saveLastProjectId(projectId)
    const draft = draftsStore.create(projectId)
    tabsStore.open(draft.id)
    void navigate({ to: '/new/$draftId', params: { draftId: draft.id } })
  }

  // Fresh install: nothing to launch into yet. The wordmark carries the page;
  // adding the first project is the single warm action.
  if (chrome.projects.length === 0) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-9 pb-16'>
        <RansomWordmark lineH={92} />
        <div className='flex flex-col items-center gap-3'>
          {/* palette openers activate on click, not press: opening a dialog on
              pointer-down lets the same gesture's release dismiss it */}
          <button type='button' className={emberAction} onClick={() => openPalette('add-project')}>
            <FolderPlusIcon className='size-4' />
            New project
          </button>
          <p className='font-mono text-xs text-muted-foreground/60'>
            or press <span className={kbd}>⌘K</span>
          </p>
        </div>
      </div>
    )
  }

  const projectById = new Map(chrome.projects.map((p) => [p.id, p]))
  const query = filter.trim().toLowerCase()
  const visible = query
    ? chrome.threads.filter((thread) =>
        `${thread.title ?? ''} ${projectById.get(thread.projectId)?.title ?? ''}`
          .toLowerCase()
          .includes(query)
      )
    : chrome.threads
  const buckets = bucketThreads(visible)

  return (
    <div className='h-full scrollbar-gutter-stable-both overflow-y-auto'>
      <div className='mx-auto w-full max-w-[62rem] px-6 pt-14 pb-20'>
        <header className='mb-14 flex items-center'>
          {/* pl-2: optical alignment with the rail's row text below */}
          <RansomWordmark lineH={50} className='pl-2' />
        </header>

        <div className='grid grid-cols-1 gap-x-14 gap-y-10 md:grid-cols-3'>
          <aside className='order-2 flex flex-col md:order-1 md:col-span-1'>
            <button
              type='button'
              className={sideItem}
              {...pressHandlers(() => void navigate({ to: '/settings' }))}
            >
              <GearIcon className='size-4 shrink-0' />
              Settings
            </button>
            <button
              type='button'
              className={sideItem}
              {...pressHandlers(() => newThread(loadLastProjectId()))}
            >
              <PlusIcon className='size-4 shrink-0' />
              New thread
            </button>
            {/* palette opener activates on click, not press (overlay dismiss) */}
            <button type='button' className={sideItem} onClick={() => openPalette('add-project')}>
              <FolderPlusIcon className='size-4 shrink-0' />
              New project
            </button>
            {/* No archived view exists yet: visible but inert until it lands. */}
            <div className='flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground'>
              <ArchiveIcon className='size-4 shrink-0' />
              Archived threads
            </div>

            {chrome.usage && (
              <div className='mt-4 flex flex-col gap-3.5 px-2.5'>
                <UsageMeter
                  label='5h window'
                  pct={Math.round(chrome.usage.fiveHour.pct)}
                  resets={formatResetsAt(chrome.usage.fiveHour.resetsAt)}
                />
                <UsageMeter
                  label='Weekly limit'
                  pct={Math.round(chrome.usage.sevenDay.pct)}
                  dim
                  resets={formatResetsAt(chrome.usage.sevenDay.resetsAt)}
                />
              </div>
            )}

          </aside>

          <main className='order-1 md:order-2 md:col-span-2'>
            <InputGroup className='mb-6'>
              <InputGroupAddon>
                <MagnifyingGlassIcon className='size-4' />
              </InputGroupAddon>
              <InputGroupInput
                placeholder='Filter threads…'
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </InputGroup>
            {buckets.length === 0 && (
              <p className='px-2.5 font-mono text-xs text-muted-foreground/60'>
                {query ? 'no threads match' : 'no recent threads'}
              </p>
            )}
            {buckets.map((bucket) => (
              <section key={bucket.label} className='mb-8'>
                <h2 className={cn(sectionLabel, 'mb-1.5 px-2.5')}>{bucket.label}</h2>
                <ul className='flex flex-col'>
                  {bucket.threads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type='button'
                        className={row}
                        {...pressHandlers(() => openThread(thread.id))}
                      >
                        <StatusGlyph status={thread.status} />
                        <span className='min-w-0 flex-1 truncate text-sm'>
                          {thread.title || thread.id}
                        </span>
                        {thread.git && <GitTag git={thread.git} />}
                        <span className='hidden max-w-[8rem] shrink-0 truncate font-mono text-xs text-muted-foreground/50 sm:inline'>
                          {projectById.get(thread.projectId)?.title}
                        </span>
                        <span className='w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground/60'>
                          {relTime(thread.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </main>
        </div>
      </div>
    </div>
  )
}
