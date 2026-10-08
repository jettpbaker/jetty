import { CropIcon, Delete02Icon, Upload04Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  checkVideoWallpaper,
  loadAppearance,
  prepareWallpaper,
  saveAppearance,
  saveVideoWallpaper,
  useAppearance,
  type Appearance,
} from '@/lib/appearance'
import { useAnimatedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { pickFiles } from '@/platform'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { AccentPicker } from './accent_picker'
import { DisabledTooltip } from './disabled_tooltip'
import { Mono, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from './settings_layout'
import { WallpaperEditor } from './wallpaper_editor'
import './settings_appearance.css'

const themes = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
] as const

function TilePanel({ tile }: { tile?: 'light' | 'dark' }) {
  return (
    <div className='theme-tile-panel' data-tile={tile}>
      <span className='theme-tile-title' />
      <span className='theme-tile-card'>
        <span />
        <span />
      </span>
    </div>
  )
}

function ThemeTile({ theme }: { theme: (typeof themes)[number]['value'] }) {
  if (theme === 'system')
    return (
      <span className='theme-tile' data-tile='system'>
        <TilePanel tile='light' />
        <TilePanel tile='dark' />
      </span>
    )
  return (
    <span className='theme-tile' data-tile={theme}>
      <span className='theme-tile-rail'>
        <span />
        <span />
        <span />
      </span>
      <TilePanel />
    </span>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const textButtonClass = 'h-7 rounded-sm px-2.5 text-13'

export function SettingsAppearance() {
  const { theme, setTheme } = useAnimatedTheme()
  const appearance = useAppearance()
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const uploadGeneration = useRef(0)
  useEffect(() => {
    const generation = uploadGeneration
    return () => {
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
      await saveAppearance({
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
  async function setAuto(change: Partial<Pick<Appearance, 'autoAccent' | 'autoTint'>>) {
    try {
      await saveAppearance({ ...appearance, ...change })
      setError('')
    } catch {
      setError('Your appearance preference could not be saved.')
    }
  }
  async function chooseVideo() {
    const [file] = await pickFiles({ accept: 'video/webm,video/mp4', multiple: false })
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await checkVideoWallpaper(file)
      await saveVideoWallpaper(file)
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === 'QuotaExceededError'
          ? 'There is not enough browser storage. Try a smaller video.'
          : cause instanceof Error
            ? cause.message
            : 'Could not save this video.'
      )
    } finally {
      setUploading(false)
    }
  }
  async function removeVideo() {
    try {
      await saveVideoWallpaper(null)
      setError('')
    } catch {
      setError('Could not remove the video.')
    }
  }
  async function removeWallpaper() {
    try {
      await saveAppearance({
        ...appearance,
        wallpaper: '',
        filename: null,
        autoAccent: false,
        autoTint: false,
      })
      setError('')
    } catch {
      setError('Could not remove the wallpaper.')
    }
  }
  const noWallpaper = appearance.wallpaper ? undefined : 'Add a wallpaper first.'
  return (
    <SettingsPage title='Appearance' description='How Jetty looks on this device.'>
      <SettingsSection id='theme' title='Theme'>
        <div role='radiogroup' aria-label='Theme' className='flex gap-3'>
          {themes.map(({ value, label }) => (
            <button
              key={value}
              type='button'
              role='radio'
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className='group/tile flex min-w-0 flex-1 basis-0 flex-col gap-2 rounded-lg text-left outline-none'
            >
              <span
                className={cn(
                  'rounded-lg group-focus-visible/tile:ring-2 group-focus-visible/tile:ring-ring',
                  theme === value &&
                    '[&>.theme-tile]:outline-2 [&>.theme-tile]:-outline-offset-2 [&>.theme-tile]:outline-primary'
                )}
              >
                <ThemeTile theme={value} />
              </span>
              <span
                className={cn(
                  'pl-0.5 text-13',
                  theme === value
                    ? 'text-foreground'
                    : 'text-muted-foreground group-hover/tile:text-foreground'
                )}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
        <SettingsCard className='mt-2'>
          <SettingsRow id='accent' title='Accent' description='Selection, focus and links'>
            <AccentPicker />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title='Wallpaper' description='Sits behind the new-thread page.'>
        <SettingsCard>
          <SettingsRow
            id='wallpaper-image'
            title='Image'
            description={
              appearance.wallpaper ? (
                <Mono>{appearance.filename ?? 'wallpaper'}</Mono>
              ) : (
                'JPEG, PNG or WebP'
              )
            }
          >
            {appearance.wallpaper ? (
              <div className='flex shrink-0 items-center gap-1'>
                <IconAction
                  label='Crop image'
                  disabled={uploading}
                  onClick={() => setEditing(true)}
                >
                  <CropIcon />
                </IconAction>
                <IconAction
                  label='Change image'
                  disabled={uploading}
                  onClick={() => void chooseImage()}
                >
                  <Upload04Icon />
                </IconAction>
                <IconAction
                  label='Remove image'
                  disabled={uploading}
                  onClick={() => void removeWallpaper()}
                >
                  <Delete02Icon />
                </IconAction>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type='button'
                        aria-label='Edit wallpaper crop'
                        disabled={uploading}
                        onClick={() => setEditing(true)}
                        className='ml-1 h-8 w-14 overflow-hidden rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      />
                    }
                  >
                    <img
                      src={appearance.wallpaper}
                      alt='Current wallpaper'
                      className='size-full object-cover'
                    />
                  </TooltipTrigger>
                  <TooltipContent>Crop image</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <Button
                variant='ghost'
                className={textButtonClass}
                disabled={uploading}
                onClick={() => void chooseImage()}
              >
                {uploading ? 'Preparing…' : 'Add image'}
              </Button>
            )}
          </SettingsRow>
          <SettingsRow
            id='wallpaper-video'
            title='Video'
            description='Plays instead of the image. WebM or MP4.'
          >
            {appearance.video ? (
              <div className='flex shrink-0 items-center gap-1'>
                <IconAction
                  label='Change video'
                  disabled={uploading}
                  onClick={() => void chooseVideo()}
                >
                  <Upload04Icon />
                </IconAction>
                <IconAction
                  label='Remove video'
                  disabled={uploading}
                  onClick={() => void removeVideo()}
                >
                  <Delete02Icon />
                </IconAction>
                <video
                  src={`${appearance.video}#t=1`}
                  muted
                  preload='auto'
                  aria-label={appearance.videoFilename ?? 'Current video wallpaper'}
                  className='ml-1 h-8 w-14 rounded-sm object-cover'
                />
              </div>
            ) : (
              <Button
                variant='ghost'
                className={textButtonClass}
                disabled={uploading}
                onClick={() => void chooseVideo()}
              >
                Add video
              </Button>
            )}
          </SettingsRow>
          <SettingsRow
            id='match-accent'
            title='Match accent to wallpaper'
            description="Picks the accent from the image's colours"
          >
            <DisabledTooltip reason={noWallpaper} wrap='flex'>
              <Switch
                aria-label='Match accent to wallpaper'
                disabled={!appearance.wallpaper}
                checked={appearance.autoAccent}
                onCheckedChange={(autoAccent) => void setAuto({ autoAccent })}
                className={appearance.wallpaper ? undefined : 'pointer-events-none'}
              />
            </DisabledTooltip>
          </SettingsRow>
          <SettingsRow
            id='tint'
            title='Tint app to wallpaper'
            description='Warms or cools the greys to sit with the image'
          >
            <DisabledTooltip reason={noWallpaper} wrap='flex'>
              <Switch
                aria-label='Tint app to wallpaper'
                disabled={!appearance.wallpaper}
                checked={appearance.autoTint}
                onCheckedChange={(autoTint) => void setAuto({ autoTint })}
                className={appearance.wallpaper ? undefined : 'pointer-events-none'}
              />
            </DisabledTooltip>
          </SettingsRow>
        </SettingsCard>
        {error && (
          <p role='alert' className='px-4 text-xs text-destructive'>
            {error}
          </p>
        )}
      </SettingsSection>
      {editing && <WallpaperEditor appearance={appearance} onClose={() => setEditing(false)} />}
    </SettingsPage>
  )
}
