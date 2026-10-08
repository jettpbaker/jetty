import {
  Moon02Icon,
  MoonEclipseIcon,
  Sun03Icon,
  Upload04Icon,
  ArrowDown01Icon,
  ComputerIcon,
  CropIcon,
  Delete02Icon,
} from '@/components/custom/huge_icons'
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
import {
  checkVideoWallpaper,
  loadAppearance,
  prepareWallpaper,
  saveAppearance,
  saveVideoWallpaper,
  useAppearance,
  type Appearance,
} from '@/lib/appearance'
import { isMonoFont, monoFonts, setMonoFont, useMonoFont } from '@/lib/mono-font'
import { useAnimatedTheme } from '@/lib/theme'
import { pickFiles } from '@/platform'
import { useEffect, useId, useRef, useState } from 'react'

import './settings_sections.css'
import { AccentPicker } from './accent_picker'
import { DisabledTooltip } from './disabled_tooltip'
import { WallpaperEditor } from './wallpaper_editor'

const themes = [
  { value: 'light', label: 'Light', Icon: Sun03Icon },
  { value: 'dark', label: 'Dark', Icon: Moon02Icon },
  { value: 'oled', label: 'OLED', Icon: MoonEclipseIcon },
  { value: 'system', label: 'System', Icon: ComputerIcon },
] as const

export function SettingsAppearance() {
  const { theme, setTheme } = useAnimatedTheme()
  const themeLabel = themes.find((option) => option.value === theme)?.label
  const monoFont = useMonoFont()
  const monoFontLabel = monoFonts.find((option) => option.value === monoFont)?.label
  const appearance = useAppearance()
  const wallpaperAccentId = useId()
  const wallpaperTintId = useId()
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
  return (
    <div>
      <div className='appearance-option-row'>
        <span>Theme</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={`Theme: ${themeLabel}`}
            render={
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1.5 rounded-sm text-xs text-muted-foreground'
              />
            }
          >
            {themeLabel}
            <ArrowDown01Icon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {themes.map(({ value, label, Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon aria-hidden='true' className='size-3' />
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
        <span>Mono font</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={`Mono font: ${monoFontLabel}`}
            render={
              <Button
                variant='ghost'
                size='sm'
                className='h-7 gap-1.5 rounded-sm text-xs text-muted-foreground'
              />
            }
          >
            {monoFontLabel}
            <ArrowDown01Icon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuRadioGroup
              value={monoFont}
              onValueChange={(value) => {
                if (isMonoFont(value)) setMonoFont(value)
              }}
            >
              {monoFonts.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className='appearance-option-row'>
        <span>Wallpaper</span>
        {appearance.wallpaper ? (
          <div className='mr-2 flex items-center gap-2'>
            <div className='flex items-center gap-1'>
              {[
                { label: 'Crop image', Icon: CropIcon, action: () => setEditing(true) },
                { label: 'Change image', Icon: Upload04Icon, action: () => void chooseImage() },
              ].map(({ label, Icon, action }) => (
                <Tooltip key={label}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant='ghost'
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
                    size='icon'
                    disabled={uploading}
                    aria-label='Remove image'
                    onClick={() => void removeWallpaper()}
                  />
                }
              >
                <Delete02Icon className='size-3.5' />
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
      <div className='appearance-option-row'>
        <span>Video wallpaper</span>
        {appearance.video ? (
          <div className='mr-2 flex items-center gap-2'>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    disabled={uploading}
                    aria-label='Change video'
                    onClick={() => void chooseVideo()}
                  />
                }
              >
                <Upload04Icon className='size-3.5' />
              </TooltipTrigger>
              <TooltipContent>Change video</TooltipContent>
            </Tooltip>
            <video
              src={`${appearance.video}#t=1`}
              muted
              preload='auto'
              aria-label={appearance.videoFilename ?? 'Current video wallpaper'}
              className='h-7 w-12 rounded-sm object-cover'
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    disabled={uploading}
                    aria-label='Remove video'
                    onClick={() => void removeVideo()}
                  />
                }
              >
                <Delete02Icon className='size-3.5' />
              </TooltipTrigger>
              <TooltipContent>Remove video</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <Button
            variant='ghost-text'
            size='sm'
            className='h-7 rounded-sm'
            disabled={uploading}
            onClick={() => void chooseVideo()}
          >
            Add video
          </Button>
        )}
      </div>
      <DisabledTooltip reason={appearance.wallpaper ? undefined : 'Add a wallpaper first.'}>
        <div
          className='appearance-option-row'
          tabIndex={appearance.wallpaper ? -1 : 0}
          role='group'
          aria-label='Wallpaper accent'
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
            checked={appearance.autoAccent}
            onCheckedChange={(autoAccent) => void setAuto({ autoAccent })}
            className={`mr-2 ${appearance.wallpaper ? '' : 'pointer-events-none'}`}
          />
        </div>
      </DisabledTooltip>
      <DisabledTooltip reason={appearance.wallpaper ? undefined : 'Add a wallpaper first.'}>
        <div
          className='appearance-option-row'
          tabIndex={appearance.wallpaper ? -1 : 0}
          role='group'
          aria-label='Wallpaper tint'
        >
          <label
            htmlFor={wallpaperTintId}
            className={appearance.wallpaper ? undefined : 'text-disabled-foreground'}
          >
            Tint app to wallpaper
          </label>
          <Switch
            id={wallpaperTintId}
            disabled={!appearance.wallpaper}
            checked={appearance.autoTint}
            onCheckedChange={(autoTint) => void setAuto({ autoTint })}
            className={`mr-2 ${appearance.wallpaper ? '' : 'pointer-events-none'}`}
          />
        </div>
      </DisabledTooltip>
      {editing && <WallpaperEditor appearance={appearance} onClose={() => setEditing(false)} />}
      {error && (
        <p role='alert' className='text-xs text-destructive'>
          {error}
        </p>
      )}
    </div>
  )
}
