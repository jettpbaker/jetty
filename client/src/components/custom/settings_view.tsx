import { storage } from '@/platform'
import {
  ChartBarIcon,
  IconContext,
  PaintBrushIcon,
  PlugsIcon,
  PuzzlePieceIcon,
} from '@phosphor-icons/react'
import { AppsIcon, ContainerIcon, RepoIcon } from '@primer/octicons-react'
import { useState, type ComponentType } from 'react'

import { PageSidebarTrigger } from './page_sidebar_trigger'
import { SettingsAppearance } from './settings_appearance'
import { SettingsIntegrations } from './settings_integrations'
import { SettingsLoadout } from './settings_loadout'
import { SettingsProjects } from './settings_projects'
import { SettingsProviders, loadProviderEnabled, type ProviderId } from './settings_providers'
import { SettingsUsage } from './settings_usage'

function Heading({
  id,
  label,
  icon: Icon,
  foreground = false,
}: {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  foreground?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2 ${foreground ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      <Icon aria-hidden='true' className='size-4' />
      <h2 id={id} className='text-sm font-medium'>
        {label}
      </h2>
    </div>
  )
}

const sectionClassName = 'flex flex-col gap-6'

export function SettingsView() {
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [enabled, setEnabled] = useState(loadProviderEnabled)
  return (
    <IconContext.Provider value={{ weight: 'bold' }}>
      <div className='flex h-full min-h-0 flex-col bg-background' aria-label='Settings'>
        <h1 className='sr-only'>Settings</h1>
        <PageSidebarTrigger standalone />
        <div className='scroll-fade-y scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          <div className='settings-content mx-auto flex w-full max-w-[708px] flex-col gap-8 px-6 py-6'>
            <section className={sectionClassName} aria-labelledby='settings-providers-heading'>
              <Heading id='settings-providers-heading' label='Providers' icon={PlugsIcon} />
              <SettingsProviders
                selected={provider}
                onSelect={setProvider}
                enabled={enabled}
                onEnabledChange={(id, value) => {
                  const next = { ...enabled, [id]: value }
                  setEnabled(next)
                  try {
                    storage.set('jetty.provider-enabled', JSON.stringify(next))
                  } catch {
                    /* Keep in-memory preferences. */
                  }
                }}
              />
            </section>

            <section className={sectionClassName} aria-labelledby='settings-loadout-heading'>
              <Heading id='settings-loadout-heading' label='Model loadout' icon={AppsIcon} />
              <SettingsLoadout
                vertical
                enabledProviders={enabled}
                onConnectProvider={(id) => {
                  setProvider(id)
                  document
                    .getElementById('settings-providers-heading')
                    ?.scrollIntoView({ block: 'start' })
                }}
              />
            </section>

            <section className={sectionClassName} aria-labelledby='settings-integrations-heading'>
              <Heading
                id='settings-integrations-heading'
                label='Integrations'
                icon={PuzzlePieceIcon}
              />
              <SettingsIntegrations />
            </section>

            <section className={sectionClassName} aria-labelledby='settings-projects-heading'>
              <Heading id='settings-projects-heading' label='Projects' icon={RepoIcon} />
              <SettingsProjects />
            </section>

            <section className={sectionClassName} aria-labelledby='settings-appearance-heading'>
              <Heading id='settings-appearance-heading' label='Appearance' icon={PaintBrushIcon} />
              <SettingsAppearance compact />
            </section>

            <section className={sectionClassName} aria-labelledby='settings-usage-heading'>
              <Heading id='settings-usage-heading' label='Usage' icon={ChartBarIcon} />
              <SettingsUsage
                onConnectCopilot={() => {
                  setProvider('copilot')
                  document.getElementById('provider-tab-copilot')?.focus()
                  document
                    .getElementById('settings-providers-heading')
                    ?.scrollIntoView({ block: 'start' })
                }}
              />
            </section>

            <section className={sectionClassName} aria-labelledby='settings-containers-heading'>
              <Heading id='settings-containers-heading' label='Containers' icon={ContainerIcon} />
              <p className='text-xs text-status-error'>WIP</p>
            </section>
          </div>
        </div>
      </div>
    </IconContext.Provider>
  )
}
