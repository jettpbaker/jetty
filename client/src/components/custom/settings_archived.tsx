import type { ArchivedSearchFields } from '@jetty/shared/search'
import type { Project, ThreadMeta } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNow } from '@/hooks/use-now'
import { inComposition } from '@/lib/composition'
import { formatAge, formatSentAt } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useArchiveThread, useBot, useChrome, useChromeReady, useDeleteThread } from '@/state'
import {
  archivedSearchDoc,
  retainArchivedSearchDocs,
  useArchivedMessageSearch,
} from '@/state/archived'
import { rankArchivedSearch } from '@jetty/shared/search'
import { Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  ArrowOutOfBoxIcon,
  CrossSmallIcon,
  DotGrid1x3VerticalTightIcon,
  MagnifyingGlass2Icon,
  TrashCanSimpleIcon,
} from './central_icons'
import { JettyBot } from './jetty_bot'
import { OverflowTitle } from './overflow_title'
import { ProjectGlyph } from './project_glyph'
import { SettingsPage, SettingsSection, cardClass } from './settings_layout'
import { threadPullRequests } from './sidebar_thread_groups'
import { PullRequestMark } from './thread_pull_request'
import { StatusGlyph, threadStatus } from './thread_status'

function archivedFields(
  thread: ThreadMeta,
  project: string,
  messages: string
): ArchivedSearchFields {
  const links = thread.pullRequests ?? []
  const pr: string[] = []
  for (const link of links) pr.push(`${link.repo} ${link.number} ${link.title ?? ''}`)
  return {
    title: thread.title,
    project,
    branch: thread.worktree?.branch ?? thread.git?.branch ?? '',
    pr: pr.join('\n'),
    messages,
  }
}

function archivedTime(thread: ThreadMeta) {
  return thread.archivedAt ?? thread.updatedAt
}

