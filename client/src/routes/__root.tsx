import { CommandPaletteProvider } from '@/components/command-palette'
import { DiffPanel } from '@/components/diff-panel'
import { TabBar } from '@/components/tab-bar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IconContext } from '@phosphor-icons/react'
import { createRootRoute, Outlet, useParams } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createRootRoute({
  component: RootLayout,
})

const iconDefaults = {
  color: 'currentColor',
  size: '1em',
  weight: 'bold' as const,
  mirrored: false,
}

// react-resizable-panels v4 dropped autoSaveId; persist via defaultLayout + onLayoutChanged.
const DIFF_LAYOUT_KEY = 'jet-diff-panel'

function loadDiffLayout(): Record<string, number> | undefined {
  try {
    const raw = localStorage.getItem(DIFF_LAYOUT_KEY)
    if (!raw) return undefined
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return undefined
  }
}

function RootLayout() {
  const [diffOpen, setDiffOpen] = useState(false)
  const { threadId } = useParams({ strict: false })
  const [defaultLayout] = useState(loadDiffLayout)

  return (
    <IconContext.Provider value={iconDefaults}>
      <TooltipProvider>
        <CommandPaletteProvider>
          {/* the main panel stays mounted whether or not the diff panel exists,
              so toggling it never remounts the tab bar or route content */}
          {/* the sized wrapper exists because the group's own h-full resolves
              against the auto-height body and collapses to content height */}
          <div className='h-svh'>
            <ResizablePanelGroup
              orientation='horizontal'
              id={DIFF_LAYOUT_KEY}
              defaultLayout={defaultLayout}
              onLayoutChanged={(layout, meta) => {
                // only real drags persist — mount/toggle recomputes would
                // otherwise overwrite the saved split with a one-panel layout
                if (!meta.isUserInteraction) return
                try {
                  localStorage.setItem(DIFF_LAYOUT_KEY, JSON.stringify(layout))
                } catch {
                  // storage unavailable — size stays session-local
                }
              }}
            >
              <ResizablePanel id='thread-main' defaultSize='70' minSize='40'>
                <div className='flex h-full min-h-0 flex-col'>
                  <TabBar diffOpen={diffOpen} onOpenDiff={() => setDiffOpen(true)} />
                  <main className='min-h-0 flex-1 overflow-hidden'>
                    <Outlet />
                  </main>
                </div>
              </ResizablePanel>
              {diffOpen && threadId !== undefined && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id='thread-diff' defaultSize='30' minSize='20' maxSize='60'>
                    <DiffPanel
                      key={threadId}
                      threadId={threadId}
                      onClose={() => setDiffOpen(false)}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
          <Toaster />
        </CommandPaletteProvider>
      </TooltipProvider>
    </IconContext.Provider>
  )
}
