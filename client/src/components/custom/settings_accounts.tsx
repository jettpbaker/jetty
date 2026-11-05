import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { run, useAction } from '@/state/connection'
import { useModelAvailability, useProviderEnabled } from '@/state/loadouts'
import { useModelRefresh } from '@/state/models'
import { useProviderUsage } from '@/state/provider-usage'
import { modelLabelText } from '@jetty/shared/model-name'
import { Effect } from 'effect'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  DotGrid1x3VerticalTightIcon,
  ArrowUpRightIcon,
  SquareBehindSquare1Icon,
  ArrowRotateClockwiseIcon,
} from './central_icons'
import { GithubIcon } from './github_icon'
import { ProviderGlyph } from './provider_glyph'
import { Mono, SettingsPage, SettingsSection, SettingsCard } from './settings_layout'

const providers = [
  {
    id: 'claude',
    name: 'Claude Code',
    cli: 'claude',
    login: 'claude auth login',
    install: 'https://code.claude.com/docs/en/overview',
  },
  {
    id: 'codex',
    name: 'Codex',
    cli: 'codex',
    login: 'codex login',
    install: 'https://developers.openai.com/codex/cli',
  },
  {
    id: 'grok',
    name: 'Grok Build',
    cli: 'grok',
    login: 'grok login',
    install: 'https://docs.x.ai/build/overview',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    cli: 'copilot',
    login: 'copilot login',
    install: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    cli: 'opencode',
    login: 'opencode auth login',
    install: 'https://opencode.ai/docs/',
  },
] as const

type Status = 'connected' | 'signed-out' | 'missing' | 'error' | 'checking'

const statusLabels: Record<Status, string> = {
  connected: 'Connected',
  'signed-out': 'Signed out',
  missing: 'Not installed',
  error: 'Couldn’t check',
  checking: 'Checking…',
}

function AccountCard({
  id,
  icon,
  title,
  detail,
  description,
  disabled,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  detail?: string
  description: ReactNode
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div id={`settings-${id}`} className='flex min-h-16 flex-wrap items-center gap-3 py-3'>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md [&>.provider-icon]:size-4',
          disabled ? 'bg-foreground/3 text-disabled-foreground' : 'bg-foreground/6'
        )}
      >
        {icon}
      </span>
      <span className='flex min-w-0 grow basis-64 flex-col gap-0.5'>
        <span className='flex items-baseline gap-1.5 text-13'>
          <span className={disabled ? 'text-muted-foreground' : undefined}>{title}</span>
          {detail && <span className='text-muted-foreground'>{detail}</span>}
        </span>
        <span
          className={cn(
            'text-xs whitespace-normal',
            disabled ? 'text-disabled-foreground' : 'text-muted-foreground'
          )}
        >
          {description}
        </span>
      </span>
      {children}
    </div>
  )
}

async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command)
    toast('Copied — run it in your terminal', { description: command })
  } catch {
    toast.error(`Couldn’t copy — run ${command}`)
  }
}

// The account's state, and a menu of what can be done with it.
function AccountStatus({ status }: { status: Status }) {
  return (
    <span role='status' className='flex w-27 shrink-0 items-center gap-2 text-13'>
      {status !== 'checking' && (
        <span
          aria-hidden='true'
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            status === 'connected'
              ? 'bg-status-success'
              : status === 'error'
                ? 'bg-destructive'
                : 'bg-muted-foreground'
          )}
        />
      )}
      {statusLabels[status]}
    </span>
  )
}

