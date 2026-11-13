import type { ProviderId, ThreadMeta } from '@jetty/shared/wire'

import { Switch } from '@/components/ui/switch'
import { usePointerCursors } from '@/lib/pointer-cursors'
import { useAccessDefault, useDefaultEnvironment, useModels } from '@/state'
import { useSetDefaultEnvironment } from '@/state/worktrees'
import { useState } from 'react'

import { accessModes, fullAccessDisabled } from './composer_access_mode'
import { environments } from './composer_environment'
import { KeybindChip, keybinds } from './keybinds'
import {
  Mono,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from './settings_layout'
import { providerNames } from './usage_limits'

type Environment = ThreadMeta['environment']

const keycapClass = 'h-5 min-w-5 rounded-sm px-1 text-xs'

export function SettingsPreferences() {
  const models = useModels()
  const providers = [...new Set(models.map((model) => model.provider))]
  const saveEnvironment = useSetDefaultEnvironment()
  const defaultEnvironment = useDefaultEnvironment()
  const [pendingEnvironment, setPendingEnvironment] = useState<Environment>()
  const environment = pendingEnvironment ?? defaultEnvironment
  const [pointerCursors, setPointerCursors] = usePointerCursors()
  function changeEnvironment(next: Environment) {
    setPendingEnvironment(next)
    saveEnvironment(next, () =>
      setPendingEnvironment((current) => (current === next ? undefined : current))
    )
  }
  return (
    <SettingsPage
      title='Preferences'
      description='How Jetty behaves. Changes save as you make them.'
    >
      <SettingsSection title='General'>
        <SettingsCard>
          <SettingsRow
            id='open-on-launch'
            title='Open on launch'
            description='What Jetty shows when you open it'
            disabled
          >
            <SettingsSelect
              label='Open on launch'
              value='last-thread'
              options={[
                { value: 'last-thread', label: 'Last thread' },
                { value: 'new-thread', label: 'New thread' },
                { value: 'pull-requests', label: 'Pull requests' },
              ]}
              disabled
            />
          </SettingsRow>
          <SettingsRow
            id='send-key'
            title='Send messages with'
            description='Shift-Enter always adds a new line'
            disabled
          >
            <SettingsSelect
              label='Send messages with'
              value='enter'
              options={[
                {
                  value: 'enter',
                  label: <KeybindChip binding={keybinds.send} className={keycapClass} />,
                },
                {
                  value: 'mod-enter',
                  label: <KeybindChip binding={keybinds.steer} className={keycapClass} />,
                },
              ]}
              disabled
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title='New threads'>
        <SettingsCard>
          <SettingsRow
            id='environment'
            title='Environment'
            description={
              <>
                A project&apos;s own <Mono>.jetty/worktree.json</Mono> wins
              </>
            }
          >
            <SettingsSelect
              label='Environment for new threads'
              value={environment}
              onChange={changeEnvironment}
              options={(['worktree', 'local'] as const).map((value) => {
                const { label, Icon } = environments[value]
                return { value, label, icon: <Icon /> }
              })}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      {providers.length > 0 && (
        <SettingsSection
          id='access'
          title='Access'
          description='How new threads start. Auto asks before anything risky. Full access never asks.'
        >
          <SettingsCard>
            {providers.map((provider) => (
              <AccessDefault
                key={provider}
                provider={provider}
                blocked={
                  models.every((model) => model.provider !== provider || fullAccessDisabled(model))
                    ? fullAccessDisabled(models.find((model) => model.provider === provider))
                    : undefined
                }
              />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
      <SettingsSection title='Interface'>
        <SettingsCard>
          <SettingsRow
            id='pointer-cursors'
            title='Use pointer cursors'
            description='Show a hand over buttons and other controls, like a web page'
          >
            <Switch
              checked={pointerCursors}
              onCheckedChange={setPointerCursors}
              aria-label='Use pointer cursors'
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

function AccessDefault({ provider, blocked }: { provider: ProviderId; blocked?: string }) {
  const { accessMode, setAccessMode } = useAccessDefault(provider)
  return (
    <SettingsRow title={providerNames[provider]} description={blocked}>
      <SettingsSelect
        label={`Access for new ${providerNames[provider]} threads`}
        value={blocked ? 'auto' : accessMode}
        onChange={setAccessMode}
        disabled={blocked !== undefined}
        options={(['auto', 'full_access'] as const).map((value) => {
          const { label, Icon } = accessModes[value]
          return { value, label, icon: <Icon /> }
        })}
      />
    </SettingsRow>
  )
}
