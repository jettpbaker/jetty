import { PencilEdit02Icon } from '@/components/custom/huge_icons'
import { Loading } from '@/components/custom/loading'
import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadComposer } from '@/components/custom/thread_composer'
import { ThreadDetailsLayout } from '@/components/custom/thread_details_layout'
import { ThreadHeader } from '@/components/custom/thread_header'
import { ThreadList } from '@/components/custom/thread_list'
import { threadSubagents } from '@/components/custom/thread_rows'
import { Button } from '@/components/ui/button'
import { useChatFeel } from '@/lib/chat-feel'
import { pressProps } from '@/lib/press'
import { settingUpWorktree } from '@/lib/thread_worktree'
import { perf } from '@/perf'
import {
  MAIN_TAB,
  useArchiveThread,
  useBumpDraft,
  useChromeReady,
  useMarkThreadSeen,
  useProject,
  useThread,
  useThreadMeta,
  useThreadOverlay,
  useThreadTab,
} from '@/state'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef } from 'react'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const chatFeel = useChatFeel()
  const thread = useThread(threadId)
  perf.threadLocal(threadId, thread !== undefined)
  useLayoutEffect(() => perf.threadShown(threadId, thread !== undefined))
  const overlay = useThreadOverlay(threadId, thread)
  const chromeReady = useChromeReady()
  const meta = useThreadMeta(threadId)
  const markSeen = useMarkThreadSeen()
  const readyForReview = useRef(false)
  // Updated in an effect, not during render: switching threads re-renders with the next
  // thread's flag before the previous thread's cleanup reads it.
  useEffect(() => {
    readyForReview.current = Boolean(meta?.readyForReview)
  }, [meta?.readyForReview])
  useEffect(
    () => () => {
      if (readyForReview.current) markSeen(threadId)
    },
    [markSeen, threadId]
  )
  const project = useProject(meta?.projectId)
  const projectPath = meta?.workingPath ?? project?.path
  const [tab, setTab] = useThreadTab(threadId)
  const archiveThread = useArchiveThread()
  const agents = threadSubagents(overlay.items)
  const agent = agents.find((entry) => entry.id === tab)
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
      {composerOnly && <PageSidebarTrigger standalone />}
      {composerOnly ? (
        <div className='flex min-h-0 flex-1 flex-col justify-center'>{composer}</div>
      ) : (
        <ThreadDetailsLayout threadId={threadId} projectPath={projectPath}>
          <ThreadHeader
            botId={meta?.botId}
            title={meta?.title}
            onUnarchive={meta?.archived ? () => archiveThread(threadId, false) : undefined}
          />
          {empty ? (
            <div className='flex min-h-0 flex-1 flex-col justify-center'>{composer}</div>
          ) : thread || !overlay.empty ? (
            <ThreadList
              key={`${threadId}:${agent?.id ?? MAIN_TAB}:${chatFeel}`}
              threadId={threadId}
              items={overlay.items}
              status={
                agent
                  ? agent.status === 'running'
                    ? 'running'
                    : 'idle'
                  : (thread?.status ?? 'idle')
              }
              running={agent ? false : overlay.running}
              settingUp={!agent && settingUpWorktree(meta)}
              outcomes={agent ? undefined : thread?.turnOutcomes}
              loadouts={agent ? undefined : thread?.turnLoadouts}
              projectPath={projectPath}
              provider={meta?.provider}
              agentId={agent?.id}
              onSelectAgent={setTab}
            />
          ) : (
            <div className='min-h-0 flex-1' />
          )}
          {/* A thread left on a subagent's tab reopens there, where there's no composer. */}
          {!empty && !agent && (thread || tab === MAIN_TAB) && composer}
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
          <PencilEdit02Icon />
          New thread
        </Button>
      </div>
    </section>
  )
}
