import { SidebarTrigger } from '@/components/ui/sidebar'
import { historyBackWithFallback } from '@/lib/history-back'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function SettingsPage() {
  const router = useRouter()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return
      historyBackWithFallback(router)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [router])
  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center gap-1 border-b px-2'>
        <SidebarTrigger />
      </header>
      <div className='p-6'>
        <h1 className='font-semibold text-2xl'>Settings</h1>
      </div>
    </div>
  )
}
