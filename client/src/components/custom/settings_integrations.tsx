import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ArrowClockwiseIcon, ArrowUpRightIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { MarkGithubIcon } from '@primer/octicons-react'
import { useState, type ReactNode } from 'react'

type Example = { state: 'connected' | 'signed-out' | 'missing' | 'error'; detail: string }
const examples: Example[] = [
  { state: 'connected', detail: 'Connected through GitHub CLI' },
  { state: 'signed-out', detail: 'Sign in with GitHub CLI' },
  { state: 'missing', detail: 'GitHub CLI isn’t installed' },
  { state: 'error', detail: 'Couldn’t check connection' },
]

const actionClass =
  '-mr-2 inline-flex h-7 items-center justify-end gap-1.5 rounded-sm border border-transparent px-2 text-xs'
function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden='true'
      className='flex size-4 shrink-0 items-center justify-center [&_svg]:size-3'
    >
      {children}
    </span>
  )
}

function GitHubConnection({ example }: { example: Example }) {
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')
  const connected = example.state === 'connected'
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText('gh auth login')
      setCopied(true)
      setMessage('Copied — run in your terminal')
    } catch {
      setMessage('Couldn’t copy — run gh auth login')
    }
  }
  return (
    <section
      aria-label={`GitHub — ${example.detail}`}
      className='flex flex-wrap items-center justify-between gap-x-4 gap-y-3'
    >
      <div className='flex items-center gap-3'>
        <MarkGithubIcon size={20} className='shrink-0 text-muted-foreground' />
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <h3 className='text-13'>GitHub</h3>
            {connected && <span className='text-xs text-muted-foreground'>@jettb</span>}
          </div>
          <p role='status' className='text-xs text-muted-foreground'>
            {message || example.detail}
          </p>
        </div>
      </div>
      {connected ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost-text'
                size='sm'
                className={actionClass}
                aria-label='Check GitHub connection'
                onClick={() => setMessage('Preview: connection checked')}
              />
            }
          >
            <ActionIcon>
              <ArrowClockwiseIcon />
            </ActionIcon>
          </TooltipTrigger>
          <TooltipContent>Check connection</TooltipContent>
        </Tooltip>
      ) : example.state === 'signed-out' ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost-text'
                size='sm'
                className={actionClass}
                aria-label='Copy GitHub sign-in command'
                onClick={() => void copyCommand()}
              />
            }
          >
            <code className='text-xs'>gh auth login</code>
            <ActionIcon>{copied ? <CheckIcon /> : <CopyIcon />}</ActionIcon>
          </TooltipTrigger>
          <TooltipContent>Copy command, run in your terminal, then refresh</TooltipContent>
        </Tooltip>
      ) : example.state === 'missing' ? (
        <a
          href='https://cli.github.com/'
          target='_blank'
          rel='noreferrer'
          className={`${actionClass} font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring`}
        >
          Install
          <ActionIcon>
            <ArrowUpRightIcon />
          </ActionIcon>
        </a>
      ) : (
        <Button
          variant='ghost-text'
          size='sm'
          className={actionClass}
          onClick={() => setMessage('Preview: connection still unavailable')}
        >
          Retry
          <ActionIcon>
            <ArrowClockwiseIcon />
          </ActionIcon>
        </Button>
      )}
    </section>
  )
}

export function SettingsIntegrations() {
  return (
    <div className='flex flex-col gap-6'>
      {examples.map((example, index) => (
        <div key={example.state} className={index ? 'border-t border-border pt-6' : undefined}>
          <GitHubConnection example={example} />
        </div>
      ))}
    </div>
  )
}
