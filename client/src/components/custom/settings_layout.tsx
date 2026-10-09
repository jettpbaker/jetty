import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'
import { type ComponentProps, type ReactElement, type ReactNode } from 'react'

import type { Icon } from './huge_icons'

import { DisabledTooltip } from './disabled_tooltip'
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon } from './huge_icons'
import { settingsPage } from './settings_nav'

export const comingSoon = 'Coming soon'

// Scrolls a row into view and focuses its control: where search and in-app links land.
export function revealSettingsRow(id: string) {
  const row = document.getElementById(`settings-${id}`)
  if (!row) return
  row.scrollIntoView({ block: 'center' })
  const focusable =
    'input:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
  const control = row.matches(focusable) ? row : row.querySelector<HTMLElement>(focusable)
  // After the press that asked for it has finished focusing its own button.
  requestAnimationFrame(() =>
    control?.focus({ preventScroll: true, focusVisible: true } as FocusOptions)
  )
}

export function SettingsPage({
  title,
  description,
  parent,
  action,
  className,
  children,
}: {
  title: string
  description: ReactNode
  // A sub-page links back to the page it opened from.
  parent?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  const back = parent ? settingsPage(parent) : undefined
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-160 flex-col gap-10 pb-16',
        back ? 'pt-5.5' : 'pt-14',
        className
      )}
    >
      <header className='relative flex flex-col gap-1.5 px-4'>
        {back && (
          <Link
            to='/settings/$page'
            params={{ page: back.id }}
            className='-ml-1 flex h-7 items-center gap-1 self-start rounded-sm text-13 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
          >
            <ArrowLeft01Icon />
            {back.title}
          </Link>
        )}
        <h1 className='text-2xl font-semibold tracking-[-0.012em]'>{title}</h1>
        <p className='text-13 leading-5 text-muted-foreground'>{description}</p>
        {action && (
          <div className='absolute top-0.5 right-0 flex items-center gap-2.5'>{action}</div>
        )}
      </header>
      {children}
    </div>
  )
}

