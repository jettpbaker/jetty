import type { Bot } from '@jetty/shared/wire'

import { BotAvatar } from '@/components/custom/bot_avatar'
import { Cancel01Icon, SidebarLeftIcon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useSetBotAllowRules } from '@/state'
import { useState } from 'react'

export function BotSettingsSheet({ bot }: { bot: Bot }) {
  const [text, setText] = useState('')
  const setRules = useSetBotAllowRules()
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
      <SheetContent className='gap-[22px] overflow-y-auto p-6 data-[side=right]:w-[440px] data-[side=right]:max-w-full'>
        <SheetHeader className='p-0'>
          <SheetTitle className='flex items-center gap-2.5'>
            <BotAvatar bot={bot} size={22} unread={false} />
            {bot.name} settings
          </SheetTitle>
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
            <div className='flex h-8 items-center justify-between gap-3'>
              <span>Model</span>
              <Button variant='ghost-text' size='sm' disabled>
                {bot.model} {bot.effort}
              </Button>
            </div>
            <div className='flex h-8 items-center justify-between gap-3'>
              <span>Full access</span>
              <Switch
                aria-label='Full access'
                checked={bot.permissionMode === 'full_access'}
                disabled
              />
            </div>
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
                  <div className='break-words text-[13px]'>{rule.text}</div>
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
            <form
              onSubmit={(event) => {
                event.preventDefault()
                addRule()
              }}
              className='flex min-h-9 items-center px-[11px] py-2'
            >
              <Input
                aria-label='Add a rule in plain words'
                placeholder='Add a rule in plain words…'
                value={text}
                onChange={(event) => setText(event.target.value)}
                className='h-auto rounded-none border-0 p-0 text-[13px] shadow-none md:text-[13px]'
              />
              {text.trim() && (
                <Button size='xs' variant='ghost-text' type='submit'>
                  Add
                </Button>
              )}
            </form>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
