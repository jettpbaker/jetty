import {
  ChartBarIcon,
  IconContext,
  PaintBrushIcon,
  PlugsIcon,
  PuzzlePieceIcon,
} from '@phosphor-icons/react'
import { AppsIcon, ContainerIcon, RepoIcon } from '@primer/octicons-react'
import { useState, type ComponentType, type ReactNode } from 'react'

import { PageSidebarTrigger } from './page_sidebar_trigger'
import { SettingsAppearance } from './settings_appearance'
import { SettingsIntegrations } from './settings_integrations'
import { SettingsLoadout } from './settings_loadout'
import { SettingsProjects } from './settings_projects'
import {
  SettingsProviders,
  loadProviderEnabled,
  saveProviderEnabled,
  type ProviderId,
} from './settings_providers'
import { SettingsUsage } from './settings_usage'

function Section({
  id,
  label,
  icon: Icon,
  children,
}: {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className='flex scroll-mt-6 flex-col gap-6'
      aria-labelledby={`settings-${id}-heading`}
    >
      <div className='flex items-center gap-2 text-muted-foreground'>
        <Icon aria-hidden='true' className='size-4' />
        <h2 id={`settings-${id}-heading`} className='text-sm font-medium'>
          {label}
        </h2>
      </div>
      {children}
    </section>
  )
}

export function SettingsView() {
  const [provider, setProvider] = useState<ProviderId>('claude')
  const [enabled, setEnabled] = useState(loadProviderEnabled)
  function showProvider(id: ProviderId) {
    setProvider(id)
    document.getElementById('settings-providers-heading')?.scrollIntoView({ block: 'start' })
  }
  return (
    <IconContext.Provider value={{ weight: 'bold' }}>
      <div className='flex h-full min-h-0 flex-col bg-background' aria-label='Settings'>
        <h1 className='sr-only'>Settings</h1>
        <PageSidebarTrigger standalone />
        <div className='scroll-fade-y scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          <div className='settings-content mx-auto flex w-full max-w-[708px] flex-col gap-8 px-6 py-6'>
            <Section id='providers' label='Providers' icon={PlugsIcon}>
              <SettingsProviders
                selected={provider}
                onSelect={setProvider}
                enabled={enabled}
                onEnabledChange={(id, value) => {
                  const next = { ...enabled, [id]: value }
                  setEnabled(next)
                  saveProviderEnabled(next)
                }}
              />
            </Section>
            <Section id='loadout' label='Model loadout' icon={AppsIcon}>
              <SettingsLoadout enabledProviders={enabled} onConnectProvider={showProvider} />
            </Section>
            <Section id='integrations' label='Integrations' icon={PuzzlePieceIcon}>
              <SettingsIntegrations />
            </Section>
            <Section id='projects' label='Projects' icon={RepoIcon}>
              <SettingsProjects />
            </Section>
            <Section id='appearance' label='Appearance' icon={PaintBrushIcon}>
              <SettingsAppearance />
            </Section>
            <Section id='usage' label='Usage' icon={ChartBarIcon}>
              <SettingsUsage
                onConnectCopilot={() => {
                  document.getElementById('provider-tab-copilot')?.focus()
                  showProvider('copilot')
                }}
              />
            </Section>
            <Section id='containers' label='Containers' icon={ContainerIcon}>
              <p className='text-xs text-status-error'>WIP</p>
            </Section>
          </div>
        </div>
      </div>
    </IconContext.Provider>
  )
}
