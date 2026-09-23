import type { ProviderModel } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { copilotModels } from '@/lib/loadout'
import { storage } from '@/platform'
import { useChrome } from '@/state/chrome'
import { useModelAvailability } from '@/state/loadouts'
import { useProviderUsage } from '@/state/provider-usage'
import { CheckIcon, CopyIcon, ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useState } from 'react'

import { ModelLabel } from './model_label'
import { ProviderGlyph } from './provider_glyph'
import './settings_sections.css'

export const providerOptions = [
  {
    id: 'claude',
    name: 'Claude',
    product: 'Claude Code',
    login: 'claude auth login',
    ready: true,
  },
  { id: 'codex', name: 'Codex', product: 'OpenAI Codex', login: 'codex login', ready: true },
  { id: 'grok', name: 'Grok', product: 'Grok', login: 'grok login', ready: true },
  {
    id: 'copilot',
    name: 'Copilot',
    product: 'GitHub Copilot',
    login: 'copilot login',
    ready: false,
  },
] as const
export type ProviderId = (typeof providerOptions)[number]['id']
export type ProviderEnabled = Record<ProviderId, boolean>

const enabledKey = 'jetty.provider-enabled'

export function loadProviderEnabled(): ProviderEnabled {
  const enabled = { claude: true, codex: true, grok: true, copilot: true }
  try {
    const saved = JSON.parse(storage.get(enabledKey) ?? '{}')
    for (const item of providerOptions)
      if (typeof saved?.[item.id] === 'boolean') enabled[item.id] = saved[item.id]
  } catch {
    return enabled
  }
  return enabled
}

export function saveProviderEnabled(enabled: ProviderEnabled) {
  storage.set(enabledKey, JSON.stringify(enabled))
}

function providerModels(id: ProviderId, catalog: readonly ProviderModel[]) {
  if (id === 'copilot') return copilotModels.map((name) => ({ id: name, name, provider: id }))
  return catalog.filter((model) => model.provider === id)
}

const cliSetup: Record<ProviderId, { name: string; url: string }> = {
  claude: { name: 'Claude Code CLI', url: 'https://code.claude.com/docs/en/overview' },
  codex: { name: 'Codex CLI', url: 'https://developers.openai.com/codex/cli' },
  grok: { name: 'Grok Build CLI', url: 'https://docs.x.ai/build/overview' },
  copilot: {
    name: 'GitHub Copilot CLI',
    url: 'https://docs.github.com/en/copilot/get-started/cli-quickstart',
  },
}

