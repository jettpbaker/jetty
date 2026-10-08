import type { Bot } from '@jetty/shared/wire'

import { BotAvatar } from '@/components/custom/bot_avatar'
import { Cancel01Icon, SidebarLeftIcon } from '@/components/custom/huge_icons'
import { FullAccessLabel, Row } from '@/components/custom/new_bot_dialog'
import { ProviderGlyph } from '@/components/custom/provider_glyph'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { describeLoadout } from '@/lib/loadout'
import { useModels, useSetBotAllowRules } from '@/state'
import { catalogModelName } from '@jetty/shared/model-name'
import { useState } from 'react'

export function BotSettingsSheet({ bot }: { bot: Bot }) {
  const [text, setText] = useState('')
  const setRules = useSetBotAllowRules()
  const models = useModels()
  const rules = bot.allowRules ?? []
  function addRule() {
    if (!text.trim()) return
    setRules(bot.id, [
      ...rules,
      { id: crypto.randomUUID(), text: text.trim(), createdAt: Date.now() },
    ])
    setText('')
  }
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant='ghost' size='icon' aria-label='Open bot settings' className='ml-auto' />
        }
      >
        <SidebarLeftIcon className='rotate-180' />
      </SheetTrigger>
      <SheetContent
        showCloseButton={false}
        className='gap-[22px] overflow-y-auto p-6 data-[side=right]:w-[440px] data-[side=right]:sm:max-w-full'
      >
        <SheetHeader className='flex-row items-center justify-between p-0'>
          <SheetTitle className='flex items-center gap-2.5 text-base'>
            <BotAvatar bot={bot} size={22} unread={false} />
            {bot.name} settings
          </SheetTitle>
          <SheetClose render={<Button variant='ghost' size='icon-sm' className='-mr-1.5' />}>
            <Cancel01Icon />
            <span className='sr-only'>Close</span>
          </SheetClose>
        </SheetHeader>
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col items-center gap-1'>
            <div className='p-2'>
              <BotAvatar
                bot={{ ...bot, activity: 'idle', needsYou: false, unread: false, failed: false }}
                size={64}
                unread={false}
              />
            </div>
            <span className='py-1 text-base font-medium'>{bot.name}</span>
          </div>
          <div className='flex flex-col'>
            <Row label='Model'>
              <Button variant='ghost' size='sm' disabled className='gap-1.5 rounded-sm'>
                <ProviderGlyph provider={bot.provider} className='size-3' />
                {catalogModelName(models, bot.provider, bot.model)}
                <span>{describeLoadout(bot)}</span>
              </Button>
            </Row>
            <Row label={<FullAccessLabel />}>
              <Switch
                aria-label='Full access'
                checked={bot.permissionMode === 'full_access'}
                disabled
              />
            </Row>
          </div>
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex flex-col gap-0.5'>
            <h2 className='text-xs font-medium text-muted-foreground'>Always allowed</h2>
            <p className='text-xs text-muted-foreground'>
              Saved from Allow always. Only used while Full access is off.
            </p>
          </div>
          <div className='flex flex-col overflow-hidden rounded-md border border-border'>
            {rules.map((rule) => (
              <div
                key={rule.id}
                className='flex items-center gap-2 border-b border-border py-2 pr-[5px] pl-[11px]'
              >
                <div className='flex min-w-0 grow flex-col gap-0.5'>
                  <div className='text-13 break-words'>
                    <RuleText text={rule.text} />
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {rule.source ? `From ${rule.source}` : 'Written by you'} ·{' '}
                    {new Date(rule.createdAt).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                </div>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Remove rule: ${rule.text}`}
                  onClick={() =>
                    setRules(
                      bot.id,
                      rules.filter((candidate) => candidate.id !== rule.id)
                    )
                  }
                >
                  <Cancel01Icon />
                </Button>
              </div>
            ))}
            <input
              aria-label='Add a rule in plain words'
              placeholder='Add a rule in plain words…'
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  addRule()
                }
              }}
              className='min-h-9 bg-transparent px-[11px] py-2 text-13 outline-none placeholder:text-muted-foreground'
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// A rule's `command` reads in mono, as the approval card showed it.
function RuleText({ text }: { text: string }) {
  return text.split('`').map((part, index) =>
    index % 2 ? (
      <span key={index} className='font-mono text-xs'>
        {part}
      </span>
    ) : (
      part
    )
  )
}
