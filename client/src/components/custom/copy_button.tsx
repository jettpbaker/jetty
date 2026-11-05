import { SquareBehindSquare1Icon, Checkmark1MediumIcon } from '@/components/custom/central_icons'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export function CopyButton({
  text,
  label,
  className,
  showLabel = false,
}: {
  text: string
  label: string
  className?: string
  showLabel?: boolean
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant={showLabel ? 'ghost-text' : 'ghost'}
      size={showLabel ? 'xs' : 'icon-xs'}
      className={className}
      aria-label={copied ? 'Copied' : label}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => toast.error("Couldn't copy")
        )
      }
    >
      {copied ? <Checkmark1MediumIcon /> : <SquareBehindSquare1Icon />}
      {showLabel && (copied ? 'Copied' : label)}
    </Button>
  )
}
