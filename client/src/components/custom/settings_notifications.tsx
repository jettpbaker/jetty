import { Bell2Icon } from './central_icons'
import {
  ComingSoon,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './settings_layout'

const events = [
  { title: 'A thread needs you', description: 'An approval or a question is waiting' },
  {
    title: "A turn finishes while you're away",
    description: "Only when Jetty isn't the tab you're looking at",
  },
  {
    title: 'A bot messages you',
    description: "Check-ins stay quiet unless there's news",
  },
  {
    title: 'A guide is ready',
    description: 'For pull requests someone asked you to review',
  },
  { title: 'Play a sound', description: 'A soft chime with each notification' },
]

export function SettingsNotifications() {
  return (
    <SettingsPage
      title='Notifications'
      description='Hear about threads that need you while Jetty is in another tab.'
    >
      <SettingsCard>
        <SettingsRow
          id='browser-notifications'
          icon={Bell2Icon}
          title='Browser notifications'
          description='Notifications are not available yet. These are the events Jetty will support.'
        >
          <ComingSoon />
        </SettingsRow>
      </SettingsCard>
      <SettingsSection title='Planned notifications'>
        <SettingsCard>
          {events.map((event) => (
            <SettingsRow
              key={event.title}
              title={event.title}
              description={event.description}
              disabled
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
