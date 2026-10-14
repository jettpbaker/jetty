import type { Bot } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useShowQuietTurns } from '@/lib/bot-quiet-turns'
import { effortLabels, findModel } from '@/lib/loadout'
import { cn } from '@/lib/utils'
import { useArchiveBot, useArchivedBots, useBots, useChrome } from '@/state'
import { homePath, useSettingsInfo } from '@/state/models'
import { modelLabelText } from '@jetty/shared/model-name'
import { useState } from 'react'

import { DeleteBotDialog } from './bot_archive'
import { BotAvatar } from './bot_avatar'
import { BotSettingsSheet } from './bot_settings_sheet'
import {
  ArrowOutOfBoxIcon,
  ChevronRightSmallIcon,
  Folder1Icon,
  PlusMediumIcon,
} from './central_icons'
import { accessModes } from './composer_access_mode'
import { copyFilePath } from './file_link'
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
          <Folder1Icon />
          <span className='truncate'>{project}</span>
        </span>
        <ChevronRightSmallIcon className='text-muted-foreground group-hover/bot:text-foreground' />
      </button>
    </BotSettingsSheet>
  )
}

function ArchivedBotRow({ bot }: { bot: Bot }) {
  const archive = useArchiveBot()
  const [deleting, setDeleting] = useState(false)
  return (
    <div className='flex min-h-15 items-center gap-3 py-3'>
      <span className='flex size-7 shrink-0 items-center justify-center'>
        <BotAvatar bot={bot} size={34} unread={false} />
      </span>
      <span className='min-w-0 grow truncate text-13'>{bot.name}</span>
      <SettingsButton onClick={() => archive(bot.id, false)}>
        <ArrowOutOfBoxIcon />
        Restore
      </SettingsButton>
      <Button variant='destructive' size='sm' onClick={() => setDeleting(true)}>
        Delete
      </Button>
      <DeleteBotDialog bot={bot} open={deleting} onOpenChange={setDeleting} />
    </div>
  )
}

export function SettingsBots() {
  const bots = useBots()
  const archived = useArchivedBots()
  const info = useSettingsInfo()
  const [creating, setCreating] = useState(false)
  const [showQuietTurns, setShowQuietTurns] = useShowQuietTurns()
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
            <PlusMediumIcon />
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
      {archived.length > 0 && (
        <SettingsSection
          id='archived-bots'
          title='Archived'
          description='Hidden from the sidebar. Restore one to bring it back, or delete it and its home.'
        >
          <SettingsCard>
            {archived.map((bot) => (
              <ArchivedBotRow key={bot.id} bot={bot} />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}
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
          <pre className='scrollbar-subtle max-h-60 overflow-auto px-4 pt-3 pb-3.5 text-xs leading-5 whitespace-pre-wrap'>
            {info?.sharedPreferences.trim() || (
              <span className='text-muted-foreground'>
                Nothing yet. Bots add what they learn about how you work.
              </span>
            )}
          </pre>
        </div>
      </SettingsSection>
      <SettingsSection id='chat' title='Chat'>
        <SettingsCard>
          <SettingsRow
            id='show-quiet-turns'
            title='Show check-ins and tidies'
            description='Show what a bot did when Jetty woke it, even when it had nothing to tell you'
          >
            <Switch
              checked={showQuietTurns}
              onCheckedChange={setShowQuietTurns}
              aria-label='Show check-ins and tidies'
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection id='rhythm' title='Rhythm'>
        <SettingsCard>
          <SettingsRow
            title='Check-ins'
            description="A quiet bot looks over its area while you're around. About hourly on Claude, every 25 minutes on Codex and Copilot."
            disabled
          >
            <SettingsSelect
              label='Check-ins'
              value='automatic'
              options={[{ value: 'automatic', label: 'Automatic' }]}
              disabled
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <NewBotDialog open={creating} onOpenChange={setCreating} />
    </SettingsPage>
  )
}
