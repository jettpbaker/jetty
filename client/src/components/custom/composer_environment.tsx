import { Button } from '@/components/ui/button'
import { DeviceDesktopIcon } from '@primer/octicons-react'

export function ComposerEnvironment(_props: {
  value?: 'local'
  onValueChange?: (value: 'local') => void
}) {
  return (
    <Button variant='ghost-text' size='sm' disabled>
      <DeviceDesktopIcon />
      Local
    </Button>
  )
}
