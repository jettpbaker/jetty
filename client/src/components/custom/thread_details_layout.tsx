import {
  ArrowShrink02Icon,
  ArrowExpand01Icon,
  SidebarLeftIcon,
} from '@/components/custom/huge_icons'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { pressProps } from '@/lib/press'
import { threadBranch } from '@/lib/thread_worktree'
import {
  defaultDiffScope,
  pullRequestTabId,
  readFileDraft,
  useDetailsRequest,
  useFileDirty,
  usePullRequestTabs,
  useThreadMeta,
  useThreadPullRequests,
} from '@/state'
import { useProjectGit } from '@/state/worktrees'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { ChildThreadList, useChildThreads } from './child_threads'
import { OpenFileLink, projectRelativePath, type FileTarget } from './file_link'
import { inDialog, KeybindTooltip, keybinds } from './keybinds'
import { Loading } from './loading'
import { PageSidebarTrigger } from './page_sidebar_trigger'
import { LivePullRequestView } from './pull_request_view'
import { ThreadChanges, useThreadChangesPrefetch } from './thread_changes'
import { ThreadDetailsTabs, type DetailsTabsHandle } from './thread_details_tabs'
import { ThreadFile } from './thread_file'
import { ThreadFiles } from './thread_files'
import { ThreadOverview, useHasOverview } from './thread_overview'
import './thread_details_layout.css'

const minWidth = 320
const narrowWidth = 760

type ThreadFileTarget = { threadId: string; target: FileTarget }

