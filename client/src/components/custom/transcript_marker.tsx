import {
  Tick02Icon,
  Comment01Icon,
  Cancel01Icon,
  HistoryIcon,
  PauseIcon,
  Refresh01Icon,
} from '@/components/custom/huge_icons'
import { RESTART_LIMIT, RESTART_WINDOW_MS } from '@jetty/shared/items'

import { ChatSeam, ChatSeamAction, SeamIcon } from './chat_seam'
import { Code } from './composer_strip'
import { approvalView, type ApprovalItem, type QuestionItem } from './composer_strip_model'
import { SourceLabel } from './source_label'

type Tone = 'allow' | 'deny' | 'answer' | 'dismiss'

const markerIcons: Record<Tone, typeof Tick02Icon> = {
  allow: Tick02Icon,
  deny: Cancel01Icon,
  answer: Comment01Icon,
  dismiss: Cancel01Icon,
}

function approvalMarker(item: ApprovalItem, projectPath: string | undefined) {
  const { target, always } = approvalView(item, projectPath)
  if (item.decision === 'always')
    return {
      tone: 'allow' as const,
      text: (
        <>
          <span className='shrink-0'>Always allowed</span>
          <Code>{always?.patterns.join(', ') ?? target}</Code>
        </>
      ),
    }
  if (item.decision === 'allow')
    return {
      tone: 'allow' as const,
      text: (
        <>
          <span className='shrink-0'>Allowed</span>
          <Code>{target}</Code>
        </>
      ),
    }
  return {
    tone: 'deny' as const,
    text: (
      <>
        <span className='shrink-0'>Denied</span>
        <Code className='max-w-60 shrink-0'>{target}</Code>
        {item.deniedReason && <span className='truncate'>— “{item.deniedReason}”</span>}
      </>
    ),
  }
}

function questionMarker(item: QuestionItem) {
  const { answers } = item
  if (!answers)
    return {
      tone: 'dismiss' as const,
      text: (
        <span className='truncate'>
          {item.dismissed ? 'Dismissed' : 'Skipped'} “{item.questions[0]?.question}”
        </span>
      ),
    }
  return {
    tone: 'answer' as const,
    text: (
      <span className='truncate'>
        Answered{' '}
        {item.questions.map((question, index) => (
          <span key={question.question}>
            {index > 0 && ' · '}
            {question.header || question.question}:{' '}
            <span className='text-foreground'>{answers[question.question]}</span>
          </span>
        ))}
      </span>
    ),
  }
}

export function TranscriptMarker({
  item,
  source,
  provider,
  projectPath,
}: {
  item: ApprovalItem | QuestionItem
  source?: string
  provider?: string
  projectPath?: string
}) {
  const { tone, text } =
    item.kind === 'approval' ? approvalMarker(item, projectPath) : questionMarker(item)
  const Icon = markerIcons[tone]
  return (
    <div
      data-marker={tone}
      className='flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'
    >
      <Icon className='size-3 shrink-0' />
      {source && (
        <>
          <SourceLabel provider={provider} className='shrink-0'>
            <span className='max-w-52 truncate'>{source}</span>
          </SourceLabel>
          <span aria-hidden='true'>·</span>
        </>
      )}
      <span className='flex min-w-0 items-center gap-1.5'>{text}</span>
    </div>
  )
}

export function CompactionSeam({ running }: { running: boolean }) {
  return (
    <ChatSeam>
      <SeamIcon icon={HistoryIcon} />
      {running ? <span className='shimmer'>Compacting</span> : 'Compacted'}
    </ChatSeam>
  )
}

export function RestartSeam() {
  return (
    <ChatSeam>
      <SeamIcon icon={Refresh01Icon} />
      <span className='truncate'>Jetty restarted</span>
    </ChatSeam>
  )
}

// Resume stays disabled until the app can resume a held turn.
export function RestartLimitSeam({ resumed }: { resumed: boolean }) {
  return (
    <ChatSeam>
      <SeamIcon icon={PauseIcon} />
      <span className='truncate'>
        Paused after {RESTART_LIMIT} restarts in {RESTART_WINDOW_MS / 60_000} minutes
      </span>
      {resumed ? (
        <span className='px-1'>Resumed</span>
      ) : (
        <ChatSeamAction disabled>Resume</ChatSeamAction>
      )}
    </ChatSeam>
  )
}
