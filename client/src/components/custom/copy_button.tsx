import { Copy01Icon, Tick02Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant='ghost'
      tone='muted'
      size='icon-xs'
      className={className}
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
      }}
    >
      {copied ? <Tick02Icon /> : <Copy01Icon />}
    </Button>
  )
}

// Under a message, it shows while the message is hovered or the button has keyboard focus.
// Touch has no hover, so there it always shows.
export function MessageCopyButton({ text, align }: { text: string; align: 'start' | 'end' }) {
  return (
    <CopyButton
      text={text}
      label='Copy message'
      className={cn(
        'opacity-0 transition-[color,background-color,opacity] group-hover/message:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100',
        align === 'start' ? '-ml-1.5 self-start' : 'self-end'
      )}
    />
  )
}
