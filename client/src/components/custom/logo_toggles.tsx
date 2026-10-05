import { ProviderGlyph } from '@/components/custom/provider_glyph'
import { Button } from '@/components/ui/button'
import { useStoredState } from '@/lib/stored-state'
import { useLayoutEffect } from 'react'

// The first option is the mark in use today; provider_glyph.css swaps in the others.
const toggles = [
  { provider: 'claude', options: ['Claude Code', 'Claude', 'Anthropic'] },
  { provider: 'codex', options: ['Codex', 'OpenAI'] },
  { provider: 'grok', options: ['Grok', 'xAI'] },
] as const

function LogoToggle({ provider, options }: { provider: string; options: readonly string[] }) {
  const [logo, setLogo] = useStoredState(
    `jetty.logo.${provider}`,
    options[0]!,
    (value): value is string => typeof value === 'string' && options.includes(value)
  )
  useLayoutEffect(() => {
    document.documentElement.setAttribute(`data-${provider}-logo`, logo)
  }, [provider, logo])
  return (
    <Button
      variant='outline'
      size='xs'
      className='justify-start bg-background'
      onClick={() => setLogo(options[(options.indexOf(logo) + 1) % options.length]!)}
    >
      <ProviderGlyph provider={provider} className='size-3.5' />
      {logo} mark
    </Button>
  )
}

// Temporary: tries each provider's alternative marks everywhere at once.
export function LogoToggles() {
  return (
    <div className='fixed right-3 bottom-3 z-50 flex flex-col items-stretch gap-1'>
      {toggles.map((toggle) => (
        <LogoToggle key={toggle.provider} {...toggle} />
      ))}
    </div>
  )
}
