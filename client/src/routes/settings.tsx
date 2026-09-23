import { SettingsView } from '@/components/custom/settings_view'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({ component: SettingsView })
