import type { Attachment } from '@jetty/shared/items'

import { threadBranch } from '@/lib/thread_worktree'
import {
  defaultDiffScope,
  desktopTabId,
  pullRequestTabId,
  readFileDraft,
  subagentTabId,
  useDesktopTabs,
  useDetailsRequest,
  useFileDirty,
  usePullRequestTabs,
  useSubagents,
  useSubagentTabs,
  useThreadMeta,
  useThreadPullRequests,
} from '@/state'
import { useProjectGit } from '@/state/worktrees'
import { useHotkey } from '@tanstack/react-hotkeys'
import {
  Activity,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { OpenAttachment } from './attachment_files'
import { useChildThreads } from './child_threads'
import {
  DetailsChatPanel,
  DetailsLayout,
  DetailsPane,
  DetailsTabPanel,
  useDetailsLayout,
} from './details_layout'
import { OpenPullLink } from './entity_link'
import { OpenFileLink, projectRelativePath, type FileTarget } from './file_link'
import { inDialog, keybinds } from './keybinds'
import { Loading } from './loading'
import { LivePullRequestView } from './pull_request_view'
import { SubagentView } from './subagent_view'
import { ThreadChanges, useThreadChangesPrefetch } from './thread_changes'
import { ThreadDesktop } from './thread_desktop'
import { ThreadDetailsTabs, type DetailsTabsHandle } from './thread_details_tabs'
import { ThreadFile } from './thread_file'
import { ThreadFiles } from './thread_files'
import { ThreadOverview, useHasOverview } from './thread_overview'

let lastFileRequest = 0

function nextFileRequest() {
  return ++lastFileRequest
}

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
  const layout = useDetailsLayout()
  const { open, ready, narrow, full, expanded, setExpanded, setChatSlot, show: showPane } = layout
  const [pickedTab, setTab] = useState('changes')
  const meta = useThreadMeta(threadId)
  const git = useProjectGit(meta?.projectId)?.git
  // Only Changes needs a repository. Files still opens; a missing folder has nothing to list.
  const changesDisabled =
    git === 'not-git'
      ? 'Not a git repository'
      : git === 'missing'
        ? 'Project folder not found'
        : undefined
  const filesDisabled = git === 'missing' ? 'Project folder not found' : undefined
  const tab =
    (changesDisabled && pickedTab === 'changes') || (filesDisabled && pickedTab === 'files')
      ? 'overview'
      : pickedTab
  // An open pane has Changes mounted already.
  useThreadChangesPrefetch(
    threadId,
    meta && !open && !changesDisabled ? defaultDiffScope(meta) : undefined,
    meta?.turnEndedAt
  )
  const tabs = useRef<DetailsTabsHandle>(null)
  // A file link goes to Changes first, and on to its own tab if it isn't a changed file.
  const [fileRequest, setFileRequest] = useState<ThreadFileTarget>()
  const [fileView, setFileView] = useState<ThreadFileTarget>()
  const requestedFile = fileRequest?.threadId === threadId ? fileRequest.target : undefined
  const viewedFile = fileView?.threadId === threadId ? fileView.target : undefined
  const fileDirty = useFileDirty(threadId, viewedFile?.attachment ? '' : (viewedFile?.path ?? ''))
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
  const desktops = useDesktopTabs(threadId)
  const allSubagents = useSubagents(threadId)
  const {
    visible: openedSubagents,
    show: showSubagent,
    hide: hideSubagent,
  } = useSubagentTabs(threadId)
  const visibleSubagents = useMemo(
    () => openedSubagents.flatMap((id) => allSubagents.filter((agent) => agent.id === id)),
    [openedSubagents, allSubagents]
  )
  const subagents = useMemo(
    () => ({
      all: allSubagents,
      visible: visibleSubagents,
      show: showSubagent,
      hide: hideSubagent,
    }),
    [allSubagents, visibleSubagents, showSubagent, hideSubagent]
  )
  const { tab: requestedTab, consume } = useDetailsRequest(threadId)

  const openFile = useCallback(
    (target: FileTarget) => {
      const path = projectPath && projectRelativePath(target.path, projectPath)
      if (!path) return false
      if (changesDisabled) {
        setFileRequest(undefined)
        showFile({ threadId, target: { ...target, path } })
        setTab('file')
      } else {
        setFileRequest({ threadId, target: { ...target, path } })
        tabs.current?.show('changes')
      }
      if (!open) {
        openingTab.current = changesDisabled ? 'file' : 'changes'
        showPane()
      }
      return true
    },
    [projectPath, threadId, open, changesDisabled, showFile, showPane]
  )

  const openAttachment = useCallback(
    (attachment: Attachment) => {
      showFile({ threadId, target: { path: attachment.name, attachment } })
      setTab('file')
      if (!open) {
        openingTab.current = 'file'
        showPane()
      }
      return true
    },
    [threadId, open, showFile, showPane]
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

  // Files and the diff's edit button ask for the file's editor to take focus, counted.
  const [focusFile, setFocusFile] = useState(0)
  const editFile = useCallback(
    (path: string) => {
      showFile({ threadId, target: { path } })
      setTab('file')
      setFocusFile(nextFileRequest())
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
    pullRequestLinks.some((link) => pullRequestTabId(link) === requestedTab) ||
    desktops.ids.some((id) => desktopTabId(id) === requestedTab) ||
    visibleSubagents.some((agent) => subagentTabId(agent.id) === requestedTab)
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
    showPane()
  }, [requestedTab, requestShown, consume, open, showPane])

  useHotkey(
    keybinds.findFile.hotkey,
    (event) => {
      if (inDialog(event)) return
      tabs.current?.show('files')
      setFindFile(nextFileRequest())
      if (open) return
      openingTab.current = 'files'
      showPane()
    },
    { enabled: !filesDisabled, requireReset: true, ignoreInputs: false }
  )

  useLayoutEffect(() => {
    if (!open) return
    setTab(openingTab.current ?? (hasOverviewNow.current ? 'overview' : 'changes'))
    openingTab.current = undefined
  }, [open])

  // Width changes should only update the layout, not rerender tab contents.
  const detailsPane = useMemo(
    () => (
      <DetailsPane
        label='Thread details'
        tab={tab}
        onTabChange={setTab}
        full={full}
        narrow={narrow}
        expanded={expanded}
        onExpandedChange={setExpanded}
        tabs={
          <ThreadDetailsTabs
            ref={tabs}
            chat={full}
            threadId={threadId}
            pullRequests={pullRequests}
            desktops={desktops}
            subagents={subagents}
            file={
              viewedFile && {
                path: viewedFile.path,
                dirty: fileDirty,
                onClose: () => showFile(undefined),
              }
            }
            value={tab}
            onValueChange={setTab}
            changesDisabled={changesDisabled}
            filesDisabled={filesDisabled}
          />
        }
      >
        <DetailsChatPanel tab={tab} slotRef={setChatSlot} />
        <DetailsTabPanel value='overview' tab={tab}>
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
        </DetailsTabPanel>
        <DetailsTabPanel value='changes' tab={tab}>
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
        </DetailsTabPanel>
        <DetailsTabPanel value='files' tab={tab}>
          {open && ready && filesShown && projectId && (
            <ThreadFiles
              key={threadId}
              threadId={threadId}
              projectId={projectId}
              openPath={viewedFile?.attachment ? undefined : viewedFile?.path}
              find={findFile}
              onOpen={editFile}
            />
          )}
        </DetailsTabPanel>
        {pullRequestLinks.map((link) => {
          const id = pullRequestTabId(link)
          return (
            <DetailsTabPanel key={id} value={id} tab={tab}>
              {open && ready && (
                <Activity mode={tab === id ? 'visible' : 'hidden'}>
                  <LivePullRequestView threadId={threadId} link={link} />
                </Activity>
              )}
            </DetailsTabPanel>
          )
        })}
        {desktops.ids.map((id) => {
          const value = desktopTabId(id)
          // Streams only while shown: the streamer takes one viewer at a time.
          return (
            <DetailsTabPanel key={value} value={value} tab={tab}>
              {open && ready && tab === value && <ThreadDesktop id={id} />}
            </DetailsTabPanel>
          )
        })}
        {visibleSubagents.map((agent) => {
          const id = subagentTabId(agent.id)
          return (
            <DetailsTabPanel key={id} value={id} tab={tab}>
              {open && ready && (
                <Activity mode={tab === id ? 'visible' : 'hidden'}>
                  <SubagentView threadId={threadId} agentId={agent.id} projectPath={projectPath} />
                </Activity>
              )}
            </DetailsTabPanel>
          )
        })}
        {viewedFile && (
          <DetailsTabPanel value='file' tab={tab}>
            {open &&
              (ready ? (
                <ThreadFile
                  key={viewedFile.path}
                  threadId={threadId}
                  target={viewedFile}
                  checkout={checkout}
                  focus={focusFile}
                />
              ) : (
                <Loading label='Loading file' />
              ))}
          </DetailsTabPanel>
        )}
      </DetailsPane>
    ),
    [
      tab,
      full,
      narrow,
      expanded,
      setExpanded,
      setChatSlot,
      open,
      ready,
      threadId,
      childThreads,
      pullRequests,
      pullRequestLinks,
      desktops,
      subagents,
      visibleSubagents,
      projectPath,
      requestedFile,
      viewedFile,
      fileDirty,
      checkout,
      showFile,
      settleFile,
      editFile,
      changesDisabled,
      filesDisabled,
      projectId,
      findFile,
      focusFile,
      filesShown,
    ]
  )

  return (
    <OpenFileLink value={openFile}>
      <OpenAttachment value={openAttachment}>
        <DetailsLayout layout={layout} label='Thread details' pane={detailsPane}>
          <OpenPullLink value={threadId}>{children}</OpenPullLink>
        </DetailsLayout>
      </OpenAttachment>
    </OpenFileLink>
  )
}
