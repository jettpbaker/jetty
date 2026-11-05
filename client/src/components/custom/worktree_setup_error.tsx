import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

import { ChevronRightSmallIcon } from './central_icons'
import { CopyButton } from './copy_button'

export function WorktreeSetupError({ error }: { error: string }) {
  return (
    <div className='flex min-w-0 flex-col gap-1 text-xs'>
      <p className='line-clamp-2 leading-5 text-muted-foreground wrap-anywhere'>
        {error.split('\n')[0]}
      </p>
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              variant='ghost-text'
              size='xs'
              className='-ml-3.5 px-0 [&[aria-expanded=true]>svg]:rotate-90'
            />
          }
        >
          <ChevronRightSmallIcon />
          View setup output
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className='mt-1 rounded-sm bg-background p-2'>
            <div className='mb-1 flex items-center justify-between text-muted-foreground'>
              <span>Setup output</span>
              <CopyButton text={error} label='Copy setup output' />
            </div>
            <pre
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a bounded output scrollport
              tabIndex={0}
              aria-label='Worktree setup output'
              className='scrollbar-subtle max-h-40 overflow-auto rounded-xs font-mono leading-5 whitespace-pre-wrap wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring'
            >
              {error}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
