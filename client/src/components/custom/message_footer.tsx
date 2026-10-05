import type { TurnLoadout } from '@jetty/shared/events'

import { CopyButton } from '@/components/custom/copy_button'
import { describeLoadout } from '@/lib/loadout'
import { formatSentAt } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useModels } from '@/state'
import { catalogModelName } from '@jetty/shared/model-name'

import { SourceLabel } from './source_label'

// True reveals the whole footer on message hover or keyboard focus; false keeps the time and
// model showing and reveals only the copy button. Touch has no hover, so there it always shows.
const revealWholeFooter = true

const hidden = 'opacity-0 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100'
const footer = cn(
  'flex h-6 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground',
  revealWholeFooter &&
    `${hidden} transition-opacity has-focus-visible:opacity-100 motion-reduce:transition-none`
)
const copy = cn(
  !revealWholeFooter &&
    `${hidden} transition-[color,background-color,opacity] focus-visible:opacity-100`
)

function SentAt({ createdAt }: { createdAt: number }) {
  return (
    <time className='text-faint-foreground' dateTime={new Date(createdAt).toISOString()}>
      {formatSentAt(createdAt)}
    </time>
  )
}

export function UserMessageFooter({ text, createdAt }: { text: string; createdAt: number }) {
  return (
    <div className={cn(footer, 'self-end')}>
      <SentAt createdAt={createdAt} />
      {text && <CopyButton text={text} label='Copy message' className={copy} />}
    </div>
  )
}

export function AgentMessageFooter({
  text,
  createdAt,
  loadout,
  provider,
}: {
  text: string
  createdAt: number
  loadout?: TurnLoadout
  provider?: string
}) {
  return (
    <div className={cn(footer, 'self-start')}>
      <CopyButton text={text} label='Copy message' className={copy} />
      {loadout && <TurnModel loadout={loadout} provider={provider} />}
      <SentAt createdAt={createdAt} />
    </div>
  )
}

function TurnModel({ loadout, provider }: { loadout: TurnLoadout; provider?: string }) {
  const name = catalogModelName(useModels(), provider, loadout.model)
  const details = describeLoadout({ effort: loadout.effort, fast: loadout.fast ?? false })
  return (
    <SourceLabel provider={provider}>
      <span className='truncate'>{[name, details].filter(Boolean).join(' ')}</span>
    </SourceLabel>
  )
}
