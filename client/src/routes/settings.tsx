import { Button } from '@/components/ui/button'
import { historyBackWithFallback } from '@/lib/history-back'
import { pressHandlers } from '@/lib/press-handlers'
import { ArrowLeftIcon } from '@phosphor-icons/react'
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
      <div className='p-6'>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Back'
          className='-ml-2 mb-2'
          {...pressHandlers(() => historyBackWithFallback(router))}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className='font-semibold text-2xl'>Settings</h1>
      </div>
    </div>
  )
}
