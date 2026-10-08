import { Sidebar } from '@/components/ui/sidebar'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import { useLocation, useNavigate, useParams, useRouter } from '@tanstack/react-router'
import { useRef, useState, type ReactNode } from 'react'

import { ArrowLeft01Icon, Cancel01Icon, Search01Icon, type Icon } from './huge_icons'
import { searchSettings, settingsGroups, settingsPage } from './settings_nav'

// Where "Back to app" returns: the last page outside Settings.
let appLocation = '/'
export function rememberAppLocation(href: string) {
  appLocation = href
}

const itemClass =
  'flex h-7 w-full shrink-0 items-center gap-2 rounded-sm px-2 text-left text-13 text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground'

function NavItem({
  icon: Glyph,
  current,
  onOpen,
  className,
  children,
}: {
  icon?: Icon
  current?: boolean
  onOpen: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type='button'
      aria-current={current ? 'page' : undefined}
      className={cn(itemClass, !Glyph && 'pl-8', className)}
      {...pressProps(onOpen)}
    >
      {Glyph && <Glyph />}
      {children}
    </button>
  )
}

export function SettingsSidebar() {
  const navigate = useNavigate()
  const router = useRouter()
  const pageId = useParams({ strict: false }).page
  const hash = useLocation({ select: (location) => location.hash })
  const page = pageId ? settingsPage(pageId) : undefined
  const active = page?.parent ?? page?.id
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const results = searchSettings(query)

  function open(id: string, row?: string) {
    void navigate({ to: '/settings/$page', params: { page: id }, hash: row })
  }

  return (
    <Sidebar
      variant='inset'
      collapsible='offcanvas'
      aria-label='Settings sidebar'
      className='p-0'
      data-perf-region='sidebar'
    >
      <div className='flex min-h-0 flex-1 flex-col gap-1 px-2 py-3'>
        <button
          type='button'
          className={cn(itemClass, 'gap-1.5 hover:bg-transparent')}
          {...pressProps(() => router.history.push(appLocation))}
        >
          <ArrowLeft01Icon />
          Back to app
        </button>
        <label className='flex h-7.5 shrink-0 items-center gap-2 rounded-sm bg-foreground/6 px-2 text-muted-foreground focus-within:shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_70%,transparent),0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent)]'>
          <Search01Icon />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              } else if (event.key === 'Enter' && results[0]) {
                event.preventDefault()
                open(results[0].page.id, results[0].rows[0]?.id)
              }
            }}
            placeholder='Search settings'
            aria-label='Search settings'
            className='min-w-0 flex-1 bg-transparent text-13 text-foreground outline-none placeholder:text-muted-foreground'
          />
          {query && (
            <button
              type='button'
              aria-label='Clear search'
              className='flex shrink-0 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5'
              onClick={() => {
                setQuery('')
                input.current?.focus()
              }}
            >
              <Cancel01Icon />
            </button>
          )}
        </label>
        <nav
          aria-label='Settings pages'
          className={cn(
            'no-scrollbar -mx-2 flex min-h-0 flex-col overflow-y-auto px-2 pt-4',
            query ? 'gap-3' : 'gap-4'
          )}
        >
          {query
            ? results.map((result) => (
                <div key={result.page.id} className='flex flex-col gap-px'>
                  <NavItem
                    icon={result.page.icon}
                    onOpen={() => open(result.page.id)}
                    current={active === result.page.id && !hash}
                    className={cn(
                      'text-foreground',
                      active !== result.page.id && '[&>svg]:text-muted-foreground'
                    )}
                  >
                    {result.page.title}
                  </NavItem>
                  {result.rows.map((row) => (
                    <NavItem
                      key={row.id}
                      current={active === result.page.id && hash === row.id}
                      onOpen={() => open(result.page.id, row.id)}
                    >
                      <span className='truncate'>{row.title}</span>
                      {row.hint && (
                        <span className='truncate text-xs text-disabled-foreground'>
                          {row.hint}
                        </span>
                      )}
                    </NavItem>
                  ))}
                </div>
              ))
            : settingsGroups.map((group) => (
                <div key={group.label} className='flex flex-col gap-px'>
                  <h2 className='flex h-6 shrink-0 items-center px-2 text-xs font-medium text-muted-foreground'>
                    {group.label}
                  </h2>
                  {group.pages.map((entry) => (
                    <NavItem
                      key={entry.id}
                      icon={entry.icon}
                      current={active === entry.id}
                      onOpen={() => open(entry.id)}
                    >
                      {entry.title}
                    </NavItem>
                  ))}
                </div>
              ))}
          {query && !results.length && (
            <p className='px-2 text-13 text-muted-foreground'>No settings found.</p>
          )}
        </nav>
      </div>
    </Sidebar>
  )
}