export function SettingsProviders({
  selected,
  onSelect,
  enabled,
  onEnabledChange,
}: {
  selected: ProviderId
  onSelect: (id: ProviderId) => void
  enabled: ProviderEnabled
  onEnabledChange: (id: ProviderId, value: boolean) => void
}) {
  const provider = providerOptions.find((item) => item.id === selected)!
  const { catalog, enabled: modelEnabled, setEnabled: setModelEnabled } = useModelAvailability()
  const discovery = useChrome()?.modelDiscovery
  const { usage } = useProviderUsage()
  const plan = usage.find((item) => item.provider === selected)?.plan
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')
  const usable = enabled[selected] && provider.ready
  function select(id: ProviderId) {
    onSelect(id)
    setCopied(false)
    setMessage('')
  }
  return (
    <div className='provider-panel overflow-hidden rounded-menu-item border border-border'>
      <div className='provider-list p-1' aria-label='Providers'>
        {providerOptions.map((item) => (
          <div
            key={item.id}
            className={`flex items-center rounded-menu-item pr-3 ${selected === item.id ? 'bg-accent' : 'hover:bg-muted/50'}`}
          >
            <button
              id={`provider-tab-${item.id}`}
              type='button'
              aria-pressed={selected === item.id}
              aria-controls='provider-detail'
              className='flex min-w-0 flex-1 items-center gap-3 rounded-menu-item px-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring'
              onClick={() => select(item.id)}
            >
              <ProviderGlyph
                provider={item.id}
                className={`size-6 ${enabled[item.id] ? 'text-muted-foreground' : 'text-disabled-foreground'}`}
              />
              <span className='flex min-w-0 flex-col gap-1'>
                <span
                  className={`text-13 font-medium ${enabled[item.id] ? '' : 'text-muted-foreground'}`}
                >
                  {item.name}
                </span>
                <span
                  className={`text-xs ${!enabled[item.id] ? 'text-disabled-foreground' : item.ready && discovery?.[item.id] === 'ready' && providerModels(item.id, catalog).length > 0 ? 'text-status-success' : 'text-muted-foreground'}`}
                >
                  {!enabled[item.id]
                    ? 'Disabled'
                    : !item.ready
                      ? 'Not connected'
                      : discovery?.[item.id] === 'error'
                        ? 'Discovery failed'
                        : discovery?.[item.id] === 'ready'
                          ? providerModels(item.id, catalog).length > 0
                            ? 'Connected'
                            : 'No models found'
                          : 'Checking models'}
                </span>
              </span>
            </button>
            <Switch
              checked={enabled[item.id]}
              onCheckedChange={(value) => {
                onEnabledChange(item.id, value)
                select(item.id)
              }}
              aria-label={`Enable ${item.name}`}
            />
          </div>
        ))}
      </div>
      <div
        id='provider-detail'
        role='region'
        aria-labelledby={`provider-tab-${selected}`}
        className='scrollbar-subtle flex min-h-0 min-w-0 flex-col gap-6 overflow-y-auto p-5 [&>div:not(:last-child)]:shrink-0 [&>p]:shrink-0'
      >
        <div className='flex items-center gap-3'>
          <ProviderGlyph provider={selected} className='size-7 text-muted-foreground' />
          <div className='flex flex-col gap-1'>
            <h3 className='text-13 font-medium'>{provider.product}</h3>
            <p className='text-xs text-muted-foreground'>
              {provider.ready ? `Authenticated${plan ? ` · ${plan}` : ''}` : 'Not authenticated'}
            </p>
          </div>
        </div>
        {!usable && (
          <p className='text-xs leading-relaxed text-muted-foreground'>
            Install and sign in to the{' '}
            <a
              href={cliSetup[selected].url}
              target='_blank'
              rel='noreferrer'
              className='underline underline-offset-2 hover:text-foreground'
            >
              {cliSetup[selected].name}
            </a>{' '}
            to use {provider.name} models.
          </p>
        )}
        {enabled[selected] && !provider.ready && (
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between gap-2 rounded-menu-item border border-border px-3 py-1.5'>
              <code className='text-xs'>{provider.login}</code>
              <Button
                variant='ghost-text'
                size='icon'
                aria-label='Copy sign-in command'
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(provider.login)
                    setCopied(true)
                  } catch {
                    setMessage('Could not copy the command.')
                  }
                }}
              >
                {copied ? <CheckIcon className='size-3.5' /> : <CopyIcon className='size-3.5' />}
              </Button>
            </div>
            <Button
              variant='ghost-text'
              size='sm'
              className='-ml-2 h-7 w-fit rounded-sm'
              onClick={() => setMessage('No CLI connection in this design preview.')}
            >
              <ArrowClockwiseIcon className='size-3' />
              Check connection
            </Button>
            {message && (
              <p role='status' className='text-xs text-muted-foreground'>
                {message}
              </p>
            )}
          </div>
        )}
        <div className='flex min-h-24 flex-1 flex-col gap-2'>
          <div className='flex flex-col gap-1'>
            <h4 className='text-xs font-medium text-muted-foreground'>Models</h4>
            <p className='text-xs text-muted-foreground'>Choose which models appear in pickers.</p>
          </div>
          <div
            className='scrollbar-subtle min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-2'
            role='region'
            aria-label={`${provider.name} model availability`}
            tabIndex={0}
          >
            {providerModels(selected, catalog).map((model) => (
              <label
                key={model.id}
                className={`flex min-h-8 items-center justify-between gap-3 text-13 ${usable ? '' : 'text-disabled-foreground'}`}
              >
                <span>
                  {model.provider === 'copilot' ? model.name : <ModelLabel model={model} />}
                </span>
                <Switch
                  size='sm'
                  aria-label={`Enable ${model.name}`}
                  disabled={!usable}
                  checked={modelEnabled[`${selected}:${model.id}`] ?? true}
                  onCheckedChange={(checked) => setModelEnabled(model, checked)}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
