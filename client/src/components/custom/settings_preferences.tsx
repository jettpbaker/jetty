import type { ThreadMeta } from '@jetty/shared/wire'

import { Switch } from '@/components/ui/switch'
import { usePointerCursors } from '@/lib/pointer-cursors'
import { useAccessMode, useDefaultEnvironment } from '@/state'
import { useSetDefaultEnvironment } from '@/state/worktrees'
import { useState } from 'react'

import { accessModes } from './composer_access_mode'
import { environments } from './composer_environment'
import { KeybindChip, keybinds } from './keybinds'
import {
  Mono,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsSelect,
} from './settings_layout'

type Environment = ThreadMeta['environment']

const keycapClass = 'h-5 min-w-5 rounded-sm px-1 text-xs'

export function SettingsPreferences() {
  const { accessMode, setAccessMode } = useAccessMode()
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
            <SettingsSegmented
              label='Environment for new threads'
              value={environment}
              onChange={changeEnvironment}
              options={(['worktree', 'local'] as const).map((value) => {
                const { label, Icon } = environments[value]
                return { value, label, icon: <Icon /> }
              })}
            />
          </SettingsRow>
          <SettingsRow
            id='access'
            title='Access'
            description='Auto asks before anything risky. Full access never asks.'
          >
            <SettingsSelect
              label='Access for new threads'
              value={accessMode}
              onChange={setAccessMode}
              options={(['auto', 'full_access'] as const).map((value) => {
                const { label, Icon } = accessModes[value]
                return { value, label, icon: <Icon /> }
              })}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
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