function compareArchived(a: ThreadMeta, b: ThreadMeta) {
  const time = archivedTime(b) - archivedTime(a)
  if (time !== 0) return time
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function sectionTitle(count: number, searching: boolean, waiting: boolean) {
  if (waiting) return 'Archived threads'
  if (searching) return count === 1 ? '1 match' : `${count} matches`
  return count === 1 ? '1 thread' : `${count} threads`
}

function emptyCopy(searching: boolean, waiting: boolean) {
  if (!searching) return 'No archived threads.'
  if (waiting) return 'Looking through messages…'
  return 'No threads match.'
}

function ArchivedRow({
  thread,
  project,
  snippet,
  now,
  onRestore,
  onDelete,
}: {
  thread: ThreadMeta
  project?: Project
  snippet?: string
  now: number
  onRestore: () => void
  onDelete: () => void
}) {
  const bot = useBot(thread.botId)
  const branch = thread.worktree?.branch ?? thread.git?.branch ?? ''
  const links = threadPullRequests(thread.pullRequests ?? [])
  const when = archivedTime(thread)
  const age = formatAge(when, now)
  const onePullRequest = links.pullRequests.length === 1 ? links.pullRequests[0] : undefined
  return (
    <li className='flex items-center gap-3 py-2.5'>
      <Link
        to='/threads/$threadId'
        params={{ threadId: thread.id }}
        data-overflow-hover
        className='flex min-w-0 grow flex-col gap-0.5 rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <span className='flex min-w-0 items-center gap-1.5'>
          <StatusGlyph status={threadStatus(thread.status, thread.readyForReview)} />
          {bot && (
            // The face's slot is a pixel narrower than the face, as the board draws it.
            <span className='relative h-3.5 w-[13px] shrink-0'>
              <JettyBot
                shape={bot.shape}
                color={bot.color}
                size={14}
                className='absolute top-0 -left-px'
              />
            </span>
          )}
          <OverflowTitle focusable={false} className='text-13 font-normal leading-normal'>
            {thread.title}
          </OverflowTitle>
          {links.pullRequests.length > 0 && (
            <span className='flex shrink-0 items-center gap-1.5'>
              <PullRequestMark
                pullRequests={links.pullRequests}
                tooltip={false}
                compact={onePullRequest !== undefined}
              />
              {onePullRequest && (
                <span className='font-mono text-xs text-muted-foreground'>
                  #{onePullRequest.number}
                </span>
              )}
            </span>
          )}
        </span>
        <span className='flex min-w-0 items-center gap-1.5 pl-5 text-xs text-muted-foreground'>
          <ProjectGlyph icon={project?.icon} className='size-3 shrink-0' />
          {project && <span className='truncate'>{project.title}</span>}
          {branch && (
            <>
              {project && <span aria-hidden='true'>·</span>}
              <span className='truncate font-mono'>{branch}</span>
            </>
          )}
        </span>
        {snippet && <span className='truncate pl-5 text-xs text-muted-foreground'>{snippet}</span>}
      </Link>
      <span
        className='shrink-0 font-mono text-xs text-muted-foreground'
        title={formatSentAt(when)}
        aria-label={age === 'now' ? 'Archived just now' : `Archived ${age} ago`}
      >
        {age}
      </span>
      <Button
        variant='ghost'
        size='sm'
        tone='muted'
        aria-label={`Restore ${thread.title}`}
        onClick={onRestore}
      >
        <ArrowOutOfBoxIcon />
        Restore
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={<Button variant='ghost' size='icon-sm' aria-label={`More for ${thread.title}`} />}
        >
          <DotGrid1x3VerticalTightIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem variant='destructive' onClick={onDelete}>
            <TrashCanSimpleIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

export function SettingsArchived() {
  const chrome = useChrome()
  const chromeReady = useChromeReady()
  const archiveThread = useArchiveThread()
  const deleteThread = useDeleteThread()
  const now = useNow(60_000)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const archived = useMemo(
    () => (chrome?.threads ?? []).filter((thread) => thread.archived),
    [chrome]
  )
  const { hits, settled, failed } = useArchivedMessageSearch(query)
  const hitById = useMemo(() => new Map((hits ?? []).map((hit) => [hit.id, hit])), [hits])
  const prepared = useMemo(() => {
    const projects = new Map((chrome?.projects ?? []).map((project) => [project.id, project]))
    retainArchivedSearchDocs(archived.map((thread) => thread.id))
    return archived.map((thread) => {
      const project = projects.get(thread.projectId)
      const fields = archivedFields(thread, project?.title ?? '', '')
      return { thread, project, doc: archivedSearchDoc(thread.id, fields) }
    })
  }, [archived, chrome])
  const searching = query.trim().length > 0
  const ranked = useMemo(
    () =>
      searching
        ? rankArchivedSearch(
            query,
            prepared.map((row) => row.doc),
            hitById,
            prepared.map((row) => row.thread.id)
          )
        : [],
    [hitById, prepared, query, searching]
  )
  const rows = useMemo(() => {
    const listed = prepared.flatMap((row, index) => {
      const rank = ranked[index]
      const score = rank?.score ?? 0
      if (searching && score <= 0) return []
      return [{ ...row, score, snippet: rank?.snippet }]
    })
    listed.sort(
      (a, b) => (searching ? b.score - a.score : 0) || compareArchived(a.thread, b.thread)
    )
    return listed
  }, [prepared, ranked, searching])
  const waiting = searching && rows.length === 0 && !settled && !failed
  function remove(thread: ThreadMeta) {
    const deletion = deleteThread(thread.id)
    toast('Thread deleted', {
      action: { label: 'Undo', onClick: deletion.undo },
      onAutoClose: deletion.commit,
      onDismiss: deletion.commit,
    })
  }
  return (
    <SettingsPage
      title='Archived threads'
      description='Archived threads from every project. Restore puts one back, and a worktree thread checks its branch out again.'
    >
      <SettingsSection
        id='archived-threads'
        title={chromeReady ? sectionTitle(rows.length, searching, waiting) : undefined}
      >
        <label className='flex h-7.5 shrink-0 items-center gap-2 rounded-sm bg-foreground/6 px-2 text-muted-foreground focus-within:shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_70%,transparent),0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]'>
          <MagnifyingGlass2Icon />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (inComposition(event.nativeEvent)) return
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              }
            }}
            placeholder='Search archived threads'
            aria-label='Search archived threads'
            className='min-w-0 flex-1 bg-transparent text-13 text-foreground outline-none placeholder:text-muted-foreground'
          />
          {query && (
            <button
              type='button'
              aria-label='Clear search'
              className='flex shrink-0 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5'
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <CrossSmallIcon />
            </button>
          )}
        </label>
        <ul
          aria-label='Archived threads'
          className={cn(cardClass, 'flex flex-col divide-y divide-border px-4')}
        >
          {rows.map((row) => (
            <ArchivedRow
              key={row.thread.id}
              thread={row.thread}
              project={row.project}
              snippet={row.snippet}
              now={now}
              onRestore={() => archiveThread(row.thread.id, false)}
              onDelete={() => remove(row.thread)}
            />
          ))}
          {chromeReady && rows.length === 0 && (
            <li className='flex min-h-15 items-center text-13 text-muted-foreground'>
              {emptyCopy(searching, waiting)}
            </li>
          )}
        </ul>
      </SettingsSection>
    </SettingsPage>
  )
}
