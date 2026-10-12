import type { QuestionActivity } from './work_model'

import { ActivityDisclosure } from './activity_disclosure'
import { SourceLabel } from './source_label'

export function QuestionBlock({ activity }: { activity: QuestionActivity }) {
  const { item, source } = activity
  const state = item.answers ? 'Answered' : item.dismissed ? 'Dismissed' : 'Skipped'
  return (
    <ActivityDisclosure
      title={`${state} question`}
      ended
      renderContent={() => (
        <div className='pl-2'>
          {source && <SourceLabel className='pb-1'>{source}</SourceLabel>}
          <dl className='thinking-text flex flex-col gap-2 whitespace-pre-wrap'>
            {item.questions.map((question) => (
              <div key={question.question}>
                <dt className='text-foreground'>{question.question}</dt>
                <dd>{item.answers?.[question.question] ?? state}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    />
  )
}
