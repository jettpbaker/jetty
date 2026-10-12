import {
  ExclamationCircleIcon,
  CircleCheckIcon,
  CircleInfoIcon,
  CircleXIcon,
} from '@/components/custom/central_icons'
import { Spinner } from '@/components/ui/spinner'
import { useResolvedTheme } from '@/lib/theme'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster({ ...props }: ToasterProps) {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme}
      className='toaster group'
      icons={{
        success: <CircleCheckIcon className='size-4' />,
        info: <CircleInfoIcon className='size-4' />,
        warning: <ExclamationCircleIcon className='size-4' />,
        error: <CircleXIcon className='size-4' />,
        loading: <Spinner />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
