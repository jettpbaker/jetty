import type { ComponentType } from 'react'

import { SettingsAbout } from '@/components/custom/settings_about'
import { SettingsAccounts } from '@/components/custom/settings_accounts'
import { SettingsAppearance } from '@/components/custom/settings_appearance'
import { SettingsArchived } from '@/components/custom/settings_archived'
import { SettingsBots } from '@/components/custom/settings_bots'
import {
  SettingsGuidedReviews,
  SettingsIntelligence,
  SettingsPullRequestActivity,
} from '@/components/custom/settings_intelligence'
import { SettingsKeyboard } from '@/components/custom/settings_keyboard'
import { revealSettingsRow } from '@/components/custom/settings_layout'
import { SettingsModels } from '@/components/custom/settings_models'
import { defaultSettingsPage, type SettingsPageId } from '@/components/custom/settings_nav'
import { SettingsNotifications } from '@/components/custom/settings_notifications'
import { SettingsPreferences } from '@/components/custom/settings_preferences'
import { SettingsProjects } from '@/components/custom/settings_projects'
import { SettingsWorktrees } from '@/components/custom/settings_worktrees'
import { createFileRoute, Navigate, useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/settings/$page')({ component: SettingsPageRoute })

const pages: Record<string, ComponentType> = {
  preferences: SettingsPreferences,
  appearance: SettingsAppearance,
  keyboard: SettingsKeyboard,
  notifications: SettingsNotifications,
  'connected-accounts': SettingsAccounts,
  models: SettingsModels,
  intelligence: SettingsIntelligence,
  'guided-reviews': SettingsGuidedReviews,
  'pr-activity': SettingsPullRequestActivity,
  bots: SettingsBots,
  projects: SettingsProjects,
  archived: SettingsArchived,
  worktrees: SettingsWorktrees,
  about: SettingsAbout,
} satisfies Record<SettingsPageId, ComponentType>

function SettingsPageRoute() {
  const { page } = Route.useParams()
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (hash) revealSettingsRow(hash)
  }, [page, hash])
  // An inherited name like `constructor` is not a page.
  const Page = Object.hasOwn(pages, page) ? pages[page] : undefined
  return Page ? (
    <Page />
  ) : (
    <Navigate to='/settings/$page' params={{ page: defaultSettingsPage }} replace />
  )
}
