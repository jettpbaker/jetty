import {
  PlannedSettingsRow,
  SettingsCard,
  SettingsPage,
  PlannedSettingsSection,
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
      description='Browser notifications are not available yet. These are the events Jetty will support.'
    >
      <PlannedSettingsSection id='browser-notifications' title='Planned notifications'>
        <SettingsCard>
          {events.map((event) => (
            <PlannedSettingsRow
              key={event.title}
              title={event.title}
              description={event.description}
            />
          ))}
        </SettingsCard>
      </PlannedSettingsSection>
    </SettingsPage>
  )
}
