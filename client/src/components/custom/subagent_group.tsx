import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
// No subagent item kind yet, so the thread view does not mount this.
import { ChevronRightIcon } from '@primer/octicons-react'

import { SubagentRow, formatSubagentTokens, type Subagent } from './subagent_row'

export function SubagentGroup({
  agents,
  defaultOpen = false,
  selectedId,
  onSelect,
}: {
  agents: readonly Subagent[]
  defaultOpen?: boolean
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const completed = agents.filter((agent) => agent.status === 'complete').length
  const failed = agents.filter((agent) => agent.status === 'error').length
  const totalTokens = agents.reduce((total, agent) => total + agent.tokens, 0)
  return (
    <Collapsible defaultOpen={defaultOpen} className='w-full min-w-0'>
      <CollapsibleTrigger
        disabled={agents.length === 0}
        render={<Button variant='ghost' />}
        className='group/subagents flex h-auto min-h-9 w-full flex-wrap items-center justify-start gap-x-2 gap-y-1 rounded-sm px-2.5 py-2 text-sm font-normal active:translate-y-0'
      >
        <ChevronRightIcon className='size-3 text-muted-foreground transition-transform duration-(--motion-control-duration) ease-(--motion-control-ease) group-aria-expanded/subagents:rotate-90 motion-reduce:transition-none' />
        <span>
          {agents.length
            ? `${agents.length} subagent${agents.length === 1 ? '' : 's'}`
            : 'No subagents'}
        </span>
        {agents.length > 0 && (
          <span className='ml-auto flex items-center gap-3 text-xs text-muted-foreground'>
            {(completed > 0 || failed > 0) && (
              <span>
                {completed > 0 && `${completed} complete`}
                {completed > 0 && failed > 0 && ', '}
                {failed > 0 && <span className='text-status-error'>{failed} failed</span>}
              </span>
            )}
            <span
              className='font-mono'
              aria-label={`${totalTokens.toLocaleString('en')} total tokens`}
            >
              {formatSubagentTokens(totalTokens)}
              <span className='sr-only'> tokens</span>
            </span>
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-1 flex flex-col gap-0.5'>
          {agents.map((agent) => (
            <SubagentRow
              key={agent.id}
              agent={agent}
              selected={selectedId === agent.id}
              onSelect={() => onSelect(agent.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
