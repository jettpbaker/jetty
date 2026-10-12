import { BotTabStrip } from '@/components/custom/bot_tab_strip'
import { EditSmall1Icon } from '@/components/custom/central_icons'
import { Loading } from '@/components/custom/loading'
import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadComposer } from '@/components/custom/thread_composer'
import { ThreadDetailsLayout } from '@/components/custom/thread_details_layout'
import { ThreadHeader } from '@/components/custom/thread_header'
import { ThreadList } from '@/components/custom/thread_list'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { settingUpWorktree } from '@/lib/thread_worktree'
import { perf } from '@/perf'
import {
  useArchiveThread,
  useBumpDraft,
  useChromeReady,
  useProject,
  useThread,
  useThreadMeta,
  useThreadOverlay,
} from '@/state'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  perf.threadLocal(threadId, thread !== undefined)
  useLayoutEffect(() => perf.threadShown(threadId, thread !== undefined))
  const overlay = useThreadOverlay(threadId, thread)
  const chromeReady = useChromeReady()
  const meta = useThreadMeta(threadId)
  const project = useProject(meta?.projectId)
  const projectPath = meta?.workingPath ?? project?.path
  const archiveThread = useArchiveThread()
  // Until the thread loads, a thread that has never started a turn is taken to be empty. Threads
  // from before turn times were recorded only have their provider to show for it. A first message
  // held in the queue (its worktree setup stopped or failed) still shows in the chat.
  const started = meta?.turnStartedAt !== undefined || meta?.provider !== undefined
  const empty =
    overlay.empty && !meta?.pendingMessages?.length && (thread !== undefined || !started)
  const composerOnly = empty && !meta?.pullRequests?.length
  const composer = (
    <ThreadComposer
      key={threadId}
      threadId={threadId}
      items={overlay.serverItems}
      running={overlay.running}
      rows={empty ? 2 : 1}
      ambient={empty}
      loading={!thread}
      provider={meta?.provider}
      projectPath={projectPath}
      projectTitle={project?.title}
    />
  )
  if (chromeReady && !meta) return <ThreadNotFound />
  if (!meta && !thread && overlay.empty)
    return (
      <section className='flex h-full min-h-0 flex-col' aria-label='Thread'>
        <PageSidebarTrigger standalone />
        <Loading label='Loading thread…' />
      </section>
    )
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='Thread'>
      {composerOnly &&
        (meta?.botId ? (
          <BotTabStrip botId={meta.botId} threadId={threadId} />
        ) : (
          <PageSidebarTrigger standalone />
        ))}
      {composerOnly ? (
        <div className='flex min-h-0 flex-1 flex-col justify-center'>{composer}</div>
      ) : (
        <ThreadDetailsLayout threadId={threadId} projectPath={projectPath}>
          <ThreadHeader
            threadId={threadId}
            botId={meta?.botId}
            onUnarchive={meta?.archived ? () => archiveThread(threadId, false) : undefined}
          />
          {empty ? (
            <div className='flex min-h-0 flex-1 flex-col justify-center'>{composer}</div>
          ) : thread || !overlay.empty ? (
            <ThreadList
              // The composer beside it is keyed by the thread too; a shared key leaves the last
              // thread's transcript behind.
              key={`${threadId}:list`}
              threadId={threadId}
              items={overlay.items}
              status={thread?.status ?? 'idle'}
              running={overlay.running}
              settingUp={settingUpWorktree(meta)}
              outcomes={thread?.turnOutcomes}
              loadouts={thread?.turnLoadouts}
              projectPath={projectPath}
              provider={meta?.provider}
            />
          ) : (
            <div className='min-h-0 flex-1' />
          )}
          {!empty && composer}
        </ThreadDetailsLayout>
      )}
    </section>
  )
}

function ThreadNotFound() {
  const navigate = useNavigate()
  const bumpDraft = useBumpDraft()
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='Thread'>
      <PageSidebarTrigger standalone />
      <div className='flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center'>
        <p className='text-sm'>Thread not found</p>
        <Button
          variant='outline'
          size='sm'
          {...pressProps(() => {
            bumpDraft()
            void navigate({ to: '/' })
          })}
        >
          <EditSmall1Icon />
          New thread
        </Button>
      </div>
    </section>
  )
}
