import { useResolvedTheme } from '@/lib/theme'
import { AlertIcon, CheckCircleIcon, InfoIcon, SyncIcon, XCircleIcon } from '@primer/octicons-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster({ ...props }: ToasterProps) {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme}
      className='toaster group'
      icons={{
        success: <CheckCircleIcon className='size-4' />,
        info: <InfoIcon className='size-4' />,
        warning: <AlertIcon className='size-4' />,
        error: <XCircleIcon className='size-4' />,
        loading: <SyncIcon className='size-4 animate-spin' />,
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