export function ThreadDetailsLayout({
  threadId,
  projectPath,
  children,
}: {
  threadId: string
  projectPath?: string
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number; next: number } | null>(null)
  const chatHost = useRef<HTMLDivElement>(null)
  if (!chatHost.current) {
    chatHost.current = document.createElement('div')
    chatHost.current.className = 'flex h-full min-h-0 min-w-0 flex-col'
  }
  const [leftSlot, setLeftSlot] = useState<HTMLDivElement | null>(null)
  // The chat starts here, attached before its own layout effects run (they run before this
  // component's), so on its first commit it measures a connected scroller, not a detached one.
  const attachLeftSlot = useCallback((slot: HTMLDivElement | null) => {
    if (slot && !chatHost.current!.parentNode) slot.appendChild(chatHost.current!)
    setLeftSlot(slot)
  }, [])
  const [chatSlot, setChatSlot] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  // The pane paints at the click and its heavy tabs mount a frame later, so a slow diff never holds it back.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!open) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      setReady(false)
    }
  }, [open])
  const [available, setAvailable] = useState(0)
  const [preferredWidth, setPreferredWidth] = useState<number>()
  const [expanded, setExpanded] = useState(false)
  const [pickedTab, setTab] = useState('changes')
  const meta = useThreadMeta(threadId)
  const git = useProjectGit(meta?.projectId)?.git
  const gitDisabled =
    git === 'not-git'
      ? 'Not a git repository'
      : git === 'missing'
        ? 'Project folder not found'
        : undefined
  // Changes and Files need git, so those projects open on Overview.
  const tab =
    gitDisabled && (pickedTab === 'changes' || pickedTab === 'files') ? 'overview' : pickedTab
  // An open pane has Changes mounted already.
  useThreadChangesPrefetch(
    threadId,
    meta && !open && !gitDisabled ? defaultDiffScope(meta) : undefined,
    meta?.turnEndedAt
  )
  const tabs = useRef<DetailsTabsHandle>(null)
  // A file link goes to Changes first, and on to its own tab if it isn't a changed file.
  const [fileRequest, setFileRequest] = useState<ThreadFileTarget>()
  const [fileView, setFileView] = useState<ThreadFileTarget>()
  const requestedFile = fileRequest?.threadId === threadId ? fileRequest.target : undefined
  const viewedFile = fileView?.threadId === threadId ? fileView.target : undefined
  const fileDirty = useFileDirty(threadId, viewedFile?.path ?? '')
  const checkout = useMemo(
    () => ({
      environment: meta?.environment,
      branch: meta && threadBranch(meta),
      path: meta?.workingPath ?? projectPath,
    }),
    [meta, projectPath]
  )
  // A file's unsaved edits outlive its tab as a draft; letting go of the tab says where they went.
  const fileViewNow = useRef(fileView)
  fileViewNow.current = fileView
  const showFile = useCallback((next: ThreadFileTarget | undefined) => {
    const left = fileViewNow.current
    setFileView(next)
    if (
      !left ||
      left.threadId !== (next?.threadId ?? left.threadId) ||
      left.target.path === next?.target.path ||
      !readFileDraft(left.threadId, left.target.path)
    )
      return
    toast(`Unsaved changes to ${left.target.path.split('/').at(-1)} kept`, {
      description: 'They come back when you open it again.',
      action: {
        label: 'Reopen',
        onClick: () => {
          setFileView(left)
          setTab('file')
        },
      },
    })
  }, [])
  const allChildThreads = useChildThreads(threadId)
  const childThreads = useMemo(
    () => allChildThreads.filter((child) => !child.archived),
    [allChildThreads]
  )
  const hasOverview = useHasOverview(threadId, childThreads)
  const hasOverviewNow = useRef(hasOverview)
  hasOverviewNow.current = hasOverview
  const links = useThreadPullRequests(threadId)
  const { visible: pullRequestLinks, show, hide } = usePullRequestTabs(threadId, links)
  const pullRequests = useMemo(
    () => ({ links, visible: pullRequestLinks, show, hide }),
    [links, pullRequestLinks, show, hide]
  )
  const { tab: requestedTab, consume } = useDetailsRequest(threadId)
  const narrow = available < narrowWidth
  const full = narrow || expanded
  const max = Math.max(minWidth, available - 360)
  const clamp = (width: number) => Math.max(minWidth, Math.min(max, width))
  const width = full ? available : clamp(preferredWidth ?? available * 0.5)

  function toggle() {
    if (root.current) setAvailable(root.current.clientWidth)
    setOpen((value) => !value)
  }

  const openFile = useCallback(
    (target: FileTarget) => {
      const path = projectPath && projectRelativePath(target.path, projectPath)
      if (!path) return false
      if (gitDisabled) {
        showFile({ threadId, target: { ...target, path } })
        setTab('file')
      } else {
        setFileRequest({ threadId, target: { ...target, path } })
        tabs.current?.show('changes')
      }
      if (!open) {
        openingTab.current = gitDisabled ? 'file' : 'changes'
        if (root.current) setAvailable(root.current.clientWidth)
        setOpen(true)
      }
      return true
    },
    [projectPath, threadId, open, gitDisabled, showFile]
  )

  const settleFile = useCallback(
    (target: FileTarget, changed: boolean) => {
      setFileRequest(undefined)
      if (changed) return
      showFile({ threadId, target })
      setTab('file')
    },
    [threadId, showFile]
  )

  const editFile = useCallback(
    (path: string) => {
      showFile({ threadId, target: { path } })
      setTab('file')
    },
    [threadId, showFile]
  )
  const projectId = meta?.projectId
  // ⌘P's requests for Files' search, counted.
  const [findFile, setFindFile] = useState(0)
  // Files mounts once it's shown for this thread, and stays while the thread does.
  const [filesShownFor, setFilesShownFor] = useState<string>()
  if (open && tab === 'files' && filesShownFor !== threadId) setFilesShownFor(threadId)
  const filesShown = filesShownFor === threadId

  // A just-linked PR's tab can be requested before the thread's links include it.
  const requestShown =
    requestedTab === 'overview' ||
    pullRequestLinks.some((link) => pullRequestTabId(link) === requestedTab)
  const openingTab = useRef<string>(undefined)
  useLayoutEffect(() => {
    if (!requestedTab || !requestShown) return
    consume()
    // Overview may have been closed from the tab strip.
    if (requestedTab === 'overview') tabs.current?.show('overview')
    if (open) {
      setTab(requestedTab)
      return
    }
    openingTab.current = requestedTab
    if (root.current) setAvailable(root.current.clientWidth)
    setOpen(true)
  }, [requestedTab, requestShown, consume, open])

  useHotkey(
    keybinds.details.hotkey,
    (event) => {
      if (!inDialog(event)) toggle()
    },
    { requireReset: true, ignoreInputs: false }
  )
  useHotkey(
    keybinds.findFile.hotkey,
    (event) => {
      if (inDialog(event)) return
      tabs.current?.show('files')
      setFindFile((count) => count + 1)
      if (open) return
      openingTab.current = 'files'
      if (root.current) setAvailable(root.current.clientWidth)
      setOpen(true)
    },
    { enabled: !gitDisabled, requireReset: true, ignoreInputs: false }
  )

  useLayoutEffect(() => {
    if (!open) return
    setTab(openingTab.current ?? (hasOverviewNow.current ? 'overview' : 'changes'))
    openingTab.current = undefined
  }, [open])

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let previous = 0
    const observer = new ResizeObserver(([entry]) => {
      const next = entry!.contentRect.width
      if (next <= 0) return
      // A closed panel only cares about crossing the narrow breakpoint.
      if (open || previous === 0 || previous < narrowWidth !== next < narrowWidth)
        setAvailable(next)
      previous = next
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])

  const portalTarget = open && full ? chatSlot : leftSlot
  // Keep the portal container stable: changing it remounts the entire chat,
  // including markdown, tool disclosures, and the composer.
  useLayoutEffect(() => {
    const host = chatHost.current
    if (portalTarget && host && host.parentNode !== portalTarget) portalTarget.appendChild(host)
  }, [portalTarget])

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width, next: width }
    if (root.current) root.current.dataset.resizing = 'true'
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !root.current) return
    const next = clamp(drag.current.width + drag.current.x - event.clientX)
    drag.current.next = next
    root.current.style.setProperty('--details-width', `${next}px`)
    root.current.style.setProperty('--details-pane-width', `${next}px`)
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(next)))
  }

  function finish() {
    if (!drag.current) return
    setPreferredWidth(drag.current.next)
    drag.current = null
    if (root.current) delete root.current.dataset.resizing
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: width + 16, ArrowRight: width - 16, Home: minWidth, End: max }[
      event.key
    ]
    if (next === undefined) return
    event.preventDefault()
    setPreferredWidth(clamp(next))
  }

  // Width changes should only update the layout, not rerender tab contents.
  const detailsPane = useMemo(
    () => (
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (typeof value === 'string') setTab(value)
        }}
        className='details-pane h-full min-w-0 gap-0'
      >
        <header className='flex h-(--app-tab-bar-height) shrink-0 justify-end border-b border-border pr-[42px]'>
          {full && (
            <div className='flex shrink-0 items-center pl-(--page-header-inset)'>
              <PageSidebarTrigger />
            </div>
          )}
          <div className='min-w-0 flex-1 overflow-hidden'>
            <ThreadDetailsTabs
              ref={tabs}
              chat={full}
              threadId={threadId}
              threadCount={childThreads.length}
              pullRequests={pullRequests}
              file={
                viewedFile && {
                  path: viewedFile.path,
                  dirty: fileDirty,
                  onClose: () => showFile(undefined),
                }
              }
              value={tab}
              onValueChange={setTab}
              gitDisabled={gitDisabled}
            />
          </div>
          {!narrow && (
            <div className='ml-1 flex shrink-0 items-center'>
              <Button
                variant='ghost-text'
                size='icon'
                aria-label={expanded ? 'Restore split view' : 'Expand thread details'}
                title={expanded ? 'Restore split view' : 'Expand thread details'}
                {...pressProps(() => setExpanded((value) => !value))}
              >
                {expanded ? <ArrowShrink02Icon /> : <ArrowExpand01Icon />}
              </Button>
            </div>
          )}
        </header>
        <div className='min-h-0 flex-1 overflow-hidden'>
          <div className='details-tab-track min-w-(--details-pane-width)'>
            <TabsContent
              keepMounted
              value='chat'
              inert={tab !== 'chat'}
              aria-hidden={tab !== 'chat'}
              className='details-tab-panel'
            >
              <div ref={setChatSlot} className='flex h-full min-h-0 min-w-0 flex-col' />
            </TabsContent>
            <TabsContent
              keepMounted
              value='overview'
              inert={tab !== 'overview'}
              aria-hidden={tab !== 'overview'}
              className='details-tab-panel'
            >
              {open && (
                <ThreadOverview
                  threadId={threadId}
                  childThreads={childThreads}
                  onShowChat={() => {
                    if (full) setTab('chat')
                  }}
                  onShowChanges={() => setTab('changes')}
                />
              )}
            </TabsContent>
            <TabsContent
              keepMounted
              value='changes'
              inert={tab !== 'changes'}
              aria-hidden={tab !== 'changes'}
              className='details-tab-panel'
            >
              {open &&
                (ready ? (
                  <ThreadChanges
                    key={threadId}
                    threadId={threadId}
                    target={requestedFile}
                    onTarget={settleFile}
                    onEditFile={editFile}
                  />
                ) : (
                  <Loading />
                ))}
            </TabsContent>
            <TabsContent
              keepMounted
              value='files'
              inert={tab !== 'files'}
              aria-hidden={tab !== 'files'}
              className='details-tab-panel'
            >
              {open && ready && filesShown && projectId && (
                <ThreadFiles
                  key={threadId}
                  threadId={threadId}
                  projectId={projectId}
                  openPath={viewedFile?.path}
                  find={findFile}
                  onOpen={editFile}
                />
              )}
            </TabsContent>
            <TabsContent
              keepMounted
              value='threads'
              inert={tab !== 'threads'}
              aria-hidden={tab !== 'threads'}
              className='details-tab-panel'
            >
              <div className='scrollbar-subtle h-full overflow-auto'>
                <ChildThreadList threads={childThreads} />
              </div>
            </TabsContent>
            {pullRequestLinks.map((link) => {
              const id = pullRequestTabId(link)
              return (
                <TabsContent
                  key={id}
                  keepMounted
                  value={id}
                  inert={tab !== id}
                  aria-hidden={tab !== id}
                  className='details-tab-panel'
                >
                  {open && ready && (
                    <Activity mode={tab === id ? 'visible' : 'hidden'}>
                      <LivePullRequestView threadId={threadId} link={link} />
                    </Activity>
                  )}
                </TabsContent>
              )
            })}
            {viewedFile && (
              <TabsContent
                keepMounted
                value='file'
                inert={tab !== 'file'}
                aria-hidden={tab !== 'file'}
                className='details-tab-panel'
              >
                {open &&
                  (ready ? (
                    <ThreadFile
                      key={viewedFile.path}
                      threadId={threadId}
                      target={viewedFile}
                      checkout={checkout}
                    />
                  ) : (
                    <Loading label='Loading file' />
                  ))}
              </TabsContent>
            )}
          </div>
        </div>
      </Tabs>
    ),
    [
      tab,
      full,
      narrow,
      expanded,
      open,
      ready,
      threadId,
      childThreads,
      pullRequests,
      pullRequestLinks,
      requestedFile,
      viewedFile,
      fileDirty,
      checkout,
      showFile,
      settleFile,
      editFile,
      gitDisabled,
      projectId,
      findFile,
      filesShown,
    ]
  )

  return (
    <div
      ref={root}
      data-details-open={open}
      data-details-full={full || undefined}
      className='thread-details-layout'
      style={
        {
          '--details-width': `${open ? width : 0}px`,
          '--details-pane-width': `${width}px`,
        } as CSSProperties
      }
    >
      <div
        className='min-h-0 min-w-0 overflow-hidden'
        inert={open && full}
        aria-hidden={(open && full) || undefined}
      >
        <div ref={attachLeftSlot} className='flex h-full min-w-[320px] flex-col' />
      </div>
      <OpenFileLink value={openFile}>
        {createPortal(children, chatHost.current)}
        <aside
          aria-label='Thread details'
          inert={!open}
          aria-hidden={!open || undefined}
          className='relative min-h-0 min-w-0 overflow-hidden bg-background'
        >
          {detailsPane}
        </aside>
      </OpenFileLink>
      <div className='absolute top-0 right-2.5 z-20 flex h-[calc(var(--app-tab-bar-height)-1px)] items-center gap-1'>
        <KeybindTooltip binding={keybinds.details}>
          <Button
            variant='ghost-text'
            size='icon'
            className='aria-expanded:text-muted-foreground aria-expanded:not-disabled:hover:text-foreground'
            aria-label={open ? 'Close thread details' : 'Open thread details'}
            aria-expanded={open}
            aria-keyshortcuts='Meta+Alt+B'
            {...pressProps(toggle)}
          >
            <SidebarLeftIcon className='rotate-180' />
          </Button>
        </KeybindTooltip>
      </div>
      {open && !full && (
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a focusable splitter; <hr> can't take focus or pointer handlers
          role='separator'
          aria-label='Resize thread details'
          aria-orientation='vertical'
          aria-valuemin={minWidth}
          aria-valuemax={Math.round(max)}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          className='thread-details-resize'
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onKeyDown={keyDown}
        />
      )}
    </div>
  )
}
