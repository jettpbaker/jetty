import {
  AnalyticsIcon,
  ChevronGrabberVerticalIcon,
  ContrastIcon,
  KeyboardIcon,
  SettingsGear1Icon,
} from '@/components/custom/central_icons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAnimatedTheme } from '@/lib/theme'
import { useIdentity } from '@/state/identity'
import { usePrefetchProviderUsage } from '@/state/provider-usage'
import { useNavigate } from '@tanstack/react-router'

import { KeybindChip, keybinds } from './keybinds'

const themes = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'oled', label: 'OLED' },
] as const

export function SidebarProfileMenu({ rowClass }: { rowClass: string }) {
  const navigate = useNavigate()
  const identity = useIdentity()
  const prefetchUsage = usePrefetchProviderUsage()
  const { theme, setTheme } = useAnimatedTheme()
  const name = identity?.name.split(/\s+/)[0] || identity?.login || ''
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='ghost' className={rowClass} />}>
        <Avatar className='size-5'>
          {identity?.avatarUrl && <AvatarImage src={identity.avatarUrl} alt='' />}
          <AvatarFallback className='text-[10px]'>{name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className='truncate'>{name}</span>
        <ChevronGrabberVerticalIcon className='ml-auto' />
      </DropdownMenuTrigger>
      <DropdownMenuContent side='top' align='start' className='w-(--anchor-width)'>
        <DropdownMenuItem onClick={() => void navigate({ to: '/settings' })}>
          <SettingsGear1Icon />
          Settings
          <KeybindChip binding={keybinds.settings} className='ml-auto' />
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className='[&>svg:last-child]:ml-0'>
            <ContrastIcon />
            Appearance
            <span className='-mr-2 ml-auto text-muted-foreground'>
              {themes.find((option) => option.value === theme)?.label}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {themes.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onPointerEnter={prefetchUsage}
          onClick={() => void navigate({ to: '/usage' })}
        >
          <AnalyticsIcon />
          Usage
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void navigate({ to: '/settings/$page', params: { page: 'keyboard' } })}
        >
          <KeyboardIcon />
          Keyboard shortcuts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
