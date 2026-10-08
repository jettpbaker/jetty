import { homePath, useSettingsInfo } from '@/state/models'

import { DisabledTooltip } from './disabled_tooltip'
import { copyFilePath } from './file_link'
import {
  Mono,
  PathText,
  SettingsButton,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  comingSoon,
} from './settings_layout'

function megabytes(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.ceil(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`
}

export function SettingsAbout() {
  const info = useSettingsInfo()
  return (
    <SettingsPage title='About' description='Where Jetty keeps your threads, bots and settings.'>
      <SettingsSection title='Data'>
        <SettingsCard>
          <SettingsRow
            id='home'
            title='Jetty home'
            description={
              <>
                Set <Mono>JETTY_HOME</Mono> to keep it somewhere else
              </>
            }
          >
            {info && (
              <button
                type='button'
                aria-label='Copy path'
                onClick={() => copyFilePath(info.home)}
                className='flex max-w-1/2 min-w-0 rounded-sm outline-none hover:[&>*]:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
              >
                <PathText path={homePath(info.home, info)} />
              </button>
            )}
          </SettingsRow>
          <SettingsRow
            id='database'
            title='Database'
            description="Every thread's history, in one SQLite file"
          >
            {info && (
              <span className='shrink-0 font-mono text-xs text-muted-foreground'>
                {megabytes(info.databaseBytes)}
              </span>
            )}
          </SettingsRow>
          <SettingsRow id='logs' title='Logs' description='What the server has been doing' disabled>
            <DisabledTooltip reason={comingSoon} wrap='flex'>
              <SettingsButton disabled className='pointer-events-none'>
                Open logs
              </SettingsButton>
            </DisabledTooltip>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
