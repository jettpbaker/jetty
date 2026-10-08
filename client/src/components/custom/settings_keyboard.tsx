import { KeybindChip, keybinds, type Keybind } from './keybinds'
import {
  SettingsButton,
  SettingsCard,
  SettingsPage,
  SettingsSection,
  comingSoon,
} from './settings_layout'

// ⌥1–9 is nine bindings, listed as one.
const sidebarRows: Keybind = {
  ...keybinds.sidebarRows[0]!,
  label: `⌥1–${keybinds.sidebarRows.length}`,
  name: 'Open a sidebar row',
}

const groups: { title: string; bindings: Keybind[] }[] = [
  {
    title: 'General',
    bindings: [
      keybinds.newThread,
      keybinds.settings,
      keybinds.sidebar,
      keybinds.details,
      keybinds.pin,
      sidebarRows,
    ],
  },
  {
    title: 'Composer',
    bindings: [
      keybinds.send,
      keybinds.steer,
      keybinds.newLine,
      keybinds.model,
      keybinds.effort,
      keybinds.access,
      keybinds.addToPrompt,
    ],
  },
  { title: 'Files', bindings: [keybinds.findFile, keybinds.save] },
]

export function SettingsKeyboard() {
  return (
    <SettingsPage
      title='Keyboard'
      description='Every shortcut in Jetty.'
      className='gap-7 [&>header]:pb-1'
      action={
        <>
          <span className='text-xs text-muted-foreground'>{comingSoon}</span>
          <SettingsButton disabled>Customize</SettingsButton>
        </>
      }
    >
      {groups.map((group, index) => (
        <SettingsSection
          key={group.title}
          id={index ? undefined : 'shortcuts'}
          title={group.title}
          className='gap-2.5'
        >
          <SettingsCard>
            {group.bindings.map((binding) => (
              <div key={binding.name} className='flex h-9 items-center gap-4'>
                <span className='grow text-13'>{binding.name}</span>
                <KeybindChip binding={binding} className='h-5 min-w-5 rounded-sm px-1 text-xs' />
              </div>
            ))}
          </SettingsCard>
        </SettingsSection>
      ))}
    </SettingsPage>
  )
}
