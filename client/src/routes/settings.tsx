import { SidebarTrigger } from '@/components/ui/sidebar'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center border-b px-2'>
        <SidebarTrigger />
      </header>
      <div className='p-6'>
        <h1 className='font-semibold text-2xl'>Settings</h1>
      </div>
    </div>
  )
}
