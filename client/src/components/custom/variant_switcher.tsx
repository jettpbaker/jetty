import type { ReactNode } from 'react'

import { ContextRing } from '@/components/custom/context_ring'
import { GitPullRequestIcon } from '@/components/custom/lucide_icons'
import { Button } from '@/components/ui/button'
import { useStoredState } from '@/lib/stored-state'
import { useLayoutEffect } from 'react'

import './variant_switcher.css'

const sample = { usedTokens: 42, maxTokens: 100, slices: [], asOf: 0 }

// The first option is today's; variant_switcher.css applies the others through data-<name> on the root.
const switches: { name: string; glyph: ReactNode; options: Record<string, string> }[] = [
  {
    name: 'context-ring',
    glyph: <ContextRing context={sample} />,
    options: {
      today: 'Ring: today',
      track: 'Ring: stronger track',
      foreground: 'Ring: foreground progress',
      accent: 'Ring: accent progress',
    },
  },
  {
    name: 'ring-percent',
    glyph: <span className='font-mono'>%</span>,
    options: { off: 'Ring %: off', on: 'Ring %: on' },
  },
  {
    name: 'light-yellow',
    glyph: <GitPullRequestIcon className='text-pr-running' />,
    options: {
      today: 'Light yellow: today oklch(0.68 0.138 90)',
      golden: 'Light yellow: golden oklch(0.73 0.155 83)',
      yellow: 'Light yellow: yellow oklch(0.795 0.184 86)',
      lemon: 'Light yellow: lemon oklch(0.83 0.17 93)',
    },
  },
]

function Switch({ name, glyph, options }: (typeof switches)[number]) {
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
      {glyph}
      {options[choice]}
    </Button>
  )
}

// Temporary: tries the context ring's contrast and the light readiness yellow in place.
export function VariantSwitcher() {
  return (
    <div className='fixed right-3 bottom-64 z-50 flex flex-col items-stretch gap-1'>
      {switches.map((entry) => (
        <Switch key={entry.name} {...entry} />
      ))}
    </div>
  )
}
