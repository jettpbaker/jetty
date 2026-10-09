import type { Project } from '@jetty/shared/wire'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { inComposition } from '@/lib/composition'
import { cn } from '@/lib/utils'
import {
  useChrome,
  useCreateProject,
  useDefaultEnvironment,
  useDraft,
  useRenameProject,
} from '@/state'
import { homePath, useSettingsInfo, type SettingsInfo } from '@/state/models'
import { useDeleteProject } from '@/state/mutations'
import { useProjectGit } from '@/state/worktrees'
import { worktreeSetupPrompt } from '@jetty/shared/wire'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { environments } from './composer_environment'
import {
  Delete02Icon,
  FolderGit2Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  ShapesIcon,
  Tick02Icon,
} from './huge_icons'
import { ProjectFolderDialog } from './project_folder_dialog'
import { ProjectIconPicker } from './project_icon_picker'
import {
  PathText,
  SettingsButton,
  SettingsLinkRow,
  SettingsPage,
  SettingsSection,
  cardClass,
} from './settings_layout'

function ProjectName({
  title,
  editing,
  onEditingChange,
  onRename,
}: {
  title: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onRename: (title: string) => void
}) {
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurRef = useRef(false)
  useEffect(() => {
    if (!editing) return
    skipBlurRef.current = false
    setDraft(title)
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [editing, title])
  function cancel() {
    skipBlurRef.current = true
    onEditingChange(false)
  }
  function save() {
    if (skipBlurRef.current) return
    skipBlurRef.current = true
    const next = draft.trim()
    onEditingChange(false)
    if (next && next !== title) onRename(next)
  }
  if (!editing)
    return (
      <button
        type='button'
        className='min-w-0 truncate rounded-sm text-left text-13 outline-none focus-visible:ring-2 focus-visible:ring-ring'
        title={title}
        onClick={() => onEditingChange(true)}
      >
        {title}
      </button>
    )
  return (
    <Input
      ref={inputRef}
      aria-label='Project name'
      value={draft}
      className='-my-1 h-6 px-1.5 text-13 md:text-13'
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (inComposition(event.nativeEvent)) return
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      }}
      onBlur={save}
    />
  )
}

