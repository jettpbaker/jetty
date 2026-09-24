import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadComposer } from '@/components/custom/thread_composer'
import { ThreadDetailsLayout } from '@/components/custom/thread_details_layout'
import { ThreadHeader } from '@/components/custom/thread_header'
import { ThreadList } from '@/components/custom/thread_list'
import { threadSubagents } from '@/components/custom/thread_rows'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import {
  MAIN_TAB,
  useArchiveThread,
  useBumpDraft,
  useChrome,
  useMarkThreadSeen,
  useThread,
  useThreadOverlay,
  useThreadTab,
} from '@/state'
import { ComposeIcon } from '@primer/octicons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  const overlay = useThreadOverlay(threadId, thread)
  const chrome = useChrome()
  const meta = chrome?.threads.find((item) => item.id === threadId)
  const markSeen = useMarkThreadSeen()
  useEffect(() => {
    if (meta?.readyForReview) markSeen(threadId)
  }, [markSeen, threadId, meta?.readyForReview])
  const project = chrome?.projects.find((entry) => entry.id === meta?.projectId)
  const projectPath = meta?.environment === 'container' ? '/workspace' : project?.path
  const [tab, setTab] = useThreadTab(threadId)
  const archiveThread = useArchiveThread()
  const agents = useMemo(() => threadSubagents(overlay.items), [overlay.items])
  const agent = agents.find((entry) => entry.id === tab)
  const composer = (
    <ThreadComposer
      key={threadId}
      threadId={threadId}
      items={overlay.serverItems}
      running={overlay.running}
      rows={overlay.empty ? 2 : 1}
      ambient={overlay.empty}
      provider={meta?.provider}
      projectPath={projectPath}
      projectTitle={project?.title}
    />
  )
  if (chrome && !meta) return <ThreadNotFound />
  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='Thread'>
      {overlay.empty && <PageSidebarTrigger standalone />}
      {overlay.empty ? (
        thread ? (
          <div className='flex min-h-0 flex-1 flex-col justify-center'>{composer}</div>
        ) : (
          <p className='px-6 py-6 text-sm text-muted-foreground'>Loading…</p>
        )
      ) : (
        <ThreadDetailsLayout threadId={threadId} projectPath={projectPath}>
          <ThreadHeader
            context={thread?.context ?? null}
            containerThreadId={
              meta?.environment === 'container' && project?.containerServices ? threadId : undefined
            }
            onUnarchive={meta?.archived ? () => archiveThread(threadId, false) : undefined}
          />
          <ThreadList
            key={`${threadId}:${agent?.id ?? MAIN_TAB}`}
            threadId={threadId}
            items={overlay.items}
            status={
              agent ? (agent.status === 'running' ? 'running' : 'idle') : (thread?.status ?? 'idle')
            }
            running={agent ? false : overlay.running}
            outcomes={agent ? undefined : thread?.turnOutcomes}
            projectPath={projectPath}
            provider={meta?.provider}
            agentId={agent?.id}
            onSelectAgent={setTab}
          />
          {!agent && composer}
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
          <ComposeIcon />
          New thread
        </Button>
      </div>
    </section>
  )
}
