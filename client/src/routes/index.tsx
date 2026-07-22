import type { SessionStatus } from '@jetty/shared/events'
import type { Project, ThreadGitStatus } from '@jetty/shared/wire'

import { chromeStore, draftsStore, tabsStore } from '@/app-state'
import { useCommandPalette } from '@/components/command-palette'
import { RansomWordmark } from '@/components/ransom-wordmark'
import { loadLastProjectId, saveLastProjectId } from '@/lib/draft'
import { pressHandlers } from '@/lib/press-handlers'
import { cn } from '@/lib/utils'
import {
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@phosphor-icons/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const RECENT_LIMIT = 12

// One deliberate ember moment per page: the primary action wears the code chip.
const emberAction =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-code px-3 text-sm font-medium text-code-foreground transition-colors outline-none hover:bg-[color-mix(in_oklch,var(--code),var(--code-foreground)_16%)] focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px'

const kbd =
  'rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground'

const row =
  'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted'

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

function StatusDot({ status }: { status: SessionStatus }) {
  // awaiting_approval is the launchpad's attention beat — an amber pip with a
  // soft ring so a blocked agent draws the eye without shouting.
  const cls: Record<SessionStatus, string> = {
    starting: 'bg-muted-foreground animate-pulse',
    running: 'bg-muted-foreground animate-pulse',
    awaiting_approval: 'bg-amber-400 ring-3 ring-amber-400/20',
    error: 'bg-destructive',
    idle: 'bg-muted-foreground/35',
  }
  return <span className={cn('size-1.5 shrink-0 rounded-full', cls[status])} />
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

function HomePage() {
  const chrome = useSyncExternalStore(chromeStore.subscribe, chromeStore.getSnapshot)
  const navigate = useNavigate()
  const { openPalette } = useCommandPalette()

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
  const recent = chrome.threads
    .filter((thread) => !thread.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, RECENT_LIMIT)

  const lastActivity = new Map<string, number>()
  for (const thread of chrome.threads) {
    lastActivity.set(
      thread.projectId,
      Math.max(lastActivity.get(thread.projectId) ?? 0, thread.updatedAt)
    )
  }
  const projects = [...chrome.projects].sort(
    (a, b) => (lastActivity.get(b.id) ?? b.createdAt) - (lastActivity.get(a.id) ?? a.createdAt)
  )

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto w-full max-w-2xl px-2 pt-14 pb-20'>
        <header className='mb-14 flex items-center justify-between gap-4'>
          <RansomWordmark lineH={50} />
          <button
            type='button'
            className={emberAction}
            {...pressHandlers(() => newThread(loadLastProjectId()))}
          >
            <PlusIcon className='size-4' />
            New thread
          </button>
        </header>

        {recent.length > 0 && (
          <section className='mb-11'>
            <div className='mb-1.5 flex items-center justify-between px-2.5'>
              <h2 className={sectionLabel}>Resume</h2>
              <button
                type='button'
                className='flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground'
                onClick={() => openPalette()}
              >
                <MagnifyingGlassIcon className='size-3' />
                search
                <span className={kbd}>⌘K</span>
              </button>
            </div>
            <ul className='flex flex-col'>
              {recent.map((thread) => (
                <li key={thread.id}>
                  <button
                    type='button'
                    className={row}
                    {...pressHandlers(() => openThread(thread.id))}
                  >
                    <StatusDot status={thread.status} />
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
        )}

        <section>
          <h2 className={cn(sectionLabel, 'mb-1.5 px-2.5')}>Projects</h2>
          <ul className='flex flex-col'>
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectRow project={project} onOpen={() => newThread(project.id)} />
              </li>
            ))}
            <li>
              <button type='button' className={row} onClick={() => openPalette('add-project')}>
                <FolderPlusIcon className='size-4 shrink-0 text-muted-foreground' />
                <span className='text-sm text-muted-foreground'>New project</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button type='button' className={row} {...pressHandlers(onOpen)}>
      <FolderIcon className='size-4 shrink-0 text-muted-foreground' />
      <span className='shrink-0 truncate text-sm'>{project.title}</span>
      <span className='min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground/45'>
        {project.path}
      </span>
      <span className='flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/0 transition-colors group-hover:text-muted-foreground'>
        <PlusIcon className='size-3' />
        thread
      </span>
    </button>
  )
}