function ProjectRow({
  project,
  info,
  onRemove,
}: {
  project: Project
  info?: SettingsInfo
  onRemove: () => void
}) {
  const git = useProjectGit(project.id)
  const defaultEnvironment = useDefaultEnvironment()
  const renameProject = useRenameProject()
  const navigate = useNavigate()
  const { read, update } = useDraft('')
  const [renaming, setRenaming] = useState(false)
  const [choosingIcon, setChoosingIcon] = useState(false)
  const ok = git?.git === 'ok' ? git : undefined
  const environment = environments[ok?.defaultEnvironment ?? defaultEnvironment]
  // Puts the setup prompt in a new thread's composer, pointed at this project's checkout, where
  // Jetty reads the config from. The same as the new-thread page's Set up worktrees.
  function setUp(guide: string) {
    const prompt = worktreeSetupPrompt(guide)
    const { text, target } = read()
    update({
      text: text.includes(prompt) ? text : text.trim() ? `${text.trimEnd()}\n\n${prompt}` : prompt,
      target: { ...target, projectId: project.id, environment: 'local' },
    })
    void navigate({ to: '/' })
  }
  return (
    <div className='flex min-h-15 items-center gap-4 py-2.5'>
      <div className='flex min-w-0 grow basis-0 items-center gap-3'>
        <ProjectIconPicker
          project={project}
          open={choosingIcon}
          onOpenChange={setChoosingIcon}
          className='size-7 shrink-0 rounded-[7px] bg-foreground/6 not-disabled:hover:bg-foreground/10'
        />
        <div className='flex min-w-0 flex-col gap-0.5'>
          <ProjectName
            title={project.title}
            editing={renaming}
            onEditingChange={setRenaming}
            onRename={(title) => renameProject(project.id, title)}
          />
          <PathText path={info ? homePath(project.path, info) : project.path} />
        </div>
      </div>
      <span className='flex w-34 shrink-0 items-center gap-1.5 text-13 text-muted-foreground @max-md:hidden [&_svg]:size-3.5'>
        {ok && (
          <>
            <environment.Icon />
            {environment.label}
          </>
        )}
      </span>
      <span className='flex w-30 shrink-0 items-center gap-1.5 @max-md:hidden'>
        {!git ? null : !ok ? (
          <span className='text-xs text-muted-foreground'>Not a git repo</span>
        ) : ok.setupGuide ? (
          <Button
            variant='ghost'
            className='-ml-2 h-7 rounded-sm px-2 text-13'
            onClick={() => ok.setupGuide && setUp(ok.setupGuide)}
          >
            Set up
          </Button>
        ) : (
          <>
            <Tick02Icon className='size-3.5 shrink-0 text-status-success' />
            {ok.setupCommand ? (
              <code
                className='truncate font-mono text-xs text-muted-foreground'
                title={ok.setupCommand}
              >
                {ok.setupCommand}
              </code>
            ) : (
              <span className='text-13 text-muted-foreground'>Set up</span>
            )}
          </>
        )}
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={<Button variant='ghost' size='icon' aria-label={`More for ${project.title}`} />}
        >
          <MoreVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <PencilEdit02Icon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChoosingIcon(true)}>
            <ShapesIcon />
            Change icon
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={onRemove}>
            <Delete02Icon />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function SettingsProjects() {
  const chrome = useChrome()
  const projects = chrome?.projects ?? []
  const createProject = useCreateProject()
  const deleteProject = useDeleteProject()
  const info = useSettingsInfo()
  const [adding, setAdding] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  function remove(project: Project) {
    const threads = chrome?.threads.filter((thread) => thread.projectId === project.id).length ?? 0
    const deletion = deleteProject(project.id)
    toast(
      `Removed ${project.title}${threads ? ` and its ${threads === 1 ? 'thread' : `${threads} threads`}` : ''}`,
      {
        action: { label: 'Undo', onClick: deletion.undo },
        onAutoClose: deletion.commit,
        onDismiss: deletion.commit,
      }
    )
  }
  return (
    <SettingsPage
      title='Projects'
      description='The folders Jetty works in, and how each one sets up a worktree.'
    >
      <SettingsSection
        id='projects'
        title={projects.length === 1 ? '1 project' : `${projects.length} projects`}
        action={
          <SettingsButton ref={addButton} onClick={() => setAdding(true)}>
            <PlusSignIcon />
            Add project
          </SettingsButton>
        }
      >
        <div
          id='settings-worktree-setup'
          role='table'
          aria-label='Projects'
          className={cn(cardClass, '@container flex flex-col pr-2 pl-4')}
        >
          <div
            role='row'
            className='flex h-9 shrink-0 items-center gap-4 border-b border-border text-xs text-muted-foreground'
          >
            <span role='columnheader' className='grow'>
              Project
            </span>
            <span role='columnheader' className='w-34 shrink-0 @max-md:hidden'>
              New threads in
            </span>
            <span role='columnheader' className='w-30 shrink-0 @max-md:hidden'>
              Worktree setup
            </span>
            <span className='w-7 shrink-0' />
          </div>
          <div className='flex flex-col divide-y divide-border'>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                info={info}
                onRemove={() => remove(project)}
              />
            ))}
            {!projects.length && (
              <p className='flex min-h-15 items-center text-13 text-muted-foreground'>
                No projects yet.
              </p>
            )}
          </div>
        </div>
      </SettingsSection>
      <div className={cn(cardClass, 'px-4')}>
        <SettingsLinkRow
          id='worktrees-link'
          page='worktrees'
          icon={FolderGit2Icon}
          title='Worktrees'
          description='Where they live, the branch prefix, and which ignored files come along'
        />
      </div>
      <ProjectFolderDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open)
          if (!open) requestAnimationFrame(() => addButton.current?.focus())
        }}
        existingPaths={projects.map((project) => project.path)}
        onAdd={(path) => createProject(path)}
      />
    </SettingsPage>
  )
}
