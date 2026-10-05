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
const line = 'flex h-6 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground'
const footer = cn(
  line,
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

// A message steered into a running turn reads "Steering…" until the server has it, then
// "Steered" beside its time.
export function UserMessageFooter({
  text,
  createdAt,
  steered,
  steering,
}: {
  text: string
  createdAt: number
  steered?: boolean
  steering?: boolean
}) {
  if (steering)
    return (
      <div className={cn(line, 'self-end')}>
        <span className='shimmer px-1'>Steering…</span>
      </div>
    )
  return (
    <div className={cn(footer, 'self-end')}>
      {steered && (
        <>
          <span>Steered</span>
          <span aria-hidden='true'>·</span>
        </>
      )}
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
