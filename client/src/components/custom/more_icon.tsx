import { cn } from '@/lib/utils'
import { DotsThreeVerticalIcon } from '@phosphor-icons/react'

export function MoreIcon({
  'data-icon': dataIcon,
  className,
}: {
  'data-icon'?: 'inline-start' | 'inline-end'
  className?: string
}) {
  return (
    <DotsThreeVerticalIcon
      data-icon={dataIcon}
      className={cn('size-3.5', className)}
      weight='bold'
      stroke='currentColor'
      strokeWidth={8}
      aria-hidden='true'
    />
  )
}
