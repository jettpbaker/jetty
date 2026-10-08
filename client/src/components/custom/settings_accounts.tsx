import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

import { GithubIcon } from './github_icon'
import { ArrowDown01Icon, ArrowUpRight01Icon, Copy01Icon, Refresh01Icon } from './huge_icons'
import { ProviderGlyph } from './provider_glyph'
import { ComingSoon, Mono, SettingsPage, SettingsSection, cardClass } from './settings_layout'

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
] as const

type Status = 'connected' | 'signed-out' | 'missing' | 'error' | 'checking' | 'off'

const statusLabels: Record<Status, string> = {
  connected: 'Connected',
  'signed-out': 'Signed out',
  missing: 'Not installed',
  error: 'Couldn’t check',
  checking: 'Checking…',
  off: 'Off',
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
    <div
      id={`settings-${id}`}
      className={cn(cardClass, 'flex min-h-16 items-center gap-3 px-4 py-3')}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md [&>.provider-icon]:size-4',
          disabled ? 'bg-foreground/3 text-disabled-foreground' : 'bg-foreground/6'
        )}
      >
        {icon}
      </span>
      <span className='flex min-w-0 grow basis-0 flex-col gap-0.5'>
        <span className='flex items-baseline gap-1.5 text-13'>
          <span className={disabled ? 'text-muted-foreground' : undefined}>{title}</span>
          {detail && <span className='text-muted-foreground'>{detail}</span>}
        </span>
        <span
          className={cn(
            'truncate text-xs',
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
function AccountMenu({
  name,
  status,
  login,
  install,
  onCheck,
  enabled,
  onEnabledChange,
}: {
  name: string
  status: Status
  login: string
  install: string
  onCheck: () => void
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`${name}: ${statusLabels[status]}`}
        render={
          <Button
            variant='ghost'
            className='h-7 shrink-0 gap-1.5 rounded-sm pr-1.5 pl-2.5 text-13 font-normal [&_svg]:text-muted-foreground'
          />
        }
      >
        {status !== 'checking' && status !== 'off' && (
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
        <span className={status === 'checking' || status === 'off' ? 'text-muted-foreground' : ''}>
          {statusLabels[status]}
        </span>
        <ArrowDown01Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        className='w-60 rounded-md [&_[data-slot=dropdown-menu-item]]:h-7 [&_[data-slot=dropdown-menu-item]]:text-13 [&_[data-slot=dropdown-menu-item]_svg]:size-4'
      >
        <DropdownMenuItem onClick={onCheck}>
          <Refresh01Icon />
          Check connection
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copyCommand(login)}>
          <Copy01Icon />
          Copy
          <code className='font-mono text-xs text-muted-foreground'>{login}</code>
        </DropdownMenuItem>
        {status !== 'connected' && (
          <DropdownMenuItem onClick={() => window.open(install, '_blank', 'noreferrer')}>
            <ArrowUpRight01Icon />
            Install
          </DropdownMenuItem>
        )}
        {onEnabledChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={enabled}
              closeOnClick={false}
              onCheckedChange={onEnabledChange}
              className='h-auto min-h-11 gap-2 py-1 pr-2 pl-8 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden'
            >
              <span className='flex grow flex-col whitespace-normal'>
                <span className='text-13'>Use in Jetty</span>
                <span className='text-xs text-muted-foreground'>Off hides its models</span>
              </span>
              <Switch
                render={<span />}
                size='sm'
                checked={enabled}
                tabIndex={-1}
                aria-hidden='true'
                className='pointer-events-none'
              />
            </DropdownMenuCheckboxItem>
          </>
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
  const status: Status = !on
    ? 'off'
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
      <AccountMenu
        name={provider.name}
        status={status}
        login={provider.login}
        install={provider.install}
        onCheck={() => refresh([provider.id])}
        enabled={on}
        onEnabledChange={(value) => setEnabled({ ...enabled, [provider.id]: value })}
      />
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
        description='Each one brings its own models. Turn one off to hide it everywhere.'
      >
        <div className='flex flex-col gap-2'>
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
          <AccountCard
            id='copilot'
            icon={<ProviderGlyph provider='copilot' />}
            title='GitHub Copilot'
            description='Claude, GPT and Gemini models through your Copilot plan'
            disabled
          >
            <ComingSoon />
          </AccountCard>
        </div>
      </SettingsSection>
      <SettingsSection title='Code' description='Pull requests, reviews and checks.'>
        <GitHubCard />
      </SettingsSection>
    </SettingsPage>
  )
}
