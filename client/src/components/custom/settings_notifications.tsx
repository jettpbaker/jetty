import { Notification01Icon } from './huge_icons'
import {
  ComingSoon,
  DisabledSwitch,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './settings_layout'

// Coming soon as a whole, until Jetty sends browser notifications. The switches show the
// defaults they'll start with.
const events = [
  { title: 'A thread needs you', description: 'An approval or a question is waiting', on: true },
  {
    title: "A turn finishes while you're away",
    description: "Only when Jetty isn't the tab you're looking at",
    on: true,
  },
  {
    title: 'A bot messages you',
    description: "Check-ins stay quiet unless there's news",
    on: true,
  },
  {
    title: 'A guide is ready',
    description: 'For pull requests someone asked you to review',
    on: false,
  },
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
          icon={Notification01Icon}
          title='Browser notifications'
          description="Jetty can't send them yet. Everything below waits on this."
        >
          <ComingSoon />
        </SettingsRow>
      </SettingsCard>
      <SettingsSection title='Tell me when'>
        <SettingsCard>
          {events.map((event) => (
            <SettingsRow
              key={event.title}
              title={event.title}
              description={event.description}
              disabled
            >
              <DisabledSwitch checked={event.on} label={event.title} />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title='Sound'>
        <SettingsCard>
          <SettingsRow
            title='Play a sound'
            description='A soft chime with each notification'
            disabled
          >
            <DisabledSwitch checked={false} label='Play a sound' />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
