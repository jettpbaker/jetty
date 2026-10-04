import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  CancelCircleIcon,
} from '@/components/custom/huge_icons'
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
        success: <CheckmarkCircle02Icon className='size-4' />,
        info: <InformationCircleIcon className='size-4' />,
        warning: <Alert02Icon className='size-4' />,
        error: <CancelCircleIcon className='size-4' />,
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
