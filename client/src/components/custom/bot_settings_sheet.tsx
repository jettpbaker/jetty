import type { Bot, BotAllowRule } from '@jetty/shared/wire'

import { BotAvatar } from '@/components/custom/bot_avatar'
import { Cancel01Icon } from '@/components/custom/huge_icons'
import {
  BotLoadoutPicker,
  BotNameInput,
  FacePicker,
  FullAccessLabel,
  Row,
} from '@/components/custom/new_bot_dialog'
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
import { useSetBotAllowRules, useUpdateBot } from '@/state'
import { useNavigate } from '@tanstack/react-router'
import { useState, type ReactElement } from 'react'

// `children` is the control that opens the sheet.
export function BotSettingsSheet({ bot, children }: { bot: Bot; children: ReactElement }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [name, setName] = useState<string>()
  const setRules = useSetBotAllowRules()
  const update = useUpdateBot()
  const navigate = useNavigate()
  const rules = bot.allowRules ?? []
  function saveName() {
    const next = name?.trim()
    if (next && next !== bot.name) update(bot.id, { name: next })
    setName(undefined)
  }
  function addRule() {
    if (!text.trim()) return
    setRules(bot.id, [
      ...rules,
      { id: crypto.randomUUID(), text: text.trim(), createdAt: Date.now() },
    ])
    setText('')
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={children} />
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
            <FacePicker
              shape={bot.shape}
              color={bot.color}
              label={bot.name}
              onShapeChange={(shape) => update(bot.id, { shape })}
              onColorChange={(color) => update(bot.id, { color })}
            />
            <BotNameInput
              value={name ?? bot.name}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveName()
              }}
            />
          </div>
          <div className='flex flex-col'>
            <Row label='Model'>
              <BotLoadoutPicker
                value={bot}
                onChange={(next) => {
                  const changes = {
                    ...(next.model !== bot.model && { model: next.model }),
                    ...(next.effort && next.effort !== bot.effort && { effort: next.effort }),
                    ...(next.fast !== bot.fast && { fast: next.fast }),
                  }
                  if (Object.keys(changes).length) update(bot.id, changes)
                }}
                onOpenSettings={() => {
                  setOpen(false)
                  void navigate({ to: '/settings/$page', params: { page: 'models' } })
                }}
              />
            </Row>
            <Row label={<FullAccessLabel />}>
              <Switch
                aria-label='Full access'
                checked={bot.permissionMode === 'full_access'}
                onCheckedChange={(on) =>
                  update(bot.id, { permissionMode: on ? 'full_access' : 'auto' })
                }
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
                    {[
                      ruleOrigin(rule),
                      new Date(rule.createdAt).toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                      }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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

function ruleOrigin(rule: BotAllowRule) {
  if (!rule.source) return 'Written by you'
  return rule.source === rule.text.replaceAll('`', '') ? undefined : `From ${rule.source}`
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
