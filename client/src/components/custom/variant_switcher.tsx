import { Button } from '@/components/ui/button'
import { useStoredState } from '@/lib/stored-state'
import { useLayoutEffect } from 'react'

import './variant_switcher.css'

// The first option is today's; variant_switcher.css applies the others through data-<name> on the root.
const switches: { name: string; options: Record<string, string> }[] = [
  {
    name: 'chat-top',
    options: {
      today: 'Chat top: today, 8-layer blur',
      fade: 'Chat top: eased fade',
      blur: 'Chat top: progressive blur',
      'blur-fade': 'Chat top: progressive blur + fade',
      short: 'Chat top: short blur + fade (cheap)',
      none: 'Chat top: clean cut',
    },
  },
]

function Switch({ name, options }: (typeof switches)[number]) {
  const ids = Object.keys(options)
  const [choice, setChoice] = useStoredState(
    `jetty.variant.${name}`,
    ids[0]!,
    (value): value is string => typeof value === 'string' && ids.includes(value)
  )
  useLayoutEffect(() => {
    document.documentElement.setAttribute(`data-${name}`, choice)
  }, [name, choice])
  return (
    <Button
      variant='outline'
      size='xs'
      className='justify-start bg-background'
      onClick={() => setChoice(ids[(ids.indexOf(choice) + 1) % ids.length]!)}
    >
      {options[choice]}
    </Button>
  )
}

// Temporary: tries the conversation's top edge in place.
export function VariantSwitcher() {
  return (
    <div className='fixed right-3 bottom-64 z-50 flex flex-col items-stretch gap-1'>
      {switches.map((entry) => (
        <Switch key={entry.name} {...entry} />
      ))}
    </div>
  )
}
