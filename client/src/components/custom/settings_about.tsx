import { homePath, useSettingsInfo } from '@/state/models'

import { CopyButton } from './copy_button'
import { copyFilePath } from './file_link'
import {
  Mono,
  PathText,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  UnavailableSettingsRow,
} from './settings_layout'

function megabytes(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.ceil(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`
}

export function SettingsAbout() {
  const info = useSettingsInfo()
  const version = import.meta.env.JETTY_VERSION
  return (
    <SettingsPage title='About' description='Where Jetty keeps your threads, bots and settings.'>
      <SettingsSection title='Jetty'>
        <SettingsCard>
          <SettingsRow id='version' title='Version' description='The build you’re running'>
            {version ? (
              <span className='flex items-center gap-2'>
                <code className='font-mono text-xs'>{version}</code>
                <CopyButton text={version} label='Copy version' />
              </span>
            ) : (
              <span className='text-13 text-muted-foreground'>Development</span>
            )}
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
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
          <UnavailableSettingsRow
            id='logs'
            title='Logs'
            description='What the server has been doing'
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
