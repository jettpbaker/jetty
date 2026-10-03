import { Command, CommandInput } from '@/components/ui/command'
import { Separator } from '@/components/ui/separator'

export function DiffFileFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className='shrink-0 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group]]:h-7! [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none! [&_[data-slot=input-group-addon]]:pl-2.5! [&_svg]:size-3!'>
      <Command shouldFilter={false} className='rounded-none! bg-transparent p-0'>
        <CommandInput
          aria-label='Filter files'
          placeholder='Filter files…'
          value={value}
          onValueChange={onChange}
          className='pl-2 text-xs'
        />
      </Command>
      <Separator />
    </div>
  )
}
