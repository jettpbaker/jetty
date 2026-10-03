import { Spinner } from '@/components/ui/spinner'

// What a diff or file view shows while its viewer or highlighter loads: the spinner at once, fading in.
export function DiffLoading({ label = 'Loading changes' }: { label?: string }) {
  return (
    <div className='flex h-full min-h-24 items-center justify-center gap-2 p-4 text-xs text-muted-foreground animate-in fade-in-0 duration-150'>
      <Spinner className='size-3.5' />
      {label}
    </div>
  )
}
