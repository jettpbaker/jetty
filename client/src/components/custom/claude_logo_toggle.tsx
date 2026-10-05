import { ProviderGlyph } from '@/components/custom/provider_glyph'
import { Button } from '@/components/ui/button'
import { useStoredState } from '@/lib/stored-state'
import { useLayoutEffect } from 'react'

type ClaudeLogo = 'code' | 'ai'

function isClaudeLogo(value: unknown): value is ClaudeLogo {
  return value === 'code' || value === 'ai'
}

// Temporary: compares the Claude Code mark with the usual Claude mark everywhere at once.
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
      onClick={() => setLogo(logo === 'code' ? 'ai' : 'code')}
    >
      <ProviderGlyph provider='claude' className='size-3.5' />
      {logo === 'code' ? 'Claude Code mark' : 'Claude mark'}
    </Button>
  )
}
