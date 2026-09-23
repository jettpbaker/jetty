import { PageSidebarTrigger } from '@/components/custom/page_sidebar_trigger'
import { ThreadComposer } from '@/components/custom/thread_composer'
import { ThreadDetailsLayout } from '@/components/custom/thread_details_layout'
import { ThreadHeader } from '@/components/custom/thread_header'
import { ThreadList } from '@/components/custom/thread_list'
import { threadSubagents } from '@/components/custom/thread_rows'
import {
  MAIN_TAB,
  useChrome,
  useRespondApproval,
  useRespondQuestion,
  useThread,
  useThreadOverlay,
  useThreadTab,
} from '@/state'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'

export const Route = createFileRoute('/threads/$threadId')({ component: Thread })

function Thread() {
  const { threadId } = Route.useParams()
  const thread = useThread(threadId)
  const overlay = useThreadOverlay(threadId, thread)
  const chrome = useChrome()
  const projectId = chrome?.threads.find((item) => item.id === threadId)?.projectId
  const projectPath = chrome?.projects.find((project) => project.id === projectId)?.path
  const respondApproval = useRespondApproval()
  const respondQuestion = useRespondQuestion()
  const [tab, setTab] = useThreadTab(threadId)
  const agents = useMemo(() => threadSubagents(overlay.items), [overlay.items])
  const agent = agents.find((entry) => entry.id === tab)
  const composer = (
    <ThreadComposer
      threadId={threadId}
      items={thread?.items ?? []}
      running={overlay.running}
      rows={overlay.empty ? 2 : 1}
      ambient={overlay.empty}
    />
  )
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
        <ThreadDetailsLayout threadId={threadId}>
          <ThreadHeader context={thread?.context ?? null} />
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
            agentId={agent?.id}
            onSelectAgent={setTab}
            onApproval={(itemId, approved) =>
              respondApproval(threadId, itemId, approved ? 'allow' : 'deny')
            }
            onAnswer={(itemId, answers) => respondQuestion(threadId, itemId, answers)}
          />
          {!agent && composer}
        </ThreadDetailsLayout>
      )}
    </section>
  )
}
