import type { Icon } from './huge_icons'

import {
  DashboardSquare01Icon,
  Folder01Icon,
  FolderGit2Icon,
  InformationCircleIcon,
  KeyboardIcon,
  Notification01Icon,
  PaintBrush01Icon,
  Plug01Icon,
  Robot01Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from './huge_icons'

export type SettingsPage = {
  id: string
  title: string
  icon: Icon
  // A sub-page lives under its parent in the nav, with a link back to it.
  parent?: string
}

export const settingsGroups: { label: string; pages: SettingsPage[] }[] = [
  {
    label: 'General',
    pages: [
      { id: 'preferences', title: 'Preferences', icon: SlidersHorizontalIcon },
      { id: 'appearance', title: 'Appearance', icon: PaintBrush01Icon },
      { id: 'keyboard', title: 'Keyboard', icon: KeyboardIcon },
      { id: 'notifications', title: 'Notifications', icon: Notification01Icon },
    ],
  },
  {
    label: 'Agents',
    pages: [
      { id: 'connected-accounts', title: 'Connected accounts', icon: Plug01Icon },
      { id: 'models', title: 'Models', icon: DashboardSquare01Icon },
      { id: 'intelligence', title: 'Intelligence', icon: SparklesIcon },
      { id: 'bots', title: 'Bots', icon: Robot01Icon },
    ],
  },
  {
    label: 'Workspace',
    pages: [
      { id: 'projects', title: 'Projects', icon: Folder01Icon },
      { id: 'worktrees', title: 'Worktrees', icon: FolderGit2Icon },
    ],
  },
  { label: 'Jetty', pages: [{ id: 'about', title: 'About', icon: InformationCircleIcon }] },
]

const subPages: SettingsPage[] = [
  { id: 'thread-titles', title: 'Thread titles', icon: SparklesIcon, parent: 'intelligence' },
  { id: 'guided-reviews', title: 'Guided reviews', icon: SparklesIcon, parent: 'intelligence' },
  { id: 'pr-activity', title: 'Wake on PR activity', icon: SparklesIcon, parent: 'intelligence' },
  { id: 'bot-tidying', title: 'Bot tidying', icon: SparklesIcon, parent: 'intelligence' },
]

export const settingsPages = [...settingsGroups.flatMap((group) => group.pages), ...subPages]

export function settingsPage(id: string) {
  return settingsPages.find((page) => page.id === id)
}

// What search finds: each row by its title, and by the words someone might look for it under.
// A row found by one of those shows it beside the title, or its `hint` when it has one.
type SettingsRow = { page: string; id: string; title: string; keywords?: string; hint?: string }

export const settingsRows: SettingsRow[] = [
  { page: 'preferences', id: 'open-on-launch', title: 'Open on launch', keywords: 'startup' },
  { page: 'preferences', id: 'send-key', title: 'Send messages with', keywords: 'Enter keys' },
  {
    page: 'preferences',
    id: 'environment',
    title: 'Environment',
    keywords: 'Worktree, Current checkout, new threads',
  },
  { page: 'preferences', id: 'access', title: 'Access', keywords: 'Auto, Full access, approvals' },
  { page: 'preferences', id: 'pointer-cursors', title: 'Use pointer cursors', keywords: 'hand' },
  { page: 'appearance', id: 'theme', title: 'Theme', keywords: 'Dark, Light, OLED, System' },
  { page: 'appearance', id: 'accent', title: 'Accent', keywords: 'colour, color' },
  { page: 'appearance', id: 'wallpaper-image', title: 'Wallpaper image', keywords: 'crop' },
  { page: 'appearance', id: 'wallpaper-video', title: 'Wallpaper video' },
  { page: 'appearance', id: 'match-accent', title: 'Match accent to wallpaper' },
  { page: 'appearance', id: 'tint', title: 'Tint app to wallpaper' },
  { page: 'keyboard', id: 'shortcuts', title: 'Shortcuts', keywords: 'keybinds, hotkeys' },
  { page: 'notifications', id: 'browser-notifications', title: 'Browser notifications' },
  { page: 'connected-accounts', id: 'claude', title: 'Claude Code', keywords: 'sign in' },
  { page: 'connected-accounts', id: 'codex', title: 'Codex', keywords: 'sign in' },
  { page: 'connected-accounts', id: 'grok', title: 'Grok Build', keywords: 'sign in' },
  { page: 'connected-accounts', id: 'copilot', title: 'GitHub Copilot' },
  { page: 'connected-accounts', id: 'github', title: 'GitHub', keywords: 'gh, pull requests' },
  { page: 'models', id: 'loadout', title: 'Loadout', keywords: 'slots, effort, Fast' },
  { page: 'models', id: 'available-models', title: 'Available models', keywords: 'refresh' },
  {
    page: 'intelligence',
    id: 'thread-titles',
    title: 'Thread titles',
    keywords: 'branch, worktree',
    hint: 'names branches',
  },
  { page: 'intelligence', id: 'guided-reviews', title: 'Guided reviews', keywords: 'Guide tab' },
  { page: 'intelligence', id: 'digest', title: 'Digest', keywords: 'recap, catch up' },
  {
    page: 'intelligence',
    id: 'pr-activity',
    title: 'Wake on PR activity',
    keywords: 'reviews, failing checks, merge conflicts, merge when ready',
  },
  { page: 'intelligence', id: 'archive', title: 'Archive finished threads' },
  { page: 'intelligence', id: 'check-ins', title: 'Bot check-ins' },
  {
    page: 'bot-tidying',
    id: 'tidy-model',
    title: 'Bot tidying',
    keywords: 'compaction, notes, wiki',
  },
  { page: 'bots', id: 'your-bots', title: 'Your bots', keywords: 'New bot' },
  { page: 'bots', id: 'shared-preferences', title: 'Shared preferences' },
  { page: 'bots', id: 'rhythm', title: 'Rhythm', keywords: 'check-ins' },
  { page: 'projects', id: 'projects', title: 'Projects', keywords: 'Add project, rename, icon' },
  { page: 'projects', id: 'worktree-setup', title: 'Worktree setup', keywords: 'worktree.json' },
  { page: 'worktrees', id: 'location', title: 'Location', keywords: 'folder' },
  { page: 'worktrees', id: 'branch-prefix', title: 'Branch prefix', keywords: 'branch' },
  {
    page: 'worktrees',
    id: 'copied-files',
    title: 'Copied files',
    keywords: '.worktreeinclude, .env',
  },
  {
    page: 'worktrees',
    id: 'scripts',
    title: 'Setup and archive scripts',
    keywords: 'worktree.json',
  },
  { page: 'about', id: 'home', title: 'Jetty home', keywords: 'JETTY_HOME, data' },
  { page: 'about', id: 'database', title: 'Database', keywords: 'storage, size' },
  { page: 'about', id: 'logs', title: 'Logs' },
]

export type SettingsResult = {
  page: SettingsPage
  rows: { id: string; title: string; hint?: string }[]
}

// A page whose title matches comes first with all its rows; then, in nav order, the pages with
// matching rows, each row with the word that found it when its title doesn't say. Sub-pages are
// found through their row on the parent page.
export function searchSettings(query: string): SettingsResult[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const named: SettingsResult[] = []
  const others: SettingsResult[] = []
  for (const page of settingsGroups.flatMap((group) => group.pages)) {
    const pageRows = settingsRows.filter((row) => row.page === page.id)
    if (page.title.toLowerCase().includes(needle)) {
      named.push({ page, rows: pageRows.map(({ id, title }) => ({ id, title })) })
      continue
    }
    const rows = pageRows.flatMap((row) => {
      if (row.title.toLowerCase().includes(needle)) return [{ id: row.id, title: row.title }]
      const hint = row.keywords
        ?.split(', ')
        .find((keyword) => keyword.toLowerCase().includes(needle))
      return hint ? [{ id: row.id, title: row.title, hint: row.hint ?? hint }] : []
    })
    if (rows.length) others.push({ page, rows })
  }
  return [...named, ...others]
}
