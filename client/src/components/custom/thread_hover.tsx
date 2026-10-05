import type { ProviderId, RunningSubagent } from '@jetty/shared/wire'

import { DitherAvatar } from '@/components/dither-kit/avatar'
import { Button } from '@/components/ui/button'
import { pressProps } from '@/lib/press'
import { cn } from '@/lib/utils'
import { useChrome, useOpenOverview, useOpenPullRequest, useThreadJourney } from '@/state'
import { useBranches, useBranchList } from '@/state/worktrees'
import { PreviewCard } from '@base-ui/react/preview-card'
import { catalogModelName } from '@jetty/shared/model-name'
import { useNavigate } from '@tanstack/react-router'
import { animate, motionValue, type MotionValue } from 'motion'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { useChildThreads } from './child_threads'
import { environments } from './composer_environment'
import { OverflowTitle } from './overflow_title'
import { ProviderGlyph } from './provider_glyph'
import { RollingDuration } from './rolling_duration'
import { threadPullRequests } from './sidebar_thread_groups'
import { renderWorkingTitle } from './subagent_row'
import { rankPullRequests, type ThreadPullRequest } from './thread_pull_request'
import { StatusGlyph, statusPresentation, threadStatus, type ThreadStatus } from './thread_status'
import { formatActivityDuration } from './work_model'
import './thread_hover.css'

type ThreadLink = { id: string; title: string; status: ThreadStatus }

type Checkout = { label: string; branch: boolean }

type ThreadHoverPanelProps = {
  title: string
  provider?: ProviderId
  model?: string
  environment: 'local' | 'worktree'
  checkout?: Checkout
  parent?: ThreadLink
  pullRequests: readonly ThreadPullRequest[]
  childThreads: readonly (ThreadLink & { archived: boolean })[]
  subagents: readonly RunningSubagent[]
  onOpenThread: (id: string) => void
  onOpenPullRequest: (pr: ThreadPullRequest) => void
  onOpenOverview: () => void
}

type SharedPreview = {
  handle: ReturnType<typeof PreviewCard.createHandle<ReactElement>>
  open: boolean
}

const ThreadHoverContext = createContext<SharedPreview | null>(null)

const listLimit = 4

// Threads that want you lead, then the ones still running.
const childOrder: ThreadStatus[] = ['needs-attention', 'working']

function childRank(status: ThreadStatus) {
  const rank = childOrder.indexOf(status)
  return rank === -1 ? childOrder.length : rank
}

// A spring that keeps its velocity when the hovered row changes mid-flight, so the card chases the
// pointer instead of restarting from rest.
const cardSpring = { type: 'spring', visualDuration: 0.1, bounce: 0 } as const

function springTo(value: MotionValue<number>, to: number, jump: boolean) {
  if (jump || matchMedia('(prefers-reduced-motion: reduce)').matches) value.jump(to)
  else animate(value, to, cardSpring)
}

