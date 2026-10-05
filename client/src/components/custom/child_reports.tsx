import type { ChildReport, ThreadItem } from '@jetty/shared/items'

import { DitherAvatar } from '@/components/dither-kit/avatar'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'

import { inlineLinkClass, ThreadLink } from './entity_link'
import { subagentAvatarColor } from './subagent_row'
import { formatActivityDuration } from './work_model'

const outcomes = {
  finished: { status: 'done', verb: 'finished', time: 'worked for' },
  failed: { status: 'error', verb: 'failed', time: 'after' },
  interrupted: { status: 'stopped', verb: 'was stopped', time: 'after' },
  paused: { status: 'stopped', verb: 'paused', time: 'after' },
} as const

// A child's report reads as one line in the parent's chat; the parent agent gets the full text.
export function ChildReports({ reports }: { reports: readonly ChildReport[] }) {
  return (
    <Message align='start' className='pb-1'>
      <MessageContent>
        <Bubble variant='ghost' align='start'>
          <BubbleContent className='flex flex-col gap-1'>
            {reports.map((report) => {
              const { status, verb, time } = outcomes[report.outcome]
              const worked = report.seconds > 0 && formatActivityDuration(report.seconds)
              return (
                <p key={report.threadId}>
                  <ThreadLink id={report.threadId} outcome={status} fallback={report.title} />{' '}
                  <span className='text-muted-foreground'>
                    {verb}
                    {worked && `, ${time} ${worked}`}
                  </span>
                </p>
              )
            })}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

const subagentOutcomes = {
  completed: { color: subagentAvatarColor.complete, verb: 'finished', time: 'worked for' },
  failed: { color: subagentAvatarColor.error, verb: 'failed', time: 'after' },
  stopped: { color: subagentAvatarColor.stopped, verb: 'was stopped', time: 'after' },
} as const

// A background subagent's finish, where its result reached the agent; it opens the subagent's tab.
export function SubagentDone({
  agent,
  onSelect,
}: {
  agent: Extract<ThreadItem, { kind: 'subagent' }>
  onSelect: (id: string) => void
}) {
  if (agent.status === 'running') return null
  const { color, verb, time } = subagentOutcomes[agent.status]
  const worked = agent.durationMs ? formatActivityDuration(agent.durationMs / 1000) : undefined
  return (
    <Message align='start' className='pb-1'>
      <MessageContent>
        <Bubble variant='ghost' align='start'>
          <BubbleContent>
            <p>
              <button type='button' className={inlineLinkClass} onClick={() => onSelect(agent.id)}>
                <DitherAvatar
                  name={agent.id}
                  mirror='horizontal'
                  animate={false}
                  color={color}
                  className='mr-1 inline-block size-3.5 align-[-2px]'
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
