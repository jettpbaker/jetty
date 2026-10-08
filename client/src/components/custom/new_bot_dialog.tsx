import type { BotColor, BotShape, PermissionMode } from '@jetty/shared/wire'
import type { CSSProperties, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { findModel, slotLoadout, type Loadout, type LoadoutSlot } from '@/lib/loadout'
import { useCreateBot, useLoadouts, useModels, useProjects, useCreateProject } from '@/state'
import { BOT_EFFORTS } from '@jetty/shared/bots'
import { BOT_NAME_MAX } from '@jetty/shared/wire'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { ComposerLoadout } from './composer_loadout'
import { Folder01Icon, FolderAddIcon, InformationCircleIcon, LayersIcon } from './huge_icons'
import { JettyBot } from './jetty_bot'
import { botColors, colorIds, deepBotColors, shapeIds } from './jetty_bot_shapes'
import { OptionPicker } from './option_picker'
import { ProjectFolderDialog } from './project_folder_dialog'

const ALL = 'all'

// Accent follows whichever accent is on, so its swatch is a wheel of the accent presets rather
// than a copy of the one that's on.
const accentWheel = ['orange', 'teal', 'blue', 'lilac', 'rose', 'orange'] as const

function swatchStyle(id: BotColor) {
  if (id !== 'accent')
    return { '--body': botColors[id], '--deep': deepBotColors[id] } as CSSProperties
  const wheel = (colors: Record<BotColor, string>) =>
    `conic-gradient(${accentWheel.map((each) => colors[each]).join(', ')})`
  return { '--body': wheel(botColors), '--deep': wheel(deepBotColors) } as CSSProperties
}

function firstClaudeLoadout(slots: readonly LoadoutSlot[], catalog: ReturnType<typeof useModels>) {
  for (const slot of slots) {
    const loadout = slotLoadout(slot)
    if (loadout?.provider === 'claude' && findModel(catalog, loadout)) return botLoadout(loadout)
  }
  const model = catalog.find((item) => item.provider === 'claude')
  return (
    model && {
      provider: 'claude' as const,
      model: model.id,
      effort:
        model.defaultEffort && BOT_EFFORTS.includes(model.defaultEffort)
          ? model.defaultEffort
          : model.efforts.find((effort) => BOT_EFFORTS.includes(effort)),
      fast: false,
    }
  )
}

function botLoadout(loadout: Loadout): Loadout {
  return {
    ...loadout,
    effort: loadout.effort && !BOT_EFFORTS.includes(loadout.effort) ? 'high' : loadout.effort,
  }
}

export function NewBotDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Each opening starts a fresh form, and the last one stays put while the dialog animates out.
  const [opened, setOpened] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpened(opened + 1)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NewBotForm key={opened} onOpenChange={onOpenChange} />
    </Dialog>
  )
}

function NewBotForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const createBot = useCreateBot()
  const createProject = useCreateProject()
  const loadedProjects = useProjects()
  const projects = loadedProjects ?? []
  const { loadouts, usable, catalog, setLoadouts } = useLoadouts()
  const models = useModels()
  const [name, setName] = useState('')
  const [shape, setShape] = useState<BotShape>('squircle')
  const [color, setColor] = useState<BotColor>('mint')
  const [loadout, setLoadout] = useState<Loadout | undefined>(() =>
    firstClaudeLoadout(loadouts, catalog)
  )
  const [project, setProject] = useState(() => (projects.length === 1 ? projects[0]!.id : ALL))
  const projectReady = useRef(loadedProjects !== undefined)
  const [access, setAccess] = useState<PermissionMode>('auto')
  const [adding, setAdding] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const filteredCatalog = models.map((model) => ({
    ...model,
    efforts: model.efforts.filter((effort) => BOT_EFFORTS.includes(effort)),
  }))
  const chosenLoadout = loadout ?? firstClaudeLoadout(loadouts, catalog)
  useEffect(() => {
    if (projectReady.current || !loadedProjects) return
    projectReady.current = true
    setProject(loadedProjects.length === 1 ? loadedProjects[0]!.id : ALL)
  }, [loadedProjects])

  function submit() {
    if (!chosenLoadout || chosenLoadout.provider !== 'claude') return
    const id = createBot({
      name: name.trim() || 'Bot',
      shape,
      color,
      provider: 'claude',
      model: chosenLoadout.model,
      effort: chosenLoadout.effort,
      fast: chosenLoadout.fast,
      projectId: project === ALL ? null : project,
      permissionMode: access,
    })
    onOpenChange(false)
    void navigate({ to: '/bots/$botId', params: { botId: id } })
  }

  return (
    <>
      <DialogContent initialFocus={nameRef} className='sm:max-w-90'>
        <DialogTitle className='text-sm'>New bot</DialogTitle>
        <DialogDescription className='sr-only'>
          Give the bot a face, a name, a model, a project and an access mode.
        </DialogDescription>
        <form
          className='flex min-w-0 flex-col gap-4'
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className='flex flex-col items-center gap-1'>
            <Popover>
              <PopoverTrigger
                aria-label='Change face'
                className='flex rounded-xl p-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent'
              >
                <JettyBot
                  shape={shape}
                  color={color}
                  state='idle'
                  size={64}
                  follow
                  label={name || 'Bot'}
                />
              </PopoverTrigger>
              <PopoverContent
                side='bottom'
                align='center'
                className='w-auto gap-0 rounded-sm p-0 ring-border'
              >
                <PopoverTitle className='sr-only'>Face</PopoverTitle>
                {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- sketchpad face grid */}
                <div className='grid grid-cols-7 gap-1 p-2' role='group' aria-label='Shape'>
                  {shapeIds.map((id) => (
                    <Button
                      key={id}
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={id}
                      aria-pressed={id === shape}
                      onClick={() => setShape(id)}
                      className='aria-pressed:bg-accent'
                    >
                      <JettyBot shape={id} color={color} size={20} className='size-5' />
                    </Button>
                  ))}
                </div>
                <Separator />
                {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- sketchpad colour grid */}
                <div className='grid grid-cols-7 gap-1 p-2' role='group' aria-label='Colour'>
                  {colorIds.map((id) => (
                    <Button
                      key={id}
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={id === 'accent' ? 'Accent' : id}
                      aria-pressed={id === color}
                      onClick={() => setColor(id)}
                      className='aria-pressed:bg-accent'
                    >
                      <span
                        className='size-4 rounded-full [background:var(--deep)] dark:[background:var(--body)]'
                        style={swatchStyle(id)}
                      />
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <input
              ref={nameRef}
              aria-label='Name'
              data-1p-ignore
              autoComplete='off'
              placeholder='Bot'
              maxLength={BOT_NAME_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className='w-full rounded-sm bg-transparent px-2 py-1 text-center text-base font-medium text-foreground outline-none placeholder:text-muted-foreground'
            />
          </div>
          <div className='flex flex-col'>
            <Row label='Model'>
              <ComposerLoadout
                catalog={filteredCatalog}
                loadouts={loadouts}
                usable={usable}
                value={chosenLoadout}
                onChange={(next) => setLoadout(botLoadout(next))}
                onReorder={setLoadouts}
                onOpenSettings={() => {
                  onOpenChange(false)
                  void navigate({ to: '/settings' })
                }}
                disabledProviders={['codex', 'grok']}
                allowedEfforts={BOT_EFFORTS}
                hotkeys={false}
              />
            </Row>
            <Row label='Project'>
              {projects.length === 0 ? (
                <Button
                  type='button'
                  variant='ghost-text'
                  size='sm'
                  className='gap-1.5 rounded-sm'
                  onClick={() => setAdding(true)}
                >
                  <FolderAddIcon />
                  Add project
                </Button>
              ) : (
                <OptionPicker
                  name='Project'
                  label='Project'
                  placeholder='Search projects'
                  icon={<Folder01Icon />}
                  value={project}
                  align='end'
                  options={[
                    ...projects.map((each) => ({ value: each.id, label: each.title })),
                    { value: ALL, label: 'All projects', icon: <LayersIcon /> },
                  ]}
                  onValueChange={setProject}
                  actions={[
                    {
                      label: 'Add project…',
                      icon: <FolderAddIcon />,
                      onSelect: () => setAdding(true),
                    },
                  ]}
                />
              )}
            </Row>
            <Row label={<FullAccessLabel />}>
              <Switch
                aria-label='Full access'
                checked={access === 'full_access'}
                onCheckedChange={(on) => setAccess(on ? 'full_access' : 'auto')}
              />
            </Row>
          </div>
          <DialogFooter>
            <Button type='submit' disabled={!chosenLoadout}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ProjectFolderDialog
        open={adding}
        onOpenChange={setAdding}
        existingPaths={projects.map((each) => each.path)}
        onAdd={(path) => createProject(path, (created) => setProject(created.id))}
      />
    </>
  )
}

export function FullAccessLabel() {
  return (
    <span className='flex items-start gap-0.5'>
      Full access
      <Tooltip>
        <TooltipTrigger
          aria-label='About full access'
          className='relative -mt-0.5 flex rounded-full text-muted-foreground before:absolute before:-inset-1.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
        >
          <InformationCircleIcon className='size-2.5' />
        </TooltipTrigger>
        <TooltipContent className='max-w-56'>
          Never stops to ask. Off, it stops before anything risky.
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className='flex h-8 items-center justify-between gap-3'>
      <span className='shrink-0 text-13'>{label}</span>
      {children}
    </div>
  )
}