function AccountMenu({
  name,
  status,
  login,
  install,
  onCheck,
}: {
  name: string
  status: Status
  login: string
  install: string
  onCheck: () => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`${name} account actions`}
        render={<Button variant='ghost' size='icon-sm' />}
      >
        <DotGrid1x3VerticalTightIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='w-60 rounded-md [&_[data-slot=dropdown-menu-item]]:h-7 [&_[data-slot=dropdown-menu-item]]:text-13 [&_[data-slot=dropdown-menu-item]_svg]:size-4'
      >
        <DropdownMenuItem onClick={onCheck}>
          <ArrowRotateClockwiseIcon />
          Check connection
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copyCommand(login)}>
          <SquareBehindSquare1Icon />
          Copy
          <code className='font-mono text-xs text-muted-foreground'>{login}</code>
        </DropdownMenuItem>
        {status !== 'connected' && (
          <DropdownMenuItem onClick={() => window.open(install, '_blank', 'noreferrer')}>
            <ArrowUpRightIcon />
            Install
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProviderCard({ provider }: { provider: (typeof providers)[number] }) {
  const { reads, failed, refresh } = useProviderUsage()
  const [enabled, setEnabled] = useProviderEnabled()
  const { catalog } = useModelAvailability()
  const account = reads[provider.id]?.usage
  const on = enabled[provider.id]
  const status: Status =
    account?.installed === false
      ? 'missing'
      : account?.connected
        ? 'connected'
        : failed.has(provider.id) || account?.failed
          ? 'error'
          : account
            ? 'signed-out'
            : 'checking'
  const models = catalog
    .filter((model) => model.provider === provider.id)
    .map((model) => modelLabelText(model))
  return (
    <AccountCard
      id={provider.id}
      icon={<ProviderGlyph provider={provider.id} />}
      title={provider.name}
      detail={account?.connected ? account.plan : undefined}
      description={
        <>
          {account?.connected ? 'Signed in through' : 'Signs in through'}{' '}
          <Mono>{provider.cli}</Mono>
          {models.length > 0 && ` · ${models.join(', ')}`}
        </>
      }
    >
      {status === 'signed-out' && (
        <Button variant='outline' size='sm' onClick={() => void copyCommand(provider.login)}>
          Copy sign-in command
        </Button>
      )}
      <div className='ml-auto flex shrink-0 items-center gap-4'>
        <label
          htmlFor={`provider-enabled-${provider.id}`}
          className='flex items-center gap-2 text-xs text-muted-foreground'
        >
          Enabled
          <Switch
            id={`provider-enabled-${provider.id}`}
            aria-label={`Use ${provider.name} in Jetty`}
            checked={on}
            onCheckedChange={(value) => setEnabled({ ...enabled, [provider.id]: value })}
          />
        </label>
        <AccountStatus status={status} />
        <AccountMenu
          name={provider.name}
          status={status}
          login={provider.login}
          install={provider.install}
          onCheck={() => refresh([provider.id])}
        />
      </div>
    </AccountCard>
  )
}

type GitHubState = 'connected' | 'signed-out' | 'missing' | 'error' | 'checking'

function requestConnection(
  registry: Parameters<typeof run>[0],
  onState: (state: GitHubState) => void
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

function GitHubCard() {
  const request = useAction(requestConnection)
  const [state, setState] = useState<GitHubState>('checking')
  const check = useCallback(() => {
    setState('checking')
    request(setState)
  }, [request])
  useEffect(() => {
    check()
  }, [check])
  return (
    <AccountCard
      id='github'
      icon={<GithubIcon className='size-4' />}
      title='GitHub'
      description={
        <>
          {state === 'connected' ? 'Signed in through' : 'Signs in through'} <Mono>gh</Mono> ·
          agents push, open PRs and read checks as you
        </>
      }
    >
      {state === 'signed-out' && (
        <Button variant='outline' size='sm' onClick={() => void copyCommand('gh auth login')}>
          Copy sign-in command
        </Button>
      )}
      <AccountStatus status={state} />
      <AccountMenu
        name='GitHub'
        status={state}
        login='gh auth login'
        install='https://cli.github.com/'
        onCheck={check}
      />
    </AccountCard>
  )
}

export function SettingsAccounts() {
  const { refresh: refreshModels } = useModelRefresh()
  const { refresh } = useProviderUsage()
  useEffect(() => {
    refreshModels()
    refresh(
      providers.map((provider) => provider.id),
      30_000
    )
  }, [refreshModels, refresh])
  return (
    <SettingsPage
      title='Connected accounts'
      description="Jetty works through the CLIs you're already signed in to. Your keys never leave them."
    >
      <SettingsSection
        title='Coding agents'
        description='Enable an agent to show its models in Jetty. Turning it off keeps the account signed in.'
      >
        <SettingsCard>
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title='Code' description='Pull requests, reviews and checks.'>
        <SettingsCard>
          <GitHubCard />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
