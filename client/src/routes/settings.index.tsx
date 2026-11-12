import { defaultSettingsPage } from '@/components/custom/settings_nav'
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/$page', params: { page: defaultSettingsPage }, replace: true })
  },
})
