import type { SessionStatus } from '@jetty/shared/events'

import {
  BellRingingIcon,
  ExclamationMarkIcon,
  MoonIcon,
  SpinnerIcon,
} from '@phosphor-icons/react'

export function StatusGlyph({ status }: { status: SessionStatus }) {
  switch (status) {
    case 'idle':
      return (
        <MoonIcon
          weight='fill'
          className='size-glyph shrink-0 translate-y-px text-muted-foreground/60'
        />
      )
    case 'running':
    case 'starting':
      return <SpinnerIcon className='size-glyph shrink-0 animate-spin text-muted-foreground' />
    case 'awaiting_approval':
      return <BellRingingIcon className='size-glyph shrink-0 text-amber-400' />
    case 'error':
      return <ExclamationMarkIcon className='size-glyph shrink-0 text-destructive' />
  }
}
