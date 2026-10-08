import { inComposition } from '@/lib/composition'
import { useChrome } from '@/state'
import { homePath, useSettingsInfo } from '@/state/models'
import { useProjectsGit, useSetBranchPrefix } from '@/state/worktrees'
import { useState } from 'react'

import { DisabledTooltip } from './disabled_tooltip'
import {
  Mono,
  PathText,
  SettingsButton,
  SettingsCard,
  SettingsLinkRow,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  comingSoon,
} from './settings_layout'

// No Save button: the prefix saves when the field is left or Enter is pressed.
function BranchPrefix() {
  const prefix = useChrome()?.branchPrefix ?? 'jetty'
  const save = useSetBranchPrefix()
  const [draft, setDraft] = useState<string>()
  function commit() {
    if (draft === undefined) return
    if (draft === prefix || !draft.trim()) setDraft(undefined)
    else save(draft, () => setDraft(undefined))
  }
  return (
    <label className='flex h-7 w-50 shrink-0 cursor-text items-center overflow-hidden rounded-sm border border-input bg-input/30 px-2 font-mono text-xs focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20'>
      <input
        aria-label='Branch prefix'
        value={draft ?? prefix}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (inComposition(event.nativeEvent)) return
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(undefined)
          }
        }}
        className='max-w-full min-w-px bg-transparent outline-none [field-sizing:content]'
      />
      <span aria-hidden='true' className='truncate text-disabled-foreground'>
        /fix-guide-voice
      </span>
    </label>
  )
}

export function SettingsWorktrees() {
  const info = useSettingsInfo()
  const projects = useChrome()?.projects ?? []
  const setUp = useProjectsGit(projects.map((project) => project.id)).filter(
    (git) => git?.git === 'ok' && !git.setupGuide
  ).length
  return (
    <SettingsPage
      title='Worktrees'
      description='Each thread can get its own checkout, so agents never trip over each other.'
    >
      <SettingsSection title='Location'>
        <SettingsCard>
          <SettingsRow
            id='location'
            title='Folder'
            description='One per thread. It keeps its name when a title renames the branch.'
          >
            <span className='flex max-w-1/2 min-w-0 items-center gap-3'>
              {info && <PathText path={homePath(`${info.home}/worktrees`, info)} />}
              <DisabledTooltip reason={comingSoon} wrap='flex'>
                <SettingsButton disabled className='pointer-events-none'>
                  Reveal
                </SettingsButton>
              </DisabledTooltip>
            </span>
          </SettingsRow>
          <SettingsRow
            id='branch-prefix'
            title='Branch prefix'
            description='Starts the name of each new branch. Saves when you leave the field.'
          >
            <BranchPrefix />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title='Setup'
        description="Read from each project's checkout, never from the worktree, which agents can edit."
      >
        <SettingsCard>
          <SettingsRow
            id='copied-files'
            title='Copied files'
            description={
              <>
                Uses <Mono>.worktreeinclude</Mono> if there is one, else ignored <Mono>.env*</Mono>{' '}
                files
              </>
            }
          >
            <span className='shrink-0 text-13 text-muted-foreground'>
              Ignored <Mono>.env*</Mono> files
            </span>
          </SettingsRow>
          <SettingsLinkRow
            id='scripts'
            page='projects'
            hash='worktree-setup'
            title='Setup and archive scripts'
            description={
              <>
                Each project&apos;s <Mono>.jetty/worktree.json</Mono>
              </>
            }
            value={`${setUp} of ${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
