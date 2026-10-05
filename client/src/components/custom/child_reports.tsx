import type { ChildReport } from '@jetty/shared/items'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'

import { ThreadLink } from './entity_link'
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
    <Message align='start'>
      <MessageContent>
        <Bubble variant='ghost' align='start'>
          <BubbleContent className='flex flex-col gap-1'>
            {reports.map((report) => {
              const { status, verb, time } = outcomes[report.outcome]
              const worked = report.seconds > 0 && formatActivityDuration(report.seconds)
              return (
                <p key={report.threadId}>
                  <ThreadLink id={report.threadId} outcome={status} fallback={report.title} />{' '}
                  {verb}
                  {worked && `, ${time} ${worked}`}
                </p>
              )
            })}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
