import { ArrowTurnBackwardIcon, Cancel01Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// A quote is a whole reply's markdown or text selected from it. Only paired marks at word
// edges come off, so a selection's snake_case and arithmetic read as they did.
export function plainQuote(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(`+)(.+?)\1/g, '$2')
    .replace(/(?<!\w)(\*\*|__|~~|\*|_)(?=\S)(.+?)(?<=\S)\1(?!\w)/g, '$2')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, '')
    .trim()
}

// The quote the next message carries, at the top of the composer.
export function ReplyTab({
  text,
  onClear,
  className,
}: {
  text: string
  onClear: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 rounded-[14px] bg-accent pr-1 pl-2.5 text-13 text-muted-foreground',
        className
      )}
    >
      <ArrowTurnBackwardIcon className='size-3 shrink-0' />
      <span className='min-w-0 flex-1 truncate'>{plainQuote(text)}</span>
      <Button
        variant='ghost'
        size='icon-xs'
        aria-label='Clear reply'
        className='rounded-[10px]'
        onClick={onClear}
      >
        <Cancel01Icon />
      </Button>
    </div>
  )
}

// The quote a sent message carries, above its bubble; it jumps to what it quotes.
export function RepliedTo({
  text,
  onJump,
  className,
}: {
  text: string
  onJump: () => void
  className?: string
}) {
  return (
    <button
      type='button'
      onClick={onJump}
      className={cn(
        'flex max-w-[380px] min-w-0 items-center gap-1.5 self-end rounded-[14px] border border-border px-2.5 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      <ArrowTurnBackwardIcon className='size-3 shrink-0' />
      <span className='min-w-0 truncate'>{plainQuote(text)}</span>
    </button>
  )
}
