import type { ReactNode } from 'react'

export function PullRequestHeader({
  repo,
  number,
  title,
  sidebar,
  navigation,
  actions,
}: {
  repo: string
  number: number
  title?: string
  sidebar?: ReactNode
  navigation: ReactNode
  actions: ReactNode
}) {
  return (
    <header className='flex shrink-0 flex-wrap items-center gap-x-3 border-b border-border px-4 @min-[800px]:grid @min-[800px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'>
      <div
        className='flex min-h-(--app-tab-bar-height) min-w-0 basis-full items-center gap-2'
        title={`${repo}#${number}${title ? ` · ${title}` : ''}`}
      >
        {sidebar}
        <span className='shrink-0 font-mono text-xs text-muted-foreground'>
          <span className={title ? 'sr-only' : undefined}>{repo}</span>#{number}
        </span>
        {title && <span className='truncate text-sm font-medium'>{title}</span>}
      </div>
      {navigation}
      <div className='ml-auto flex min-h-(--app-tab-bar-height) items-center gap-1'>{actions}</div>
    </header>
  )
}
