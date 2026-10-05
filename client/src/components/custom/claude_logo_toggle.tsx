import { ProviderGlyph } from '@/components/custom/provider_glyph'
import { Button } from '@/components/ui/button'
import { useStoredState } from '@/lib/stored-state'
import { useLayoutEffect } from 'react'

type ClaudeLogo = 'code' | 'ai' | 'anthropic'

function isClaudeLogo(value: unknown): value is ClaudeLogo {
  return value === 'code' || value === 'ai' || value === 'anthropic'
}

const logos: { value: ClaudeLogo; label: string }[] = [
  { value: 'code', label: 'Claude Code mark' },
  { value: 'ai', label: 'Claude mark' },
  { value: 'anthropic', label: 'Anthropic mark' },
]

// Temporary: cycles Claude's logo between the Claude Code, Claude and Anthropic marks everywhere at once.
export function ClaudeLogoToggle() {
  const [logo, setLogo] = useStoredState<ClaudeLogo>('jetty.claudeLogo', 'code', isClaudeLogo)
  useLayoutEffect(() => {
    document.documentElement.dataset.claudeLogo = logo
  }, [logo])
  return (
    <Button
      variant='outline'
      size='xs'
      className='fixed right-3 bottom-3 z-50 bg-background'
      onClick={() => {
        const index = logos.findIndex((option) => option.value === logo)
        setLogo(logos[(index + 1) % logos.length]!.value)
      }}
    >
      <ProviderGlyph provider='claude' className='size-3.5' />
      {logos.find((option) => option.value === logo)?.label}
    </Button>
  )
}
