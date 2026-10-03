import { RefreshIcon, UserAdd01Icon } from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { usePrefetchReviewerCandidates, useReviewerCandidates } from '@/state'
import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react'

import type { GitHubUser } from './pull_request_model'

import { DisabledTooltip } from './disabled_tooltip'
import { PersonAvatar } from './person_avatar'
import './option_picker.css'

type Person = GitHubUser & { name?: string }

export function ReviewerPicker({
  repo,
  author,
  requested,
  suggested,
  disabledReason,
  trigger,
  current,
  onToggle,
}: {
  repo: string
  author: string
  requested: readonly GitHubUser[]
  suggested: readonly GitHubUser[]
  trigger?: ReactElement
  current?: readonly { user: GitHubUser; label: string; word: string; team?: boolean }[]
  disabledReason?: string
  onToggle: (user: GitHubUser, requested: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const prefetch = usePrefetchReviewerCandidates()

  if (disabledReason)
    return (
      <DisabledTooltip reason={disabledReason} wrap='flex'>
        {trigger ? (
          cloneElement(trigger as ReactElement<{ disabled?: boolean }>, { disabled: true })
        ) : (
          <Button
            variant='ghost'
            tone='muted'
            size='icon'
            className='h-7'
            aria-label='Request review'
            disabled
          >
            <UserAdd01Icon />
          </Button>
        )}
      </DisabledTooltip>
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label='Request review'
        onPointerEnter={() => prefetch(repo)}
        onFocus={() => prefetch(repo)}
        render={trigger ?? <Button variant='ghost' tone='muted' size='icon' className='h-7' />}
      >
        {trigger ? undefined : <UserAdd01Icon />}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='search-picker w-64 max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-sm p-0 ring-border data-open:fade-in-60 data-closed:animate-none'
      >
        <PopoverTitle className='sr-only'>Request review</PopoverTitle>
        <ReviewerResults
          repo={repo}
          author={author}
          requested={requested}
          suggested={suggested}
          onToggle={onToggle}
          current={current}
        />
      </PopoverContent>
    </Popover>
  )
}

function matches(person: Person, search: string) {
  return (
    person.login.toLowerCase().includes(search) || !!person.name?.toLowerCase().includes(search)
  )
}

function ReviewerResults({
  repo,
  author,
  requested,
  suggested,
  onToggle,
  current,
}: {
  repo: string
  author: string
  requested: readonly GitHubUser[]
  suggested: readonly GitHubUser[]
  current?: readonly { user: GitHubUser; label: string; word: string; team?: boolean }[]
  onToggle: (user: GitHubUser, requested: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [activeOption, setActiveOption] = useState('')
  const pointerSelection = useRef(false)
  const search = query.trim().toLowerCase()
  const everyone = useReviewerCandidates(repo, '')
  const truncated = everyone.list?.truncated === true
  // Only a list GitHub cut short needs asking again; the rest filters locally as you type.
  const [serverSearch, setServerSearch] = useState('')
  useEffect(() => {
    if (!truncated) return
    const timer = setTimeout(() => setServerSearch(search), 200)
    return () => clearTimeout(timer)
  }, [search, truncated])
  const searched = useReviewerCandidates(repo, truncated ? serverSearch : '')

  const listed = new Set(current?.map(({ user }) => user.login))
  const reviewing = (current ?? []).filter(
    ({ user, label }) => matches(user, search) || label.toLowerCase().includes(search)
  )
  const people = new Map<string, Person>()
  for (const person of [
    ...requested,
    ...suggested,
    ...(everyone.list?.candidates ?? []),
    ...(searched.list?.candidates ?? []),
  ])
    if (person.login !== author && !listed.has(person.login) && !people.has(person.login))
      people.set(person.login, person)
  const requestedLogins = new Set(requested.map((user) => user.login))
  const suggestedLogins = new Set(suggested.map((user) => user.login))
  const results = [...people.values()].filter((person) => matches(person, search))
  const groups = [
    { heading: undefined, people: results.filter((p) => requestedLogins.has(p.login)) },
    {
      heading: 'Suggested',
      people: results.filter((p) => !requestedLogins.has(p.login) && suggestedLogins.has(p.login)),
    },
    {
      heading: 'Everyone',
      people: results.filter((p) => !requestedLogins.has(p.login) && !suggestedLogins.has(p.login)),
    },
  ].filter((group) => group.people.length > 0)
  const labelled = !!current || groups.some((group) => group.heading === 'Suggested')
  const loading = !everyone.list && !everyone.failed

  return (
    <Command
      shouldFilter={false}
      value={activeOption}
      onValueChange={setActiveOption}
      onPointerMove={() => {
        pointerSelection.current = true
      }}
      onKeyDown={() => {
        pointerSelection.current = false
      }}
      onPointerLeave={() => {
        if (pointerSelection.current) setActiveOption('')
      }}
    >
      <CommandInput
        placeholder='Search people'
        aria-label='Search people'
        value={query}
        onValueChange={setQuery}
      />
      <Separator />
      <CommandList>
        <div className='picker-results'>
          {!!reviewing.length && (
            <CommandGroup heading='Reviewers'>
              {reviewing.map(({ user, label, word, team }) => (
                <CommandItem
                  key={user.login}
                  value={`reviewer:${user.login}`}
                  onSelect={() => onToggle(user, true)}
                >
                  <PersonAvatar
                    login={label}
                    src={user.avatar_url || undefined}
                    className={
                      team
                        ? 'size-4 shrink-0 rounded-menu-item [&>*]:rounded-menu-item'
                        : 'size-4 shrink-0'
                    }
                  />
                  <span className='truncate'>{label}</span>
                  {/* The trailing slot: CommandItem hides its own check when one is present. */}
                  <span
                    data-slot='command-shortcut'
                    className='ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground'
                  >
                    {word}
                    <RefreshIcon aria-label='Re-request review' />
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {groups.map((group) => (
            <CommandGroup key={group.heading ?? 'requested'} heading={labelled && group.heading}>
              {group.people.map((person) => {
                const isRequested = requestedLogins.has(person.login)
                return (
                  <CommandItem
                    key={person.login}
                    value={`person:${person.login}`}
                    data-checked={isRequested}
                    onSelect={() => onToggle(person, !isRequested)}
                  >
                    <PersonAvatar
                      login={person.login}
                      src={person.avatar_url}
                      className='size-4 shrink-0'
                    />
                    <span className='truncate'>{person.login}</span>
                    {person.name && (
                      <span className='min-w-0 truncate text-muted-foreground'>{person.name}</span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
          {groups.length === 0 && !reviewing.length && (
            <p className='px-3 py-2 text-xs text-muted-foreground'>
              {loading
                ? 'Loading…'
                : everyone.failed
                  ? "Couldn't load people"
                  : search
                    ? 'No matches'
                    : 'No one to request'}
            </p>
          )}
        </div>
      </CommandList>
    </Command>
  )
}
