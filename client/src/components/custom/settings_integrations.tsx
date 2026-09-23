import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { run, useAction } from '@/state/connection'
import { ArrowClockwiseIcon, ArrowUpRightIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { MarkGithubIcon } from '@primer/octicons-react'
import { Effect } from 'effect'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

type ConnectionState = 'connected' | 'signed-out' | 'missing' | 'error' | 'checking'
const details: Record<ConnectionState, string> = {
  connected: 'Connected through GitHub CLI',
  'signed-out': 'Sign in with GitHub CLI',
  missing: 'GitHub CLI isn’t installed',
  error: 'Couldn’t check connection',
  checking: 'Checking connection…',
}

const actionClass =
  '-mr-2 inline-flex h-7 items-center justify-end gap-1.5 rounded-sm border border-transparent px-2 text-xs'
function requestConnection(
  registry: Parameters<typeof run>[0],
  onState: (state: ConnectionState) => void
) {
  return run(
    registry,
    (connection) =>
      connection
        .request('github.connection', {})
        .pipe(Effect.tap(({ state }) => Effect.sync(() => onState(state)))),
    () => onState('error')
  )
}

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

function GitHubConnection() {
  const request = useAction(requestConnection)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')
  const [state, setState] = useState<ConnectionState>('checking')
  const checkConnection = useCallback(() => {
    setState('checking')
    setMessage('')
    request(setState)
  }, [request])
  useEffect(() => {
    checkConnection()
  }, [checkConnection])
  const connected = state === 'connected'
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
      aria-label={`GitHub — ${details[state]}`}
      className='flex flex-wrap items-center justify-between gap-x-4 gap-y-3'
    >
      <div className='flex items-center gap-3'>
        <MarkGithubIcon size={20} className='shrink-0 text-muted-foreground' />
        <div className='flex flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <h3 className='text-13'>GitHub</h3>
          </div>
          <p role='status' className='text-xs text-muted-foreground'>
            {message || details[state]}
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
                onClick={() => void checkConnection()}
              />
            }
          >
            <ActionIcon>
              <ArrowClockwiseIcon />
            </ActionIcon>
          </TooltipTrigger>
          <TooltipContent>Check connection</TooltipContent>
        </Tooltip>
      ) : state === 'signed-out' ? (
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
      ) : state === 'missing' ? (
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
      ) : state === 'error' ? (
        <Button
          variant='ghost-text'
          size='sm'
          className={actionClass}
          onClick={() => void checkConnection()}
        >
          Retry
          <ActionIcon>
            <ArrowClockwiseIcon />
          </ActionIcon>
        </Button>
      ) : null}
    </section>
  )
}

export function SettingsIntegrations() {
  return (
    <div className='flex flex-col gap-6'>
      <GitHubConnection />
    </div>
  )
}