export function SettingsSection({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id?: string
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      id={id && `settings-${id}`}
      className={cn('flex scroll-mt-6 flex-col gap-3', className)}
    >
      {title && (
        <div className={cn('flex items-end gap-4 pl-4', action ? 'pr-0' : 'pr-4')}>
          <div className='flex min-w-0 grow flex-col gap-0.5'>
            <h2 className='text-sm font-medium'>{title}</h2>
            {description && (
              <p className='text-13 leading-5 text-muted-foreground'>{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

// Quiet cards a step off the page; light mode outlines them, where the step alone is too faint.
export const cardClass = 'rounded-lg bg-card shadow-[0_0_0_1px_var(--border)] dark:shadow-none'

export function SettingsCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn(cardClass, 'flex flex-col divide-y divide-border px-4', className)}>
      {children}
    </div>
  )
}

// The last folder tells paths apart, so a long path gives way before it does.
export function PathText({ path, className }: { path: string; className?: string }) {
  const slash = path.lastIndexOf('/', path.length - 2)
  return (
    <span
      className={cn('flex min-w-0 font-mono text-xs text-muted-foreground', className)}
      title={path}
    >
      <span className='truncate'>{path.slice(0, slash)}</span>
      <span className='max-w-full shrink-0 truncate'>{path.slice(slash)}</span>
    </span>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className='font-mono text-[11px]'>{children}</code>
}

function RowIcon({ icon: Glyph, disabled }: { icon: Icon | ReactElement; disabled?: boolean }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md [&>svg]:size-4',
        disabled
          ? 'bg-foreground/3 text-disabled-foreground'
          : 'bg-foreground/6 text-muted-foreground'
      )}
    >
      {typeof Glyph === 'function' ? <Glyph /> : Glyph}
    </span>
  )
}

function RowText({
  title,
  description,
  disabled,
}: {
  title: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <span className='flex min-w-0 grow basis-48 flex-col gap-0.5'>
      <span className={cn('text-13', disabled && 'text-muted-foreground')}>{title}</span>
      {description && (
        <span
          className={cn('text-xs', disabled ? 'text-disabled-foreground' : 'text-muted-foreground')}
        >
          {description}
        </span>
      )}
    </span>
  )
}

// Every row: a title, one muted line, and exactly one control, which wraps under the text in a
// column too narrow for both.
export function SettingsRow({
  id,
  title,
  description,
  icon,
  disabled,
  children,
}: {
  id?: string
  title: ReactNode
  description?: ReactNode
  icon?: Icon | ReactElement
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <div
      id={id && `settings-${id}`}
      className={cn(
        'flex flex-wrap items-center gap-y-2 py-3',
        icon ? 'min-h-16 gap-x-3' : 'min-h-15 gap-x-4'
      )}
    >
      {icon && <RowIcon icon={icon} disabled={disabled} />}
      <RowText title={title} description={description} disabled={disabled} />
      {children}
    </div>
  )
}

// A row that opens a page: the whole row is the link, with only a chevron on the right, so it
// never reads as a dropdown.
export function SettingsLinkRow({
  id,
  page,
  hash,
  title,
  description,
  icon,
}: {
  id: string
  page: string
  hash?: string
  title: string
  description: ReactNode
  icon?: Icon | ReactElement
}) {
  return (
    <Link
      id={`settings-${id}`}
      to='/settings/$page'
      params={{ page }}
      hash={hash}
      className={cn(
        'group/link flex items-center py-3 outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        icon ? 'min-h-16 gap-3' : 'min-h-15 gap-4'
      )}
    >
      {icon && <RowIcon icon={icon} />}
      <RowText title={title} description={description} />
      <ArrowRight01Icon className='shrink-0 text-muted-foreground transition-colors group-hover/link:text-foreground' />
    </Link>
  )
}

export function ComingSoon() {
  return <span className='shrink-0 pr-1 text-13 text-muted-foreground'>{comingSoon}</span>
}

// A switch that isn't wired yet: its designed state, dimmed, with the reason on hover.
export function DisabledSwitch({ checked, label }: { checked: boolean; label: string }) {
  return (
    <DisabledTooltip reason={comingSoon} wrap='flex'>
      <Switch checked={checked} disabled aria-label={label} className='pointer-events-none' />
    </DisabledTooltip>
  )
}

export const selectTriggerClass =
  'h-7 gap-1.5 rounded-sm pr-1.5 pl-2.5 text-13 font-normal text-foreground [&_svg]:text-muted-foreground disabled:text-disabled-foreground'

export type SettingsOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode }

// The select trigger (variation A): the value and a chevron, filled only on hover.
export function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: readonly SettingsOption<T>[]
  onChange?: (value: T) => void
  disabled?: boolean
}) {
  const current = options.find((option) => option.value === value)
  const trigger = (
    <DropdownMenuTrigger
      disabled={disabled}
      aria-label={label}
      render={<Button variant='ghost' className={selectTriggerClass} />}
    >
      {current?.icon}
      {current?.label}
      <ArrowDown01Icon />
    </DropdownMenuTrigger>
  )
  return (
    <DropdownMenu modal={false}>
      {disabled ? (
        <DisabledTooltip reason={comingSoon} wrap='flex shrink-0'>
          {trigger}
        </DisabledTooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align='end'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const option = options.find((candidate) => candidate.value === next)
            if (option) onChange?.(option.value)
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.icon}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SettingsSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: readonly SettingsOption<T>[]
  onChange?: (value: T) => void
  disabled?: boolean
}) {
  const group = (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      disabled={disabled}
      spacing={0.5}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next[0])
        if (option) onChange?.(option.value)
      }}
      className='shrink-0 rounded-md bg-foreground/6 p-0.5'
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            'h-6 min-w-0 gap-1.5 rounded-sm pr-2.5 text-xs font-medium text-muted-foreground hover:bg-transparent aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_#00000014,0_0_0_1px_var(--border)] dark:aria-pressed:bg-accent dark:aria-pressed:shadow-none [&_svg]:size-3.5',
            option.icon ? 'pl-2' : 'pl-2.5'
          )}
        >
          {option.icon}
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
  return disabled ? (
    <DisabledTooltip reason={comingSoon} wrap='flex shrink-0'>
      {group}
    </DisabledTooltip>
  ) : (
    group
  )
}

export function SettingsButton(props: ComponentProps<typeof Button>) {
  return (
    <Button
      variant='outline'
      {...props}
      className={cn(
        'h-7 gap-1.5 rounded-sm bg-transparent px-2.5 text-13 shadow-none disabled:text-disabled-foreground disabled:opacity-100 dark:border-border dark:bg-transparent has-[svg]:pl-2',
        props.className
      )}
    />
  )
}
