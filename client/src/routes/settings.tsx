import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { pressHandlers } from '@/lib/press-handlers'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const navigate = useNavigate()
  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center gap-1 border-b px-2'>
        <SidebarTrigger />
        <Button variant='ghost' size='sm' {...pressHandlers(() => void navigate({ to: '/' }))}>
          <ArrowLeftIcon />
          Back
        </Button>
      </header>
      <div className='p-6'>
        <h1 className='font-semibold text-2xl'>Settings</h1>
      </div>
    </div>
  )
}
