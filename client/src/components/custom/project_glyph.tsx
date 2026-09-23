import type { ProjectIcon } from '@jetty/shared/wire'

import { emojiUrl } from '@/lib/fluent_emoji'
import { cn } from '@/lib/utils'
import { RepoIcon } from '@primer/octicons-react'
import { Suspense, use, useState } from 'react'

type GlyphProps = { className?: string; 'data-icon'?: 'inline-start' }

let iconSet: Promise<typeof import('./project_icon_set')> | undefined

function loadProjectIconSet() {
  return (iconSet ??= import('./project_icon_set'))
}

function DefaultGlyph({ className, ...props }: GlyphProps) {
  return <RepoIcon aria-hidden='true' className={cn('icon-optical-down', className)} {...props} />
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

function IconGlyph({ name, className, ...props }: GlyphProps & { name: string }) {
  const Icon = use(loadProjectIconSet()).projectIconsByName.get(name)
  if (!Icon) return <DefaultGlyph className={className} {...props} />
  return <Icon aria-hidden='true' className={cn('shrink-0', className)} {...props} />
}

export function ProjectGlyph({ icon, ...props }: GlyphProps & { icon?: ProjectIcon }) {
  if (icon?.type === 'emoji') return <EmojiGlyph key={icon.emoji} emoji={icon.emoji} {...props} />
  if (icon?.type === 'icon')
    return (
      <Suspense
        fallback={
          <span aria-hidden='true' className={cn('inline-block shrink-0', props.className)} />
        }
      >
        <IconGlyph name={icon.name} {...props} />
      </Suspense>
    )
  return <DefaultGlyph {...props} />
}
