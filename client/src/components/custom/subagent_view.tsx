import { useNow } from '@/hooks/use-now'
import { formatDuration } from '@/lib/time'
import { useThread } from '@/state'

import { Disclosure } from './jetty_result_rows'
import { Markdown } from './markdown'
import { formatSubagentTokens } from './subagent_glyph'
import { ThreadList } from './thread_list'
import { subagentLabel, threadSubagents } from './thread_rows'

// A subagent's own transcript in the details pane, under what it was asked to do.
export function SubagentView({
  threadId,
  agentId,
  projectPath,
}: {
  threadId: string
  agentId: string
  projectPath?: string
}) {
  const thread = useThread(threadId)
  const items = thread?.items ?? []
  const agent = threadSubagents(items).find((item) => item.id === agentId)
  const outcome = agent ? thread?.turnOutcomes[agent.turnId] : undefined
  // Stop can leave the item running. The transcript follows the spawn turn, so its tools stop too.
  const running =
    agent?.status === 'running' && outcome !== 'interrupted' && outcome !== 'server_restarted'
  const now = useNow(1000, running)
  if (!agent) return null
  const seconds =
    (agent.durationMs ?? Math.max(0, (agent.completedAt ?? now) - agent.createdAt)) / 1000
  const facts = [
    { key: 'type', text: agent.agentType },
    { key: 'model', text: subagentLabel(agent) },
    {
      key: 'tokens',
      text: agent.tokens ? `${formatSubagentTokens(agent.tokens)} tokens` : '',
      mono: true,
    },
    { key: 'time', text: formatDuration(seconds), mono: true },
  ].filter((fact) => fact.text)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* The transcript below reserves a scrollbar gutter on both edges; this one keeps in line. */}
      <div className='scrollbar-subtle shrink-0 overflow-hidden px-6 pt-4 text-13 text-muted-foreground [scrollbar-gutter:stable_both-edges]'>
        <p className='flex flex-wrap gap-x-1.5'>
          {facts.map((fact, index) => (
            <span key={fact.key} className={fact.mono ? 'font-mono' : undefined}>
              {index > 0 && <span aria-hidden='true'>· </span>}
              {fact.text}
            </span>
          ))}
        </p>
        {agent.prompt && (
          <div className='mt-2.5'>
            <Disclosure title='Prompt' flush>
              <Markdown className='py-1 text-13 leading-relaxed text-foreground'>
                {agent.prompt}
              </Markdown>
            </Disclosure>
          </div>
        )}
      </div>
      <ThreadList
        key={agentId}
        threadId={threadId}
        items={items}
        status={running ? 'running' : 'idle'}
        running={false}
        projectPath={projectPath}
        agentId={agentId}
      />
    </div>
  )
}
