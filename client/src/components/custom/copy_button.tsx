import { Copy01Icon, Tick02Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
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
