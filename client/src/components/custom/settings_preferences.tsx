import type { ThreadMeta } from '@jetty/shared/wire'

import { Switch } from '@/components/ui/switch'
import { usePointerCursors } from '@/lib/pointer-cursors'
import { useAccessMode, useDefaultEnvironment } from '@/state'
import { useSetDefaultEnvironment } from '@/state/worktrees'
import { useState } from 'react'

import { accessModes } from './composer_access_mode'
import { environments } from './composer_environment'
import {
  Mono,
  PlannedSettingsRow,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from './settings_layout'

type Environment = ThreadMeta['environment']

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
      <SettingsSection title='New threads'>
        <SettingsCard>
          <SettingsRow
            id='environment'
            title='Environment'
            description={
              <>
                Projects can override this in <Mono>.jetty/worktree.json</Mono>
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
          <SettingsRow
            id='access'
            title='Access'
            description='Allow routine work automatically, or use full access to run without approvals.'
          >
            <SettingsSelect
              label='Access for new threads'
              value={accessMode}
              onChange={setAccessMode}
              options={(['auto', 'full_access'] as const).map((value) => {
                const { menuLabel: label, Icon } = accessModes[value]
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
      <SettingsSection title='Coming soon' description='Startup and sending preferences'>
        <SettingsCard>
          <PlannedSettingsRow
            id='open-on-launch'
            title='Open on launch'
            description='Choose what Jetty shows when you open it'
          />
          <PlannedSettingsRow
            id='send-key'
            title='Send messages with'
            description='Choose the send key. Shift-Enter always adds a new line.'
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
