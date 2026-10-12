import type { ProjectIcon } from '@jetty/shared/wire'

import { Folder1Icon } from '@/components/custom/central_icons'
import { emojiUrl } from '@/lib/fluent_emoji'
import { cn } from '@/lib/utils'
import { useState } from 'react'

type GlyphProps = { className?: string; 'data-icon'?: 'inline-start' }

function DefaultGlyph(props: GlyphProps) {
  return <Folder1Icon aria-hidden='true' {...props} />
}

function EmojiGlyph({ emoji, className, ...props }: GlyphProps & { emoji: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <DefaultGlyph className={className} {...props} />
  return (
    <img
      src={emojiUrl(emoji)}
      alt=''
      aria-hidden='true'
      draggable={false}
      className={cn('shrink-0 select-none', className)}
      onError={() => setFailed(true)}
      {...props}
    />
  )
}

export function ProjectGlyph({ icon, ...props }: GlyphProps & { icon?: ProjectIcon }) {
  if (icon) return <EmojiGlyph key={icon.emoji} emoji={icon.emoji} {...props} />
  return <DefaultGlyph {...props} />
}
