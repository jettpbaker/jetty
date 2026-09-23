import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { CornersOutIcon } from '@phosphor-icons/react'
import { useContext, useEffect, useRef, useState, type ComponentProps } from 'react'
import {
  StreamdownContext,
  TableCopyDropdown,
  TableDownloadDropdown,
  type ExtraProps,
} from 'streamdown'

const maxHeight = 300

// Streamdown's table with its fullscreen view moved onto our Dialog, which traps focus,
// hides the page behind it from assistive tech, and hands focus back on close.
export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<'table'> & ExtraProps) {
  const { isAnimating } = useContext(StreamdownContext)
  const [fullscreen, setFullscreen] = useState(false)
  const scroller = useStickToBottom(isAnimating, children)

  return (
    <div
      className='my-4 flex flex-col gap-2 rounded-lg border border-border bg-sidebar p-2'
      data-streamdown='table-wrapper'
    >
      <div className='flex items-center justify-end gap-1'>
        <TableCopyDropdown />
        <TableDownloadDropdown />
        <button
          type='button'
          className='cursor-pointer p-1 text-muted-foreground transition-all hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
          disabled={isAnimating}
          title='View fullscreen'
          aria-label='View fullscreen'
          onClick={() => setFullscreen(true)}
        >
          <CornersOutIcon size={14} />
        </button>
      </div>
      <div
        ref={scroller}
        className='border-collapse overflow-x-auto overflow-y-auto rounded-md border border-border bg-background'
        style={{ maxHeight }}
      >
        <table
          className={cn('w-full divide-y divide-border', className)}
          data-streamdown='table'
          {...props}
        >
          {children}
        </table>
      </div>
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className='inset-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100'>
          <DialogTitle className='sr-only'>Table</DialogTitle>
          <div className='flex h-full min-h-0 flex-col' data-streamdown='table-wrapper'>
            <div className='flex items-center justify-end gap-1 p-4 pr-14'>
              <TableCopyDropdown />
              <TableDownloadDropdown />
            </div>
            <div className='flex-1 overflow-auto p-4 pt-0 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10'>
              <table
                className='w-full border-collapse border border-border'
                data-streamdown='table'
              >
                {children}
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// While the table streams in, keep its capped scroller pinned to the newest row unless
// the reader has scrolled up.
function useStickToBottom(streaming: boolean, content: unknown) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    function onScroll() {
      pinned.current = element!.scrollHeight - element!.scrollTop - element!.clientHeight < 8
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!streaming) pinned.current = true
    else if (pinned.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [streaming, content])

  return scroller
}
