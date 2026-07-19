import { cn } from '@/lib/utils'
import {
  BellRingingIcon,
  ChatCircleDotsIcon,
  HandPalmIcon,
  type Icon,
  PauseCircleIcon,
  SealQuestionIcon,
  WarningCircleIcon,
  WarningIcon,
  WarningOctagonIcon,
  XCircleIcon,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'

// Candidate glyphs for the two undesigned tab states: awaiting_approval
// ("the agent needs you") and error. The real bar ships interim picks
// (hand-palm / warning) — this rack exists to replace or confirm them.

function glyph(IconComponent: Icon, className: string): ReactNode {
  return <IconComponent className={cn('size-[18px] shrink-0', className)} />
}

const AWAITING: Array<{ caption: string; node: ReactNode }> = [
  { caption: 'hand palm (current interim)', node: glyph(HandPalmIcon, 'text-primary') },
  { caption: 'hand palm · amber', node: glyph(HandPalmIcon, 'text-amber-400') },
  { caption: 'bell ringing', node: glyph(BellRingingIcon, 'text-primary') },
  { caption: 'bell ringing · amber', node: glyph(BellRingingIcon, 'text-amber-400') },
  { caption: 'seal question', node: glyph(SealQuestionIcon, 'text-primary') },
  { caption: 'chat dots', node: glyph(ChatCircleDotsIcon, 'text-primary') },
  { caption: 'pause circle', node: glyph(PauseCircleIcon, 'text-primary') },
]

const ERROR: Array<{ caption: string; node: ReactNode }> = [
  { caption: 'warning (current interim)', node: glyph(WarningIcon, 'text-destructive') },
  { caption: 'warning circle', node: glyph(WarningCircleIcon, 'text-destructive') },
  { caption: 'warning octagon', node: glyph(WarningOctagonIcon, 'text-destructive') },
  { caption: 'x circle', node: glyph(XCircleIcon, 'text-destructive') },
]

function CandidateRow({ caption, node }: { caption: string; node: ReactNode }) {
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <div className='flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md bg-[#2B2C2D] px-2.5 text-sm text-foreground'>
        {node}
        <span className='min-w-0 flex-1 truncate'>Vue perf exploration</span>
      </div>
      <div className='flex h-8 w-44 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground'>
        {node}
        <span className='min-w-0 flex-1 truncate'>Vue perf exploration</span>
      </div>
      <span className='text-muted-foreground text-xs'>{caption}</span>
    </div>
  )
}

export function GlyphCandidates() {
  return (
    <section className='flex flex-col gap-4'>
      <div className='font-mono text-[10px] text-muted-foreground uppercase tracking-widest'>
        jett · awaiting_approval candidates
      </div>
      <div className='flex flex-col gap-3'>
        {AWAITING.map((candidate) => (
          <CandidateRow key={candidate.caption} {...candidate} />
        ))}
      </div>
      <div className='mt-4 font-mono text-[10px] text-muted-foreground uppercase tracking-widest'>
        jett · error candidates
      </div>
      <div className='flex flex-col gap-3'>
        {ERROR.map((candidate) => (
          <CandidateRow key={candidate.caption} {...candidate} />
        ))}
      </div>
    </section>
  )
}
