import type { Bot } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { effortLabels, findModel } from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useBots, useChrome } from '@/state'
import { homePath, useSettingsInfo } from '@/state/models'
import { modelLabelText } from '@jetty/shared/model-name'
import { useState } from 'react'

import { BotAvatar } from './bot_avatar'
import { BotSettingsSheet } from './bot_settings_sheet'
import { accessModes } from './composer_access_mode'
import { copyFilePath } from './file_link'
import { ArrowRight01Icon, Folder01Icon, PlusSignIcon } from './huge_icons'
import { NewBotDialog } from './new_bot_dialog'
import {
  PathText,
  SettingsButton,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  cardClass,
} from './settings_layout'

function BotRow({ bot }: { bot: Bot }) {
  const chrome = useChrome()
  const model = findModel(chrome?.models ?? [], { provider: bot.provider, model: bot.model })
  const project = bot.projectId
    ? chrome?.projects.find((entry) => entry.id === bot.projectId)?.title
    : 'All projects'
  return (
    <BotSettingsSheet bot={bot}>
      <button
        type='button'
        aria-label={`${bot.name} settings`}
        className='group/bot flex min-h-15 w-full items-center gap-3 py-3 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
      >
        {/* The face draws inside its box's margin; this size fills the 28px slot. */}
        <span className='flex size-7 shrink-0 items-center justify-center'>
          <BotAvatar bot={bot} size={34} unread={false} />
        </span>
        <span className='flex min-w-0 grow basis-0 flex-col gap-0.5'>
          <span className='text-13'>{bot.name}</span>
          <span className='flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
            <span className='truncate'>
              {[model ? modelLabelText(model) : bot.model, bot.effort && effortLabels[bot.effort]]
                .filter(Boolean)
                .join(' ')}
            </span>
            {bot.permissionMode === 'full_access' && (
              <span className='flex shrink-0 items-center gap-1 [&_svg]:size-3'>
                <accessModes.full_access.Icon />
                {accessModes.full_access.label}
              </span>
            )}
          </span>
        </span>
        <span className='flex w-30 shrink-0 items-center gap-1.5 text-13 text-muted-foreground [&_svg]:size-3.5'>
          <Folder01Icon />
          <span className='truncate'>{project}</span>
        </span>
        <ArrowRight01Icon className='text-muted-foreground group-hover/bot:text-foreground' />
      </button>
    </BotSettingsSheet>
  )
}

export function SettingsBots() {
  const bots = useBots()
  const info = useSettingsInfo()
  const [creating, setCreating] = useState(false)
  const preferences = info && `${info.home}/bots/shared/preferences.md`
  return (
    <SettingsPage
      title='Bots'
      description='Long-running agents with a chat of their own. They hand the work to worker threads.'
    >
      <SettingsSection
        id='your-bots'
        title='Your bots'
        action={
          <SettingsButton onClick={() => setCreating(true)}>
            <PlusSignIcon />
            New bot
          </SettingsButton>
        }
      >
        <SettingsCard>
          {bots.map((bot) => (
            <BotRow key={bot.id} bot={bot} />
          ))}
          {!bots.length && (
            <p className='flex min-h-15 items-center text-13 text-muted-foreground'>No bots yet.</p>
          )}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        id='shared-preferences'
        title='Shared preferences'
        description='How you like to work, for every bot. Each one reads it before it starts.'
      >
        <div className={cn(cardClass, 'flex flex-col overflow-clip')}>
          <div className='flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4'>
            <span className='flex min-w-0 grow'>
              {info && preferences && <PathText path={homePath(preferences, info)} />}
            </span>
            <Button
              variant='ghost'
              className='h-7 rounded-sm px-2 text-13'
              disabled={!preferences}
              onClick={() => preferences && copyFilePath(preferences)}
            >
              Edit
            </Button>
          </div>
          <pre className='scrollbar-subtle max-h-60 overflow-auto px-4 pt-3 pb-3.5 font-mono text-xs leading-5 whitespace-pre-wrap'>
            {info?.sharedPreferences.trim() || (
              <span className='text-muted-foreground'>
                Nothing yet. Bots add what they learn about how you work.
              </span>
            )}
          </pre>
        </div>
      </SettingsSection>
      <SettingsSection id='rhythm' title='Rhythm'>
        <SettingsCard>
          <SettingsRow
            title='Check-ins'
            description="A quiet bot looks over its area. Only while you're around."
            disabled
          >
            <SettingsSelect
              label='Check-ins'
              value='hourly'
              options={[{ value: 'hourly', label: 'Every hour' }]}
              disabled
            />
          </SettingsRow>
          <SettingsRow
            title='Tidying'
            description='Bots compact their chats and file their notes'
            disabled
          >
            <SettingsSelect
              label='Tidying'
              value='away'
              options={[{ value: 'away', label: "While you're away" }]}
              disabled
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <NewBotDialog open={creating} onOpenChange={setCreating} />
    </SettingsPage>
  )
}