// The card's height is the content's, measured here rather than through Base UI's --popup-height,
// whose measuring step resets an animation in flight. Each change springs from the current height.
function useCardMotion() {
  const setHeight = useRef((_height: number) => {})
  const popup = useRef<HTMLDivElement>(null)
  // Only a new trigger's content springs the card across; a scroll moves it with its anchor.
  const switched = useRef(false)

  const viewport = useCallback((element: HTMLElement | null) => {
    if (!element) return
    let measured = false
    const height = motionValue(0)
    const stop = height.on('change', (value) => {
      element.style.height = `${value}px`
    })
    setHeight.current = (to) => {
      springTo(height, to, !measured)
      measured = true
    }
    return () => {
      stop()
      height.destroy()
    }
  }, [])

  const content = useCallback((element: HTMLElement | null) => {
    if (!element) return
    switched.current = true
    const observer = new ResizeObserver(([entry]) =>
      setHeight.current(entry!.borderBoxSize[0]!.blockSize)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Base UI moves the positioner in one step; the popup is translated back to where it was and
  // springs home. Until Base UI has a position, it holds the positioner at 0,0 with opacity 0.
  const positioner = useCallback((element: HTMLElement | null) => {
    if (!element) return
    let left = element.offsetLeft
    let top = element.offsetTop
    let positioned = element.style.opacity !== '0'
    const x = motionValue(left)
    const y = motionValue(top)
    function place() {
      popup.current?.style.setProperty('translate', `${x.get() - left}px ${y.get() - top}px`)
    }
    const stops = [x.on('change', place), y.on('change', place)]
    const observer = new MutationObserver(() => {
      const settled = positioned && element.style.opacity !== '0'
      positioned = element.style.opacity !== '0'
      if (element.offsetLeft === left && element.offsetTop === top) return
      const jump = !settled || !switched.current
      switched.current = false
      left = element.offsetLeft
      top = element.offsetTop
      place()
      springTo(x, left, jump)
      springTo(y, top, jump)
    })
    observer.observe(element, { attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      for (const stop of stops) stop()
      x.destroy()
      y.destroy()
    }
  }, [])

  return { viewport, content, positioner, popup }
}

// One card for every sidebar row: Base UI moves it between rows, and the card follows the hovered
// row's position and its content's height together.
export function ThreadHoverPopup({
  side = 'right',
  children,
}: {
  side?: 'right' | 'bottom'
  children: ReactNode
}) {
  const { positioner, popup, viewport, content } = useCardMotion()
  return (
    <PreviewCard.Portal>
      <PreviewCard.Positioner
        ref={positioner}
        side={side}
        align='start'
        sideOffset={8}
        className='z-50'
      >
        <PreviewCard.Popup
          ref={popup}
          className='thread-hover-panel w-[450px] rounded-sm border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md'
        >
          <PreviewCard.Viewport ref={viewport} className='thread-hover-panel-viewport'>
            <div ref={content}>{children}</div>
          </PreviewCard.Viewport>
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  )
}

export function ThreadHoverGroup({ children }: { children: ReactNode }) {
  const [handle] = useState(() => PreviewCard.createHandle<ReactElement>())
  const [open, setOpen] = useState(false)
  return (
    <ThreadHoverContext.Provider value={{ handle, open }}>
      {children}
      <PreviewCard.Root handle={handle} onOpenChange={setOpen}>
        {({ payload }) => <ThreadHoverPopup>{payload}</ThreadHoverPopup>}
      </PreviewCard.Root>
    </ThreadHoverContext.Provider>
  )
}

export function ThreadHoverCard({
  threadId,
  children,
}: {
  threadId: string
  children: (trigger: ReactElement) => ReactNode
}) {
  const group = useContext(ThreadHoverContext)!
  return children(
    <PreviewCard.Trigger
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the row rendering this trigger supplies its content
      render={<button />}
      handle={group.handle}
      payload={<ThreadHoverDetails threadId={threadId} />}
      delay={group.open ? 0 : 500}
      closeDelay={100}
      {...pressProps(() => group.handle.close())}
    />
  )
}

// A Current checkout thread works on whatever the project checkout has out right now.
function useCheckout(projectId?: string): Checkout | undefined {
  const fetchBranches = useBranches()
  useEffect(() => {
    if (projectId) fetchBranches(projectId, true)
  }, [projectId, fetchBranches])
  const list = useBranchList(projectId, true)
  if (!list || list.git === 'error') return undefined
  if (list.git !== 'ok')
    return { label: list.git === 'missing' ? 'Folder missing' : 'Project folder', branch: false }
  return list.currentBranch
    ? { label: list.currentBranch, branch: true }
    : { label: 'Detached HEAD', branch: false }
}

// Everything the card shows comes from chrome, which the sidebar already holds: opening a card
// never waits on the network, and it follows the thread live while it's open.
export function ThreadHoverDetails({ threadId }: { threadId: string }) {
  const chrome = useChrome()
  const childThreads = useChildThreads(threadId)
  const navigate = useNavigate()
  const startThreadJourney = useThreadJourney()
  const openPullRequest = useOpenPullRequest()
  const openOverview = useOpenOverview()
  const thread = chrome?.threads.find((candidate) => candidate.id === threadId)
  const checkout = useCheckout(thread?.environment === 'local' ? thread.projectId : undefined)
  if (!chrome || !thread) return null
  const parent = chrome.threads.find((candidate) => candidate.id === thread.parentThreadId)
  const branch = thread.git?.branch ?? thread.worktree?.branch ?? undefined
  return (
    <ThreadHoverPanel
      title={thread.title}
      provider={thread.provider}
      model={
        thread.provider && thread.model
          ? catalogModelName(chrome.models, thread.provider, thread.model)
          : undefined
      }
      environment={thread.environment}
      checkout={checkout ?? (branch ? { label: branch, branch: true } : undefined)}
      parent={
        parent && {
          id: parent.id,
          title: parent.title,
          status: threadStatus(parent.status, parent.readyForReview),
        }
      }
      pullRequests={threadPullRequests(thread.pullRequests ?? []).pullRequests}
      childThreads={childThreads}
      subagents={thread.runningSubagents ?? []}
      onOpenThread={(id) => {
        startThreadJourney(id)
        void navigate({ to: '/threads/$threadId', params: { threadId: id } })
      }}
      onOpenPullRequest={(pr) => openPullRequest(threadId, pr)}
      onOpenOverview={() => openOverview(threadId)}
    />
  )
}

function ThreadHoverPanel({
  title,
  provider,
  model,
  environment,
  checkout,
  parent,
  pullRequests,
  childThreads,
  subagents,
  onOpenThread,
  onOpenPullRequest,
  onOpenOverview,
}: ThreadHoverPanelProps) {
  const prs = rankPullRequests(pullRequests)
  const numberWidth = Math.max(...pullRequests.map((pr) => `#${pr.number}`.length))
  const children = childThreads
    .filter((child) => !child.archived)
    .toSorted((a, b) => childRank(a.status) - childRank(b.status))

  return (
    <div className='flex flex-col gap-1.5'>
      <div data-overflow-hover className='flex min-w-0 items-center gap-3'>
        <OverflowTitle>{title}</OverflowTitle>
        {model && (
          <span className='flex shrink-0 items-center gap-1'>
            {provider && <ProviderGlyph provider={provider} className='size-3 text-primary' />}
            {model}
          </span>
        )}
      </div>
      <EnvironmentLine worktree={environment === 'worktree'} checkout={checkout} />
      {parent && (
        <Section label='Parent thread'>
          <ThreadLinkRow thread={parent} onOpen={() => onOpenThread(parent.id)} />
        </Section>
      )}
      {prs.length > 0 && (
        <Section label='Pull requests'>
          {prs.map(({ pr, icon: Icon, color, label }) => (
            <Row key={`${pr.repo}#${pr.number}`} onPress={() => onOpenPullRequest(pr)}>
              <Icon aria-hidden='true' className={cn('size-3 shrink-0', color)} />
              <span
                className='shrink-0 text-right font-mono text-muted-foreground'
                style={{ width: `${numberWidth}ch` }}
              >
                #{pr.number}
              </span>
              <RowTitle>{pr.title ?? ''}</RowTitle>
              <span className='shrink-0 text-muted-foreground'>{label}</span>
            </Row>
          ))}
        </Section>
      )}
      {children.length > 0 && (
        <Section label='Child threads'>
          {children.slice(0, listLimit).map((child) => (
            <ThreadLinkRow key={child.id} thread={child} onOpen={() => onOpenThread(child.id)} />
          ))}
          <More count={children.length - listLimit} onPress={onOpenOverview} />
        </Section>
      )}
      {subagents.length > 0 && (
        <Section label='Subagents'>
          <SubagentRows subagents={subagents.slice(0, listLimit)} />
          <More count={subagents.length - listLimit} onPress={onOpenOverview} />
        </Section>
      )}
    </div>
  )
}

function EnvironmentLine({ worktree, checkout }: { worktree: boolean; checkout?: Checkout }) {
  const { label, Icon } = environments[worktree ? 'worktree' : 'local']
  return (
    <span className='flex min-w-0 items-center gap-1 text-muted-foreground' title={label}>
      <Icon aria-hidden='true' className='size-3 shrink-0' />
      <span className='sr-only'>{label}</span>
      {checkout && (
        <span className={cn('truncate', checkout.branch && 'font-mono')}>{checkout.label}</span>
      )}
    </span>
  )
}

// Rows sit 3px inside their hover fill and 8px in from its sides, the Button's 1px border included,
// so the text keeps a 6px rhythm under the label and between rows.
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex flex-col pt-1.5'>
      <span className='text-muted-foreground'>{label}</span>
      <div className='-mx-2 mt-0.75 -mb-0.75 flex flex-col'>{children}</div>
    </div>
  )
}

const rowClass = 'flex min-w-0 items-center gap-2 border border-transparent px-1.75 py-0.5'

function Row({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <Button
      variant='ghost'
      data-overflow-hover
      className={cn(
        rowClass,
        'h-auto w-full justify-start rounded-menu-item text-left text-xs font-normal'
      )}
      {...pressProps(onPress)}
    >
      {children}
    </Button>
  )
}

function RowTitle({
  children,
  renderText,
}: {
  children: string
  renderText?: (text: string) => ReactNode
}) {
  return (
    <OverflowTitle
      focusable={false}
      renderText={renderText}
      className='text-xs leading-4 font-normal text-foreground'
    >
      {children}
    </OverflowTitle>
  )
}

function ThreadLinkRow({ thread, onOpen }: { thread: ThreadLink; onOpen: () => void }) {
  return (
    <Row onPress={onOpen}>
      <StatusGlyph status={thread.status} className='size-3' />
      <RowTitle>{thread.title}</RowTitle>
      <span className='shrink-0 text-muted-foreground'>
        {statusPresentation[thread.status].label}
      </span>
    </Row>
  )
}

function More({ count, onPress }: { count: number; onPress: () => void }) {
  if (count <= 0) return null
  return (
    <Row onPress={onPress}>
      <span className='pl-5 text-muted-foreground'>+{count} more</span>
    </Row>
  )
}

function SubagentRows({ subagents }: { subagents: readonly RunningSubagent[] }) {
  const { now, ticked } = useClock()
  return subagents.map((agent) => {
    const seconds = Math.max(0, Math.floor((now - agent.startedAt) / 1000))
    return (
      <div key={agent.id} data-overflow-hover className={rowClass}>
        <DitherAvatar
          name={agent.id}
          mirror='horizontal'
          animate={false}
          color='var(--primary)'
          className='size-3 shrink-0'
        />
        <RowTitle renderText={renderWorkingTitle}>{agent.title}</RowTitle>
        <span
          className='shrink-0 text-muted-foreground'
          aria-label={`Running for ${formatActivityDuration(seconds)}`}
        >
          <RollingDuration seconds={seconds} still={!ticked} />
        </span>
      </div>
    )
  })
}

// Opening a card skips the rolling digits' setup; they take over from the first tick.
function useClock() {
  const [clock, setClock] = useState(() => ({ now: Date.now(), ticked: false }))
  useEffect(() => {
    const timer = setInterval(() => setClock({ now: Date.now(), ticked: true }), 1000)
    return () => clearInterval(timer)
  }, [])
  return clock
}
