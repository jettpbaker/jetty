import type { ChildReport, ThreadItem } from '@jetty/shared/items'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { useOpenSubagent } from '@/state'

import { inlineLinkClass, ThreadLink } from './entity_link'
import { Markdown } from './markdown'
import { SubagentGlyph, subagentGlyphState } from './subagent_glyph'
import { formatActivityDuration } from './work_model'

export const reportOutcomes = {
  finished: { status: 'done', verb: 'finished', time: 'worked for' },
  failed: { status: 'error', verb: 'failed', time: 'after' },
  interrupted: { status: 'stopped', verb: 'was stopped', time: 'after' },
  paused: { status: 'stopped', verb: 'paused', time: 'after' },
  asked: { status: 'monitoring', verb: 'asks', time: null },
} as const

// A child's report reads as one line in the parent's chat, with any question it asks shown under
// it; the parent agent gets the full text.
export function ChildReports({ reports }: { reports: readonly ChildReport[] }) {
  return (
    <Message align='start' className='pb-1'>
      <MessageContent>
        <Bubble variant='ghost' align='start'>
          <BubbleContent className='flex flex-col gap-1'>
            {reports.map((report, index) => {
              const { status, verb, time } = reportOutcomes[report.outcome]
              const worked = time && report.seconds > 0 && formatActivityDuration(report.seconds)
              return (
                <div key={`${report.threadId}:${index}`} className='flex flex-col gap-1'>
                  <p>
                    <ThreadLink id={report.threadId} outcome={status} fallback={report.title} />{' '}
                    <span className='text-muted-foreground'>
                      {verb}
                      {worked && `, ${time} ${worked}`}
                    </span>
                  </p>
                  {report.question && <Markdown>{report.question}</Markdown>}
                </div>
              )
            })}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

const subagentOutcomes = {
  completed: { verb: 'finished', time: 'worked for' },
  failed: { verb: 'failed', time: 'after' },
  stopped: { verb: 'was stopped', time: 'after' },
} as const

// A background subagent's finish, where its result reached the agent; it opens the subagent in the
// details pane.
export function SubagentDone({
  threadId,
  agent,
}: {
  threadId: string
  agent: Extract<ThreadItem, { kind: 'subagent' }>
}) {
  const open = useOpenSubagent()
  if (agent.status === 'running') return null
  const { verb, time } = subagentOutcomes[agent.status]
  const worked = agent.durationMs ? formatActivityDuration(agent.durationMs / 1000) : undefined
  return (
    <Message align='start' className='pb-1'>
      <MessageContent>
        <Bubble variant='ghost' align='start'>
          <BubbleContent>
            <p>
              <button
                type='button'
                className={inlineLinkClass}
                onClick={() => open(threadId, agent.id)}
              >
                <SubagentGlyph
                  state={subagentGlyphState(agent.status)}
                  className='mr-1 inline-block size-3.25 align-[-2px]'
                />
                {agent.title}
              </button>{' '}
              <span className='text-muted-foreground'>
                {verb}
                {worked && `, ${time} ${worked}`}
              </span>
            </p>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
