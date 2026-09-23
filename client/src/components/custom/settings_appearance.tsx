import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { accentChangeEvent, accentPresets, loadAccent, setAccent } from '@/lib/accent'
import { loadAppearance, prepareWallpaper, saveAppearance, useAppearance } from '@/lib/appearance'
import { useAnimatedTheme } from '@/lib/theme'
import { pickFiles } from '@/platform'
import {
  ImageIcon,
  XIcon,
  CheckIcon,
  MoonIcon,
  SunIcon,
  UploadSimpleIcon,
  CaretDownIcon,
  DesktopIcon,
  CropIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'

import './settings_sections.css'
import { AccentPicker } from './accent_picker'
import { WallpaperEditor } from './wallpaper_editor'

export function SettingsAppearance({ compact = false }: { compact?: boolean }) {
  const { theme: selectedTheme, resolvedTheme, setTheme } = useAnimatedTheme()
  const appearance = useAppearance()
  const wallpaperAccentId = useId()
  const [accent, updateAccent] = useState(loadAccent)
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const uploadGeneration = useRef(0)
  useEffect(() => {
    const sync = () => updateAccent(loadAccent())
    window.addEventListener(accentChangeEvent, sync)
    const generation = uploadGeneration
    return () => {
      window.removeEventListener(accentChangeEvent, sync)
      generation.current += 1
    }
  }, [])
  async function upload(file?: File) {
    if (!file) return
    const generation = ++uploadGeneration.current
    setUploading(true)
    setError('')
    try {
      const wallpaper = await prepareWallpaper(file)
      if (generation !== uploadGeneration.current) return
      saveAppearance({
        ...loadAppearance(),
        wallpaper,
        filename: file.name,
        source: undefined,
        crop: undefined,
      })
    } catch (cause) {
      if (generation === uploadGeneration.current)
        setError(
          cause instanceof DOMException && cause.name === 'QuotaExceededError'
            ? 'There is not enough browser storage. Try a smaller image.'
            : cause instanceof Error
              ? cause.message
              : 'Could not save this image.'
        )
    } finally {
      if (generation === uploadGeneration.current) setUploading(false)
    }
  }
  async function chooseImage() {
    const [file] = await pickFiles({ accept: 'image/jpeg,image/png,image/webp', multiple: false })
    await upload(file)
  }
  function setAuto(autoAccent: boolean) {
    try {
      saveAppearance({ ...appearance, autoAccent })
      setError('')
    } catch {
      setError('Your appearance preference could not be saved.')
    }
  }
  if (compact)
    return (
      <div className='appearance-rows'>
        <div className='appearance-option-row'>
          <span>Theme</span>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              aria-label='Theme'
              render={
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 gap-1.5 rounded-sm text-xs text-muted-foreground'
                />
              }
            >
              {selectedTheme === 'system' ? 'System' : selectedTheme === 'light' ? 'Light' : 'Dark'}
              <CaretDownIcon className='size-3' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuRadioGroup
                value={selectedTheme}
                onValueChange={(value) => setTheme(String(value))}
              >
                {(
                  [
                    { value: 'light', label: 'Light', Icon: SunIcon },
                    { value: 'dark', label: 'Dark', Icon: MoonIcon },
                    { value: 'system', label: 'System', Icon: DesktopIcon },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon aria-hidden='true' className='size-3 text-muted-foreground' />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className='appearance-option-row'>
          <span>Accent</span>
          <AccentPicker />
        </div>
        <div className='appearance-option-row'>
          <span>Wallpaper</span>
          {appearance.wallpaper ? (
            <div className='mr-2 flex items-center gap-2'>
              <div className='flex items-center gap-1'>
                {[
                  { label: 'Crop image', Icon: CropIcon, action: () => setEditing(true) },
                  {
                    label: 'Change image',
                    Icon: UploadSimpleIcon,
                    action: () => void chooseImage(),
                  },
                ].map(({ label, Icon, action }) => (
                  <Tooltip key={label}>
                    <TooltipTrigger
                      render={
                        <Button
                          variant='ghost'
                          tone='muted'
                          size='icon'
                          disabled={uploading}
                          aria-label={label}
                          onClick={action}
                        />
                      }
                    >
                      <Icon className='size-3.5' />
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='sm'
                      aria-label='Edit wallpaper crop'
                      disabled={uploading}
                      onClick={() => setEditing(true)}
                      className='h-7 w-12 overflow-hidden rounded-sm p-0'
                    />
                  }
                >
                  <img
                    src={appearance.wallpaper}
                    alt='Current wallpaper'
                    className='h-full w-full object-cover'
                  />
                </TooltipTrigger>
                <TooltipContent>Crop image</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      tone='muted'
                      size='icon'
                      disabled={uploading}
                      aria-label='Remove image'
                      onClick={() => {
                        try {
                          saveAppearance({
                            ...appearance,
                            wallpaper: '',
                            filename: null,
                            autoAccent: false,
                            source: undefined,
                            crop: undefined,
                          })
                          setError('')
                        } catch {
                          setError('Could not remove the wallpaper.')
                        }
                      }}
                    />
                  }
                >
                  <TrashIcon className='size-3.5' />
                </TooltipTrigger>
                <TooltipContent>Remove image</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <Button
              variant='ghost-text'
              size='sm'
              className='h-7 rounded-sm'
              disabled={uploading}
              onClick={() => void chooseImage()}
            >
              {uploading ? 'Preparing…' : 'Add image'}
            </Button>
          )}
        </div>
        <Tooltip disabled={Boolean(appearance.wallpaper)}>
          <TooltipTrigger
            render={
              <div
                className='appearance-option-row'
                tabIndex={appearance.wallpaper ? -1 : 0}
                role='group'
                aria-label='Wallpaper accent'
              />
            }
          >
            <label
              htmlFor={wallpaperAccentId}
              className={appearance.wallpaper ? undefined : 'text-disabled-foreground'}
            >
              Match accent to wallpaper
            </label>
            <Switch
              id={wallpaperAccentId}
              disabled={!appearance.wallpaper}
              checked={Boolean(appearance.wallpaper && appearance.autoAccent)}
              onCheckedChange={setAuto}
              className={`mr-2 ${!appearance.wallpaper ? 'pointer-events-none' : ''}`}
            />
          </TooltipTrigger>
          <TooltipContent>Add a wallpaper first.</TooltipContent>
        </Tooltip>
        {editing && <WallpaperEditor appearance={appearance} onClose={() => setEditing(false)} />}
        {error && (
          <p role='alert' className='text-xs text-destructive'>
            {error}
          </p>
        )}
      </div>
    )
  return (
    <div className='settings-appearance flex flex-col gap-6'>
      <div className='appearance-layout'>
        <fieldset className='min-w-0'>
          <legend className='mb-3 text-13'>Theme</legend>
          <div className='grid grid-cols-2 gap-2'>
            {(['light', 'dark'] as const).map((theme) => (
              <button
                key={theme}
                type='button'
                aria-label={`${theme === 'light' ? 'Light' : 'Dark'} theme`}
                aria-pressed={resolvedTheme === theme}
                onClick={() => setTheme(theme)}
                className={`group flex flex-col gap-2 rounded-menu-item border p-2 text-left focus-visible:outline-2 focus-visible:outline-ring ${resolvedTheme === theme ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'}`}
              >
                <span
                  aria-hidden='true'
                  className={`flex h-14 w-full overflow-hidden rounded-[2px] border ${theme === 'light' ? 'border-black/10 bg-[#fafafa]' : 'border-white/10 bg-[#181818]'}`}
                >
                  <span
                    className={`flex w-1/4 flex-col gap-1 p-1.5 ${theme === 'light' ? 'bg-[#eeeeee]' : 'bg-[#101010]'}`}
                  >
                    <span className='h-1 w-full rounded-full bg-primary/60' />
                    <span
                      className={`h-1 w-2/3 rounded-full ${theme === 'light' ? 'bg-black/15' : 'bg-white/15'}`}
                    />
                  </span>
                  <span className='flex flex-1 flex-col justify-end gap-1 p-2'>
                    <span
                      className={`h-1 w-3/4 rounded-full ${theme === 'light' ? 'bg-black/15' : 'bg-white/15'}`}
                    />
                    <span
                      className={`h-3 w-full rounded-[2px] border ${theme === 'light' ? 'border-black/15' : 'border-white/15'}`}
                    />
                  </span>
                </span>
                <span className='flex w-full items-center gap-2 text-xs'>
                  {theme === 'light' ? (
                    <SunIcon className='size-3.5 text-muted-foreground' />
                  ) : (
                    <MoonIcon className='size-3.5 text-muted-foreground' />
                  )}
                  {theme === 'light' ? 'Light' : 'Dark'}
                  {resolvedTheme === theme && <CheckIcon className='ml-auto size-3 text-primary' />}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={appearance.autoAccent} className='min-w-0'>
          <legend className='mb-3 text-13'>Accent color</legend>
          <div
            className={`flex flex-wrap gap-2 ${appearance.autoAccent ? 'opacity-40' : ''}`}
            role='group'
            aria-label='Accent colors'
          >
            {accentPresets.map((preset) => (
              <button
                key={preset.value}
                type='button'
                aria-label={`${preset.label} accent`}
                aria-pressed={!appearance.autoAccent && accent === preset.value}
                disabled={appearance.autoAccent}
                onClick={() => {
                  setAccent(preset.value)
                  updateAccent(preset.value)
                }}
                className='flex size-8 items-center justify-center rounded-menu-item border border-transparent enabled:hover:border-border disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-ring'
              >
                <span
                  data-accent={preset.value}
                  className='accent-swatch flex size-6 items-center justify-center rounded-full'
                >
                  {!appearance.autoAccent && accent === preset.value && (
                    <CheckIcon className='size-3.5 text-white' />
                  )}
                </span>
              </button>
            ))}
          </div>
          <p className='mt-3 flex items-center gap-2 text-xs text-muted-foreground'>
            {appearance.autoAccent ? (
              <>
                <span className='size-2 shrink-0 rounded-full bg-primary' />
                From your wallpaper
              </>
            ) : (
              accentPresets.find((preset) => preset.value === accent)?.label
            )}
          </p>
        </fieldset>
      </div>
      <section className='flex flex-col gap-3' aria-labelledby='wallpaper-heading'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h3 id='wallpaper-heading' className='text-13'>
            New thread wallpaper
          </h3>
        </div>
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragOver(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            void upload(event.dataTransfer.files[0])
          }}
          className={`wallpaper-editor relative overflow-hidden rounded-menu-item border border-border ${dragOver ? 'ring-2 ring-primary' : ''}`}
        >
          <div className='relative aspect-[2/1]'>
            {appearance.wallpaper ? (
              <>
                <img
                  src={appearance.wallpaper}
                  alt='New thread wallpaper preview'
                  className='absolute inset-0 size-full object-cover'
                />
                <div className='pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent' />
              </>
            ) : (
              <button
                type='button'
                disabled={uploading}
                onClick={() => void chooseImage()}
                className='flex size-full flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
              >
                <ImageIcon className='size-6' aria-hidden='true' />
                <span className='text-13'>Choose image</span>
                <span className='text-xs text-muted-foreground'>or drag one here</span>
              </button>
            )}
            {(dragOver || uploading) && (
              <div className='absolute inset-0 flex items-center justify-center bg-background/85 text-13'>
                {uploading ? 'Preparing image…' : 'Drop your wallpaper here'}
              </div>
            )}
          </div>
          {appearance.wallpaper && (
            <div className='absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 text-white'>
              <div className='flex flex-wrap items-center gap-3'>
                <Button
                  variant='ghost-text'
                  size='sm'
                  className='rounded-menu-item px-0 text-white/90 enabled:hover:text-white'
                  disabled={uploading}
                  onClick={() => void chooseImage()}
                >
                  <UploadSimpleIcon />
                  {appearance.filename ? 'Change image' : 'Choose image'}
                </Button>
                <Button
                  variant='ghost-text'
                  size='sm'
                  className='rounded-menu-item px-0 text-white/90 enabled:hover:text-white'
                  disabled={uploading}
                  onClick={() => setEditing(true)}
                >
                  Edit crop
                </Button>
                {
                  <Button
                    variant='ghost-text'
                    size='sm'
                    className='rounded-menu-item text-white/90 enabled:hover:text-white'
                    disabled={uploading}
                    onClick={() => {
                      try {
                        saveAppearance({
                          ...appearance,
                          wallpaper: '',
                          filename: null,
                          autoAccent: false,
                          source: undefined,
                          crop: undefined,
                        })
                        setError('')
                      } catch {
                        setError('Could not remove the wallpaper.')
                      }
                    }}
                  >
                    <XIcon />
                    Remove
                  </Button>
                }
              </div>
              <div className='flex items-center gap-3 text-xs'>
                <span className='text-white/90'>Use wallpaper accent</span>
                <Switch
                  size='sm'
                  checked={appearance.autoAccent}
                  onCheckedChange={setAuto}
                  aria-label='Use wallpaper accent'
                />
              </div>
            </div>
          )}
        </div>
      </section>
      {editing && <WallpaperEditor appearance={appearance} onClose={() => setEditing(false)} />}
      {error && (
        <p role='alert' className='text-xs text-destructive'>
          {error}
        </p>
      )}
    </div>
  )
}
