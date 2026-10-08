import type { ComponentType } from 'react'

import { SettingsAbout } from '@/components/custom/settings_about'
import { SettingsAccounts } from '@/components/custom/settings_accounts'
import { SettingsAppearance } from '@/components/custom/settings_appearance'
import { SettingsBots } from '@/components/custom/settings_bots'
import {
  SettingsGuidedReviews,
  SettingsIntelligence,
  SettingsPullRequestActivity,
  SettingsThreadTitles,
} from '@/components/custom/settings_intelligence'
import { SettingsKeyboard } from '@/components/custom/settings_keyboard'
import { revealSettingsRow } from '@/components/custom/settings_layout'
import { SettingsModels } from '@/components/custom/settings_models'
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
  'thread-titles': SettingsThreadTitles,
  'guided-reviews': SettingsGuidedReviews,
  'pr-activity': SettingsPullRequestActivity,
  bots: SettingsBots,
  projects: SettingsProjects,
  worktrees: SettingsWorktrees,
  about: SettingsAbout,
}

function SettingsPageRoute() {
  const { page } = Route.useParams()
  const hash = useLocation({ select: (location) => location.hash })
  useEffect(() => {
    if (hash) revealSettingsRow(hash)
  }, [page, hash])
  const Page = pages[page]
  return Page ? (
    <Page />
  ) : (
    <Navigate to='/settings/$page' params={{ page: 'preferences' }} replace />
  )
}
